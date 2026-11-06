import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { buildChronology, ChronologyRow, formatEventTime } from '../../models/re-chronology';
import { TimezoneService } from '../../core/timezone.service';
import { ReEvent, ReEventsResponse, ReWindow } from '../../models/re-event';
import { loadReChronology, ReChronology } from './re-chronology-loader';
import { ReChronologyTableComponent } from './re-chronology-table.component';

@Component({
  selector: 'app-attempt-re-trace',
  imports: [ReChronologyTableComponent],
  templateUrl: './attempt-re-trace.component.html',
  styleUrl: './attempt-re-trace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttemptReTraceComponent {
  readonly attemptId = input.required<string>();
  readonly paFiscalCode = input.required<string>();
  readonly noticeNumber = input.required<string>();
  readonly paymentToken = input.required<string>();
  readonly suggestedWindow = input.required<ReWindow | null>();
  /** Reloads the chronology when the projection of the pair changes (new state, new event). */
  readonly projectionRevision = input<number>(0);
  private readonly api = inject(ObservabilityApi);
  private readonly timezone = inject(TimezoneService);
  private readonly refreshes = signal(0);
  private readonly tokenAvailable = computed(
    () => !!this.paymentToken().trim() && !this.paymentToken().includes('•'),
  );
  private readonly windowAvailable = computed(() => this.suggestedWindow() !== null);

  readonly check = rxResource({
    // The window is deliberately read untracked: it moves with the clock, the trigger must not.
    params: () => ({
      attemptId: this.attemptId(),
      paFiscalCode: this.paFiscalCode(),
      noticeNumber: this.noticeNumber(),
      paymentToken: this.paymentToken(),
      revision: this.projectionRevision(),
      refresh: this.refreshes(),
      ready: this.tokenAvailable() && this.windowAvailable(),
    }),
    stream: ({ params }) => {
      const window = untracked(this.suggestedWindow);
      return !params.ready || !window
        ? of(undefined)
        : loadReChronology(this.api, params.attemptId, window, 'ATTEMPT', (page) =>
            this.accept(page, params),
          );
    },
  });
  /** Keeps the previous chronology on screen while a newer one is being fetched. */
  readonly result = linkedSignal<ReChronology | undefined, ReChronology | null>({
    source: () => (this.check.hasValue() ? this.check.value() : undefined),
    computation: (value, previous) => value ?? previous?.value ?? null,
  });
  readonly rows = computed<readonly ChronologyRow[]>(() =>
    buildChronology(this.result()?.events ?? []),
  );
  readonly koRows = computed(() => this.rows().filter((row) => row.outcome === 'KO'));
  /** Repeated KO answers (e.g. the same paSendRTV2 retried) collapse into one entry with a count. */
  readonly koGroups = computed(() => {
    const groups = new Map<string, { id: number; primitive: string; label: string | null; count: number }>();
    for (const row of this.koRows()) {
      const key = `${row.primitive}|${row.koLabel ?? ''}`;
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { id: row.id, primitive: row.primitive, label: row.koLabel, count: 1 });
    }
    return [...groups.values()];
  });
  readonly lastRow = computed(() => this.rows().at(-1) ?? null);
  readonly unansweredRows = computed(() => this.rows().filter((row) => row.unanswered));
  readonly canRefresh = computed(() => !this.check.isLoading() && this.tokenAvailable() && this.windowAvailable());
  readonly error = computed(() => {
    const error = this.check.error();
    if (!error) return null;
    if (!(error instanceof HttpErrorResponse))
      return error instanceof Error ? error.message : 'Risposta RE non valida.';
    switch (error.status) {
      case 0:
        return 'Sorgente RE non raggiungibile.';
      case 404:
        return 'Tentativo non disponibile per la consultazione RE.';
      case 410:
        return 'Tentativo scaduto per retention RE.';
      case 429:
        return 'Limite richieste RE raggiunto. Attendi prima di riprovare.';
      case 502:
        return 'Sorgente RE o contratto non disponibile.';
      case 503:
        return 'Consultazione RE non configurata o non abilitata.';
      case 504:
        return 'Tempo massimo della richiesta RE superato.';
      default:
        return `Cronologia RE non disponibile (HTTP ${error.status}).`;
    }
  });

  private accept(
    page: ReEventsResponse,
    context: { paFiscalCode: string; noticeNumber: string; paymentToken: string },
  ): void {
    if (
      page.events.some(
        (event) =>
          event.idDominio !== context.paFiscalCode ||
          event.noticeNumber !== context.noticeNumber ||
          event.paymentToken !== context.paymentToken,
      )
    ) {
      throw new Error('Risposta RE riferita a un contesto diverso dal tentativo.');
    }
  }

  displayTime(event: ReEvent): string {
    return formatEventTime(event, this.timezone.zone());
  }

  refresh(): void {
    if (this.canRefresh()) this.refreshes.update((value) => value + 1);
  }

}
