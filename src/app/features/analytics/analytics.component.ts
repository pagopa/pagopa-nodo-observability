import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe, formatNumber } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Filters, ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { ActivationsOutcomes, COVERAGE_REASONS } from '../../models/analytics';
import { formatInstant } from '../../models/domain';
import { readTimeWindow, resolveTimeWindow, TimeWindowSelection } from '../../models/time-window';
import { TimeWindowComponent } from '../../shared/time-window/time-window.component';

type Dimension = 'serviceIdentifier' | 'psp' | 'canale' | 'stazione';

const REASON_MESSAGES: Record<(typeof COVERAGE_REASONS)[number], string> = {
  NO_INGESTION_WATERMARK: 'Dati osservati: la copertura dell’ingestione non è verificabile, eventi non acquisiti possono mancare dai conteggi.',
  RETENTION: 'Periodo precedente alla retention della proiezione: i token potrebbero essere già stati eliminati, conteggi non disponibili.',
};

const isKnownReason = (reason: string): reason is keyof typeof REASON_MESSAGES => reason in REASON_MESSAGES;

/** A detail row: `name` null means the cause was not recorded; `via` is only present for terminal states with a cause. */
interface TokenDetail { name: string | null; hasVia: boolean; via: string | null; count: number; share: string }

@Component({
  selector: 'app-analytics',
  imports: [DecimalPipe, TimeWindowComponent],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsComponent implements OnInit {
  private readonly api = inject(ObservabilityApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly timezone = inject(TimezoneService);
  private readonly locale = inject(LOCALE_ID);
  private subscription?: Subscription;

  readonly data = signal<ActivationsOutcomes | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly timeWindow = signal<TimeWindowSelection>({ range: '1h', from: '', to: '' });
  readonly filters = signal<Record<Dimension, string>>({ serviceIdentifier: '', psp: '', canale: '', stazione: '' });

  readonly catalogLoading = signal(true);
  readonly catalogError = signal<string | null>(null);
  readonly catalogLoaded = signal(false);
  readonly serviceIdentifiers = signal<string[]>([]);
  readonly serviceIdentifierOptions = computed(() => {
    const identifiers = this.serviceIdentifiers();
    const active = this.filters().serviceIdentifier;
    return active && !identifiers.includes(active) ? [active, ...identifiers] : identifiers;
  });

  readonly empty = computed(() => {
    const value = this.data();
    return value !== null && value.activatePaymentNoticeOk.total === 0 && value.sendPaymentOutcome.total === 0;
  });
  /** `difference` is sendPaymentOutcome minus positive activatePaymentNotice: negative means fewer outcomes. */
  readonly gap = computed(() => {
    const value = this.data();
    return value === null ? null : value.difference;
  });
  readonly difference = computed(() => {
    const gap = this.gap();
    if (gap === null) return '';
    const sign = gap > 0 ? '+' : gap < 0 ? '−' : '';
    return sign + formatNumber(Math.abs(gap), this.locale);
  });
  readonly gapMeaning = computed(() => {
    const gap = this.gap();
    if (gap === null) return '';
    if (gap === 0) return 'Stesso numero di sendPaymentOutcome e activatePaymentNotice positive nella finestra.';
    const count = formatNumber(Math.abs(gap), this.locale);
    return gap < 0
      ? `${count} sendPaymentOutcome in meno rispetto alle activatePaymentNotice positive nella finestra.`
      : `${count} sendPaymentOutcome in più rispetto alle activatePaymentNotice positive nella finestra.`;
  });
  /** One explanation per coverage reason. */
  readonly coverageReasons = computed(() =>
    (this.data()?.coverage.reasons ?? []).map(reason => isKnownReason(reason) ? REASON_MESSAGES[reason] : `Limite segnalato: ${reason}.`));
  /** Ordered token categories with their details; they add up to `tokens.total`. Null when unavailable. */
  readonly tokenCategories = computed(() => {
    const tokens = this.data()?.tokens;
    if (!tokens) return null;
    const share = (count: number) => tokens.total > 0 ? `${formatNumber((count / tokens.total) * 100, this.locale, '1.0-1')} %` : '—';
    const detail = (name: string | null, count: number, via?: string | null): TokenDetail =>
      ({ name, hasVia: via !== undefined, via: via ?? null, count, share: share(count) });
    const { acceptedOutcome: accepted, cancelledByMod3Cancel: cron, otherCancelled, otherTerminal, nonTerminal } = tokens;
    return [
      { key: 'accepted', label: 'Esito sendPaymentOutcome accettato osservato', count: accepted.total,
        meaning: 'È stato osservato il passaggio di stato causato da una sendPaymentOutcome accettata.',
        details: [detail('sendPaymentOutcome', accepted.sendPaymentOutcome), detail('sendPaymentOutcomeV2', accepted.sendPaymentOutcomeV2)] },
      { key: 'cron', label: 'Annullati dal cron mod3Cancel', count: cron.total,
        meaning: 'Nessun esito accettato osservato: token scaduto e annullato (CANCELLED) dal job, anche dopo la fine del periodo.',
        details: [detail('mod3Cancel', cron.mod3Cancel), detail('mod3CancelV2', cron.mod3CancelV2)] },
      { key: 'other-cancelled', label: 'Altri annullamenti', count: otherCancelled.total,
        meaning: 'Annullati (CANCELLED) per una causa diversa dal cron, senza esito accettato osservato.',
        details: otherCancelled.byCause.map(item => detail(item.cause, item.count)) },
      { key: 'other-terminal', label: 'Altri stati finali', count: otherTerminal.total,
        meaning: 'Stato finale diverso da CANCELLED raggiunto senza esito sendPaymentOutcome accettato osservato.',
        details: otherTerminal.byState.map(item => detail(item.state, item.count, item.cause)) },
      { key: 'non-terminal', label: 'Stato finale non osservato', count: nonTerminal.total,
        meaning: 'L’ultimo stato osservato non è finale: il tentativo può essere ancora in corso oppure gli eventi successivi possono non essere stati acquisiti.',
        details: nonTerminal.byState.map(item => detail(item.state, item.count)) },
    ].map(category => ({ ...category, share: share(category.count), width: tokens.total > 0 ? category.count / tokens.total * 100 : 0 }));
  });
  /** Each bar shows the version distribution within its own total. */
  readonly breakdowns = computed(() => {
    const value = this.data();
    if (value === null) return null;
    const { activatePaymentNoticeOk: ok, sendPaymentOutcome: spo } = value;
    const stack = (total: number, parts: readonly { label: string; count: number; tone: string }[]) => {
      let x = 0;
      return parts.map(part => {
        const width = total > 0 ? (part.count / total) * 100 : 0;
        const share = total > 0 ? `${formatNumber(width, this.locale, '1.0-1')} %` : '—';
        const segment = { ...part, x, width, share };
        x += width;
        return segment;
      });
    };
    return {
      activation: stack(ok.total, [
        { label: 'activatePaymentNotice', count: ok.activatePaymentNotice, tone: 'v1' },
        { label: 'activatePaymentNoticeV2', count: ok.activatePaymentNoticeV2, tone: 'v2' },
      ]),
      outcome: stack(spo.total, [
        { label: 'sendPaymentOutcome', count: spo.sendPaymentOutcome, tone: 'v1' },
        { label: 'sendPaymentOutcomeV2', count: spo.sendPaymentOutcomeV2, tone: 'v2' },
      ]),
    };
  });
  readonly format = (value: string | null): string => formatInstant(value, this.timezone.zone());

  ngOnInit(): void {
    this.loadCatalog();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.timeWindow.set(readTimeWindow(params));
      this.filters.set({
        serviceIdentifier: params.get('serviceIdentifier') ?? '',
        psp: params.get('psp') ?? '',
        canale: params.get('canale') ?? '',
        stazione: params.get('stazione') ?? '',
      });
      this.load();
    });
  }

  updateFromEvent(key: Dimension, event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { [key]: target.value.trim() || null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  retryCatalog(): void {
    if (!this.catalogLoading() && this.catalogError()) this.loadCatalog();
  }

  /** Reloads the current selection; a preset range moves forward to "now". */
  load(): void {
    this.subscription?.unsubscribe();
    this.data.set(null);
    this.error.set(null);
    const window = resolveTimeWindow(this.timeWindow());
    if (!window.bounds) {
      this.loading.set(false);
      this.error.set(window.error);
      return;
    }
    this.loading.set(true);
    const filters: Filters = {
      ...window.bounds,
      ...(this.timeWindow().range === 'custom' ? {} : { live: 'true' }),
      ...this.filters(),
    };
    this.subscription = this.api.activationsOutcomes(filters).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: value => {
        this.data.set(value);
        this.loading.set(false);
      },
      error: (failure: unknown) => {
        this.loading.set(false);
        this.error.set(this.message(failure));
      },
    });
  }

  private message(failure: unknown): string {
    if (!(failure instanceof HttpErrorResponse)) return 'Risposta del servizio non valida. Riprova.';
    switch (failure.status) {
      case 0: return 'Servizio non raggiungibile. Verifica che il backend sia attivo e riprova.';
      case 400: return 'Filtri non supportati da questa vista. Sono ammessi solo intervallo, ServiceIdentifier, PSP, Canale e Stazione.';
      case 403: return 'Vista non disponibile per utenti con visibilità ristretta a un ente creditore.';
      default: return `Caricamento non riuscito (HTTP ${failure.status}).`;
    }
  }

  private loadCatalog(): void {
    this.catalogLoading.set(true);
    this.catalogLoaded.set(false);
    this.api.catalogWithServiceIdentifiers().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: catalog => {
        this.serviceIdentifiers.set(catalog.serviceIdentifiers);
        this.catalogLoaded.set(true);
        this.catalogError.set(null);
        this.catalogLoading.set(false);
      },
      error: () => {
        this.catalogError.set('Impossibile caricare l’elenco degli identificativi di servizio. Riprova.');
        this.catalogLoading.set(false);
      },
    });
  }
}
