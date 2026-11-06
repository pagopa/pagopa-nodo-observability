import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { rxResource } from '@angular/core/rxjs-interop';
import { map, of } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { formatInstant } from '../../models/domain';

@Component({
  selector: 'app-attempt-db-check',
  templateUrl: './attempt-db-check.component.html',
  styleUrl: './attempt-db-check.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttemptDbCheckComponent {
  readonly attemptId = input.required<string>();
  readonly paFiscalCode = input.required<string>();
  readonly noticeNumber = input.required<string>();
  readonly serviceIdentifier = input.required<string | null>();
  readonly projectionRevision = input.required<number>();
  private readonly api = inject(ObservabilityApi);
  private readonly timezone = inject(TimezoneService);
  private readonly context = computed(() => ({
    attemptId: this.attemptId(),
    paFiscalCode: this.paFiscalCode(),
    noticeNumber: this.noticeNumber(),
    serviceIdentifier: this.serviceIdentifier(),
  }));
  private readonly requested = linkedSignal({
    source: this.context,
    computation: () => false,
  });
  readonly check = rxResource({
    // A defined idle request also cancels an in-flight load when the context changes.
    params: () => ({ ...this.context(), requested: this.requested() }),
    stream: ({ params }) =>
      !params.requested
        ? of(null)
        : this.api.checkDb(params.attemptId).pipe(
            map((result) => {
              if (
                result.attemptId !== params.attemptId ||
                result.paFiscalCode !== params.paFiscalCode ||
                result.noticeNumber !== params.noticeNumber ||
                result.serviceIdentifier !== params.serviceIdentifier
              ) {
                throw new Error('Risposta Check DB riferita a un contesto diverso dal tentativo.');
              }
              return result;
            }),
          ),
  });
  readonly result = computed(() => (this.check.hasValue() ? this.check.value() : null));
  readonly stale = computed(() => {
    const result = this.result();
    return result !== null && result.projectionRevision !== this.projectionRevision();
  });
  readonly checkedAt = computed(() =>
    formatInstant(this.result()?.checkedAt ?? null, this.timezone.zone()),
  );
  readonly rows = computed(() => {
    const result = this.result();
    return result
      ? [
          this.row('Pagamento', result.observed.logicalState, result.database.logicalState),
          this.row('Tentativo', result.observed.attemptState, result.database.attemptState),
        ]
      : [];
  });
  readonly error = computed(() => {
    const error = this.check.error();
    if (!error) return null;
    if (!(error instanceof HttpErrorResponse)) {
      return error instanceof Error ? error.message : 'Risposta Check DB non valida.';
    }
    switch (error.status) {
      case 0:
        return 'Servizio Check DB non raggiungibile.';
      case 401:
      case 403:
        return 'Il server non autorizza il controllo del tentativo.';
      case 404:
        return 'Tentativo non disponibile: potrebbe essere scaduto per retention.';
      case 422:
        return 'Controllo non verificabile: serviceIdentifier assente o database non configurato per il servizio.';
      case 503:
        return 'Database nodo-online non disponibile. Riprovare il controllo.';
      default:
        return `Controllo Check DB non disponibile (HTTP ${error.status}).`;
    }
  });

  runCheck(): void {
    if (this.check.isLoading() || !this.serviceIdentifier()?.trim()) return;
    if (this.requested()) this.check.reload();
    else this.requested.set(true);
  }

  private row(entity: string, observed: string, database: string | null) {
    return {
      entity,
      observed,
      database,
      outcome:
        database === null
          ? 'Non verificabile'
          : observed === database
            ? 'Coincidente'
            : 'Discordante',
      icon: database === null ? '?' : observed === database ? '✓' : '⚠',
    };
  }
}
