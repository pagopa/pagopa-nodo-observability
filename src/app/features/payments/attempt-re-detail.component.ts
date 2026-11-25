import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { rxResource } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { map, of, takeUntil } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import {
  isReWindow,
  isUtcInstant,
  RE_FIELDS,
  ReEventsRequest,
  ReWindow,
} from '../../models/re-event';

export interface AttemptReDialogData {
  attemptId: string;
  paFiscalCode: string;
  noticeNumber: string;
  paymentToken: string;
  suggestedWindow: (ReWindow & { segmented: boolean }) | null;
}

@Component({
  selector: 'app-attempt-re-detail',
  imports: [MatDialogModule],
  templateUrl: './attempt-re-detail.component.html',
  styleUrl: './attempt-re-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttemptReDetailComponent {
  readonly data = inject<AttemptReDialogData>(MAT_DIALOG_DATA);
  readonly dialog = inject(MatDialogRef<AttemptReDetailComponent>);
  private readonly api = inject(ObservabilityApi);
  readonly from = signal(this.data.suggestedWindow?.from.slice(0, -1) ?? '');
  readonly to = signal(this.data.suggestedWindow?.to.slice(0, -1) ?? '');
  readonly validationError = signal<string | null>(null);
  private readonly request = signal<{
    body: ReEventsRequest;
    page: number;
    expectedWindow?: ReWindow;
    previousCursors: string[];
  } | null>(null);
  readonly page = computed(() => this.request()?.page ?? 1);
  readonly check = rxResource({
    params: () => this.request(),
    stream: ({ params }) =>
      !params
        ? of(null)
        : this.api.reEvents(this.data.attemptId, params.body).pipe(
            takeUntil(this.dialog.beforeClosed()),
            map((result) => {
              if (
                result.events.some(
                  (event) =>
                    event.idDominio !== this.data.paFiscalCode ||
                    event.noticeNumber !== this.data.noticeNumber ||
                    event.paymentToken !== this.data.paymentToken,
                ) ||
                (params.expectedWindow &&
                  (result.window.from !== params.expectedWindow.from ||
                    result.window.to !== params.expectedWindow.to)) ||
                (result.nextCursor && params.previousCursors.includes(result.nextCursor))
              ) {
                throw new Error('Risposta RE riferita a un contesto o a una pagina non validi.');
              }
              return result;
            }),
          ),
  });
  readonly result = computed(() => (this.check.hasValue() ? this.check.value() : null));
  readonly selectedIndex = linkedSignal({ source: this.result, computation: () => 0 });
  readonly selected = computed(() => this.result()?.events[this.selectedIndex()] ?? null);
  readonly fields = computed(() => {
    const event = this.selected();
    return event
      ? RE_FIELDS.map((name) => ({
          name,
          value: event[name] === null ? 'null' : String(event[name]),
        }))
      : [];
  });
  readonly payloadMessage = computed(() => {
    switch (this.selected()?.payloadDecoded.status) {
      case 'ABSENT':
        return 'Payload assente (null).';
      case 'INVALID_BASE64':
        return 'Base64 non valido: il valore sorgente resta nei campi RE.';
      case 'INVALID_UTF8':
        return 'UTF-8 non valido: il payload non contiene testo UTF-8 leggibile.';
      case 'TOO_LARGE':
        return 'Limite dimensione superato: payload e Base64 sorgente omessi esplicitamente.';
      default:
        return null;
    }
  });
  readonly error = computed(() => {
    const error = this.check.error();
    if (!error) return null;
    if (!(error instanceof HttpErrorResponse))
      return error instanceof Error ? error.message : 'Risposta RE non valida.';
    switch (error.status) {
      case 400:
        return 'Intervallo o cursore non valido. Avvia un nuovo recupero.';
      case 404:
        return 'Tentativo non disponibile; nessuna scansione alternativa RE è stata avviata.';
      case 410:
        return 'Tentativo scaduto per retention; nessuna scansione alternativa RE è stata avviata.';
      case 429:
        return 'Limite richieste RE raggiunto. Attendi prima di riprovare.';
      case 502:
        return 'Sorgente RE o contratto ADX non disponibile.';
      case 503:
        return 'Consultazione RE non configurata o non ancora abilitata dopo le verifiche ADX.';
      case 504:
        return 'Tempo massimo della richiesta RE superato.';
      default:
        return `Recupero RE non disponibile (HTTP ${error.status}).`;
    }
  });

  changeFrom(value: string): void {
    this.from.set(value);
    this.reset();
  }
  changeTo(value: string): void {
    this.to.set(value);
    this.reset();
  }

  retrieve(): void {
    const utcInput = (value: string): string => {
      const normalized = value.length === 16 ? `${value}:00Z` : `${value}Z`;
      return isUtcInstant(normalized) ? new Date(normalized).toISOString() : normalized;
    };
    const body = { from: utcInput(this.from()), to: utcInput(this.to()) };
    if (!isReWindow(body)) {
      this.reset();
      this.validationError.set(
        'Intervallo UTC non valido: Da deve precedere A; massimo 24 ore per richiesta.',
      );
      return;
    }
    this.validationError.set(null);
    this.request.set({ body, page: 1, previousCursors: [] });
  }

  nextPage(): void {
    const result = this.result();
    const request = this.request();
    if (!result?.nextCursor || !request || this.check.isLoading()) return;
    this.request.set({
      body: { ...request.body, cursor: result.nextCursor },
      page: request.page + 1,
      expectedWindow: result.window,
      previousCursors: [...request.previousCursors, result.nextCursor],
    });
  }

  private reset(): void {
    this.request.set(null);
    this.validationError.set(null);
  }
}
