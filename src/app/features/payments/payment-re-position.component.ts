import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { buildChronology } from '../../models/re-chronology';
import { ReEventsResponse, ReWindow } from '../../models/re-event';
import { loadReChronology, ReChronology } from './re-chronology-loader';
import { ReChronologyTableComponent } from './re-chronology-table.component';

/**
 * Consultation of the whole position (PA + NAV, no token): it is the only place where calls without a
 * paymentToken, such as verifyPaymentNotice, are shown. It runs on request, never automatically.
 */
@Component({
  selector: 'app-payment-re-position',
  imports: [ReChronologyTableComponent],
  templateUrl: './payment-re-position.component.html',
  styleUrl: './payment-re-position.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentRePositionComponent {
  readonly paFiscalCode = input.required<string>();
  readonly noticeNumber = input.required<string>();
  /** Attempt used to resolve and authorize the position server-side. */
  readonly attemptId = input.required<string>();
  readonly window = input.required<ReWindow | null>();
  private readonly api = inject(ObservabilityApi);
  /** Bumped per request so a repeated click reloads; the key pins the pair the request belongs to. */
  private readonly requestedKey = signal<string | null>(null);
  private readonly key = computed(() => `${this.paFiscalCode()}/${this.noticeNumber()}`);
  private readonly count = signal(0);
  private readonly windowAvailable = computed(() => this.window() !== null);
  readonly check = rxResource({
    // The window moves with the clock of the parent: read untracked, only a click reloads.
    params: () => ({
      key: this.key(),
      requested: this.requestedKey() === this.key(),
      attemptId: this.attemptId(),
      ready: this.windowAvailable(),
      count: this.count(),
    }),
    stream: ({ params }) => {
      const window = untracked(this.window);
      return !params.requested || !params.ready || !window
        ? of(undefined)
        : loadReChronology(this.api, params.attemptId, window, 'POSITION', (page) =>
            this.accept(page),
          );
    },
  });
  readonly result = computed<ReChronology | null>(() =>
    this.check.hasValue() ? (this.check.value() ?? null) : null,
  );
  readonly rows = computed(() => buildChronology(this.result()?.events ?? []));
  readonly tokenless = computed(() => this.rows().filter((row) => !row.event.paymentToken));
  readonly tokens = computed(
    () => new Set(this.rows().flatMap((row) => (row.event.paymentToken ? [row.event.paymentToken] : []))),
  );
  readonly koRows = computed(() => this.rows().filter((row) => row.outcome === 'KO'));
  readonly canConsult = computed(() => !this.check.isLoading() && this.windowAvailable());
  readonly error = computed(() => {
    const error = this.check.error();
    if (!error) return null;
    if (!(error instanceof HttpErrorResponse))
      return error instanceof Error ? error.message : 'Risposta RE non valida.';
    switch (error.status) {
      case 0:
        return 'Sorgente RE non raggiungibile.';
      case 404:
        return 'Posizione non disponibile per la consultazione RE.';
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

  consult(): void {
    if (!this.canConsult()) return;
    this.requestedKey.set(this.key());
    this.count.update((value) => value + 1);
  }

  private accept(page: ReEventsResponse): void {
    if (
      page.events.some(
        (event) =>
          event.idDominio !== this.paFiscalCode() || event.noticeNumber !== this.noticeNumber(),
      )
    ) {
      throw new Error('Risposta RE riferita a una posizione diversa.');
    }
  }
}
