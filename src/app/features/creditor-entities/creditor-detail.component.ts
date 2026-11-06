import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest, skip, Subscription } from 'rxjs';
import { EventScope, ObservabilityApi, StreamHttpError } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { applyAggregateRows } from '../../core/realtime/aggregate-rows';
import { TimezoneService } from '../../core/timezone.service';
import { CountRow, formatInstant, isUnresolvedState, Overview, Station } from '../../models/domain';
import { positiveStateCounts, statePresentation } from '../../models/state-presentation';
import { StateBadgeComponent } from '../../shared/state-badge/state-badge.component';
import { readTimeWindow, resolveTimeWindow, TimeWindowSelection } from '../../models/time-window';
import { TimeWindowComponent } from '../../shared/time-window/time-window.component';

interface CreditorDelta {
  type: 'ready' | 'aggregate.delta';
  projectionRevision: number;
  freshness?: Overview['freshness'];
  changes?: {
    counts: Record<string, number>;
    logicalStates: CountRow[];
    attemptStates: CountRow[];
    recipientStates?: CountRow[];
    traffic: Overview['traffic'];
    transitions: Overview['transitions'];
    matrices: {
      psp: { value: string | null; state: string; count: number }[];
      canale: { value: string | null; state: string; count: number }[];
      recipient?: { value: string | null; state: string; count: number }[];
    };
    anomalies: { transitions: number; payments: number };
    durationSnapshot: Overview['durations'];
  };
}

@Component({
  selector: 'app-creditor-detail',
  imports: [DecimalPipe, RouterLink, TimeWindowComponent, StateBadgeComponent],
  templateUrl: './creditor-detail.component.html',
  styleUrl: './creditor-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreditorDetailComponent implements OnInit {
  readonly route = inject(ActivatedRoute);
  private readonly api = inject(ObservabilityApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(SessionService);
  readonly timezone = inject(TimezoneService);
  readonly paFiscalCode = signal('');
  readonly snapshot = signal<Overview | null>(null);
  readonly stations = signal<Station[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly stationError = signal<string | null>(null);
  readonly connection = signal('Connessione in attesa');
  readonly stationResultsChanged = signal(false);
  readonly timeWindow = signal<TimeWindowSelection>({ range: '1h', from: '', to: '' });
  readonly range = computed(() => this.timeWindow().range);
  readonly nextCursor = signal<string | null>(null);
  readonly hasPrevious = signal(false);
  private readonly tokenChanges = toObservable(this.session.token);
  readonly presentation = statePresentation;
  readonly stateCounts = positiveStateCounts;
  readonly recipientsAvailable = computed(() => Array.isArray(this.snapshot()?.recipientStates));
  readonly isUnresolved = isUnresolvedState;
  readonly format = (value: string | null): string => formatInstant(value, this.timezone.zone());
  readonly maxStation = (): number => Math.max(1, ...this.stations().map(station => station.startedAttempts));
  readonly maxLogical = (): number => Math.max(1, ...(this.snapshot()?.logicalStates.map(row => row.count) ?? []));
  readonly maxRecipients = (): number => Math.max(1, ...(this.snapshot()?.recipientStates.map(row => row.count) ?? []));
  private stream?: Subscription;
  private snapshotRequest?: Subscription;
  private stationRequest?: Subscription;
  private stationCursors: (string | null)[] = [null];
  private revision = 0;
  private from = '';
  private to = '';
  private filters: Record<string, string> = {};
  private resyncing = false;
  private snapshotAcquiring = false;
  private snapshotInitialized = false;
  private readonly pending: CreditorDelta[] = [];

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(([params, query]) => {
      this.paFiscalCode.set(params.get('paFiscalCode') ?? '');
      this.timeWindow.set(readTimeWindow(query));
      this.filters = {
        ...(query.get('logicalState') ? { logicalState: query.get('logicalState') ?? '' } : {}),
        ...(query.get('attemptState') ? { attemptState: query.get('attemptState') ?? '' } : {}),
        ...(query.get('serviceIdentifier') ? { serviceIdentifier: query.get('serviceIdentifier') ?? '' } : {}),
        ...(query.get('psp') ? { psp: query.get('psp') ?? '' } : {}),
        ...(query.get('canale') ? { canale: query.get('canale') ?? '' } : {}),
        ...(query.get('unresolvedOnly') ? { unresolvedOnly: query.get('unresolvedOnly') ?? '' } : {}),
        ...(query.get('anomaliesOnly') ? { anomaliesOnly: query.get('anomaliesOnly') ?? '' } : {}),
      };
      this.stationCursors = [null];
      this.hasPrevious.set(false);
      this.openStream();
    });
    this.tokenChanges.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.openStream());
  }

  paymentListParams(extra: Record<string, string> = {}): Record<string, string> {
    return this.listContext({ paFiscalCode: this.paFiscalCode(), ...extra });
  }

  attemptListParams(extra: Record<string, string> = {}): Record<string, string> {
    return this.listContext({ paFiscalCode: this.paFiscalCode(), view: 'attempts', ...extra });
  }

  private listContext(overrides: Record<string, string>): Record<string, string> {
    const allowed = ['window', 'logicalState', 'attemptState', 'noticeNumber', 'serviceIdentifier', 'psp', 'canale', 'stazione', 'unresolvedOnly', 'anomaliesOnly', 'sort'];
    const query = this.route.snapshot.queryParams as Record<string, unknown>;
    const context = Object.fromEntries(allowed.flatMap(key => {
      const value = query[key];
      return typeof value === 'string' && value.length > 0 ? [[key, value]] : [];
    }));
    return {
      ...context,
      ...(this.range() === 'custom' ? { window: 'custom', from: this.timeWindow().from, to: this.timeWindow().to } : {}),
      ...overrides,
    };
  }

  stationPage(next: boolean): void {
    if (next) {
      const cursor = this.nextCursor();
      if (!cursor) return;
      this.stationCursors.push(cursor);
      this.hasPrevious.set(true);
    } else if (this.stationCursors.length > 1) {
      this.stationCursors.pop();
      this.hasPrevious.set(this.stationCursors.length > 1);
    } else return;
    this.loadStations();
  }

  reloadStations(): void {
    this.stationCursors = [null];
    this.stationResultsChanged.set(false);
    this.loadStations();
  }

  retry(): void {
    this.error.set(null);
    this.openStream();
  }

  private openStream(): void {
    this.stream?.unsubscribe();
    this.snapshotRequest?.unsubscribe();
    this.stationRequest?.unsubscribe();
    this.stations.set([]);
    this.nextCursor.set(null);
    this.stationError.set(null);
    this.snapshot.set(null);
    this.pending.length = 0;
    this.snapshotAcquiring = false;
    this.snapshotInitialized = false;
    this.resyncing = false;
    this.stationResultsChanged.set(false);
    this.loading.set(true);
    this.error.set(null);
    const result = resolveTimeWindow(this.timeWindow());
    if (!result.bounds) {
      this.error.set(result.error);
      this.loading.set(false);
      this.connection.set('Intervallo non valido');
      return;
    }
    this.from = result.bounds.from;
    this.to = result.bounds.to;
    const scope: EventScope = {
      scope: 'creditor',
      paFiscalCode: this.paFiscalCode(),
      ...this.filters,
      from: this.from,
      to: this.to,
    };
    this.stream = this.api.connect(scope).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: event => {
        if (event.type === 'connection-error') {
          this.connection.set('Connessione interrotta; riconnessione in corso');
          if (!this.snapshotInitialized && !this.snapshotAcquiring) {
            this.loading.set(false);
            const status = this.connectionStatus(event);
            this.error.set(status === null ? 'Stream di aggiornamento non disponibile. Riprova la connessione.'
              : status === 401 ? 'Sessione non autenticata per questa vista.'
                : status === 403 ? 'Sessione non autorizzata a consultare questo ente.'
                  : status === 404 ? 'Ente creditore non disponibile per questa sessione.'
                    : status === 422 ? 'La combinazione di filtri non è supportata negli aggregati. Passa all’elenco tentativi.'
                      : `Servizio di aggiornamento non disponibile (HTTP ${status}).`);
          }
          return;
        }
        if (event.type === 'replay-expired') {
          this.connection.set('Replay scaduto; riallineamento dello snapshot in corso');
          this.resync();
          return;
        }
        const data = JSON.parse(event.data) as CreditorDelta;
        if (data.type === 'ready') {
          this.connection.set('Stream attivo');
          if (!this.snapshotInitialized && !this.snapshotAcquiring) this.loadSnapshot();
        } else if (this.snapshotAcquiring || !this.snapshotInitialized) {
          this.pending.push(data);
        } else {
          this.applyDelta(data);
        }
      },
      error: (failure: unknown) => {
        this.connection.set('Stream non disponibile');
        if (failure instanceof StreamHttpError) {
          this.loading.set(false);
          this.error.set(failure.status === 401 ? 'Sessione non autenticata per questa vista.'
            : failure.status === 403 ? 'Sessione non autorizzata a consultare questo ente.'
              : failure.status === 404 ? 'Ente creditore non disponibile per questa sessione.'
                : failure.status === 422 ? 'La combinazione di filtri non è supportata negli aggregati. Passa all’elenco tentativi.'
                  : failure.status >= 500 ? `Servizio di aggiornamento non disponibile (HTTP ${failure.status}).`
                    : `Stream non disponibile (HTTP ${failure.status}).`);
          return;
        }
        this.loadSnapshot();
      },
    });
  }

  private loadSnapshot(): void {
    if (this.snapshotAcquiring) return;
    const query = { ...this.filters, from: this.from, to: this.to };
    this.snapshotAcquiring = true;
    this.loading.set(true);
    this.snapshotRequest?.unsubscribe();
    this.snapshotRequest = this.api.creditor(this.paFiscalCode(), query).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: value => {
        this.snapshot.set(value);
        this.revision = value.projectionRevision;
        this.loading.set(false);
        this.error.set(null);
        this.resyncing = false;
        this.snapshotInitialized = true;
        this.snapshotAcquiring = false;
        this.reconcilePending();
        this.loadStations();
      },
      error: (failure: HttpErrorResponse) => {
        this.snapshotAcquiring = false;
        this.loading.set(false);
        this.resyncing = false;
        this.error.set(failure.status === 404 ? 'Ente creditore non disponibile per questa sessione.'
          : failure.status === 422 ? 'La combinazione di filtri non è supportata negli aggregati. Passa all’elenco tentativi.'
            : failure.status === 0 ? 'Servizio non raggiungibile. Verifica che il backend sia attivo e riprova.' : `Dettaglio ente non disponibile (HTTP ${failure.status}).`);
      },
    });
  }

  private loadStations(): void {
    this.stationRequest?.unsubscribe();
    this.stationError.set(null);
    this.stationRequest = this.api.stations(this.paFiscalCode(), {
      ...this.filters,
      from: this.from,
      to: this.to,
      pageSize: '20',
      cursor: this.stationCursors.at(-1) ?? undefined,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: page => {
        this.stations.set(page.items);
        this.nextCursor.set(page.nextCursor);
        this.stationError.set(null);
      },
      error: (failure: HttpErrorResponse) => {
        if (failure.status === 410) {
          this.stationCursors = [null];
          this.hasPrevious.set(false);
          this.stationError.set('La pagina delle stazioni è scaduta. Ricarica la prima pagina.');
        } else {
          this.stationError.set(failure.status === 0 ? 'Elenco stazioni non raggiungibile.' : `Stazioni non disponibili (HTTP ${failure.status}).`);
        }
      },
    });
  }

  private applyDelta(event: CreditorDelta): void {
    const current = this.snapshot();
    const changes = event.changes;
    if (!current || !changes || event.projectionRevision <= this.revision) return;
    if (event.projectionRevision !== this.revision + 1) {
      this.pending.push(event);
      if (!this.resyncing) {
        this.resyncing = true;
        this.loadSnapshot();
      }
      return;
    }
    const psp = this.adjustMatrix(current.matrices.psp, changes.matrices.psp);
    const canale = this.adjustMatrix(current.matrices.canale, changes.matrices.canale);
    const recipient = this.adjustMatrix(current.matrices.recipient, changes.matrices.recipient ?? []);
    this.snapshot.set({
      ...current,
      projectionRevision: event.projectionRevision,
      counts: {
        payments: current.counts.payments + (changes.counts['payments'] ?? 0),
        attempts: current.counts.attempts + (changes.counts['attempts'] ?? 0),
      },
      unresolved: {
        payments: current.unresolved.payments + (changes.counts['unresolvedPayments'] ?? 0),
        attempts: current.unresolved.attempts + (changes.counts['unresolvedAttempts'] ?? 0),
      },
      logicalStates: this.adjustStates(current.logicalStates, changes.logicalStates),
      attemptStates: this.adjustStates(current.attemptStates, changes.attemptStates),
      recipientStates: this.adjustStates(current.recipientStates, changes.recipientStates ?? []),
      traffic: this.adjustRows(current.traffic, changes.traffic, ['bucketStart'], ['startedAttempts', 'estimatedStarts']),
      transitions: this.adjustRows(current.transitions, changes.transitions, ['bucketStart', 'entity', 'state', 'timestampBasis'], ['count']),
      matrices: { psp, canale, recipient },
      anomalies: {
        transitions: current.anomalies.transitions + changes.anomalies.transitions,
        payments: current.anomalies.payments + changes.anomalies.payments,
      },
      durations: changes.durationSnapshot,
      freshness: event.freshness ?? current.freshness,
    });
    this.revision = event.projectionRevision;
    this.stationResultsChanged.set(true);
  }

  private resync(): void {
    if (this.resyncing || this.snapshotAcquiring) return;
    this.resyncing = true;
    this.loadSnapshot();
  }

  private reconcilePending(): void {
    const pending = this.pending.splice(0);
    for (let index = 0; index < pending.length; index++) {
      const delta = pending[index];
      if (delta.projectionRevision > this.revision) this.applyDelta(delta);
      if (this.snapshotAcquiring) {
        this.pending.push(...pending.slice(index + 1));
        return;
      }
    }
  }

  private connectionStatus(event: MessageEvent<string>): number | null {
    try {
      const data = JSON.parse(event.data) as { status?: unknown };
      return typeof data.status === 'number' ? data.status : null;
    } catch {
      return null;
    }
  }

  private adjustStates(current: CountRow[], delta: CountRow[]): CountRow[] {
    return applyAggregateRows(current, delta, ['state'], ['count'], true);
  }

  private adjustMatrix(current: Overview['matrices']['psp'], delta: { value: string | null; state: string; count: number }[]) {
    const rows = current.flatMap(row => row.states.map(state => ({ value: row.value, ...state })));
    const next = this.adjustRows(rows, delta, ['value', 'state'], ['count']);
    const grouped = new Map<string | null, CountRow[]>();
    for (const row of next) grouped.set(row.value, [...(grouped.get(row.value) ?? []), { state: row.state, count: row.count }]);
    return [...grouped].map(([value, states]) => ({ value, states }));
  }

  private adjustRows<T extends object>(current: T[], deltas: Record<string, unknown>[], keys: string[], numbers: string[]): T[] {
    return applyAggregateRows(
      current,
      deltas as (Partial<T> & Record<string, unknown>)[],
      keys as (keyof T)[],
      numbers as (keyof T)[],
    );
  }
}
