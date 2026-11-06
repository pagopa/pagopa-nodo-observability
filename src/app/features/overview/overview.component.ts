import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, linkedSignal, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { Filters, ObservabilityApi, StreamHttpError } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { applyAggregateRows } from '../../core/realtime/aggregate-rows';
import { TimezoneService } from '../../core/timezone.service';
import { ATTEMPT_STATES, AttemptState, formatInstant, isUnresolvedState, Overview, PRIMITIVE_DIRECTIONS, PRIMITIVE_RESPONSE_BUDGET_SECONDS, PrimitiveCount, PrimitiveDirection, RECIPIENT_STATES } from '../../models/domain';
import { primitiveNature, primitiveNatureTotals, PRIMITIVE_NATURES } from '../../models/primitive-nature';
import { stateFilterGroups, statePresentation } from '../../models/state-presentation';
import { PieChartComponent, PieSlice } from '../../shared/pie-chart/pie-chart.component';
import { StateBadgeComponent } from '../../shared/state-badge/state-badge.component';
import { readTimeWindow, resolveTimeWindow, TimeWindowSelection } from '../../models/time-window';
import { TimeWindowComponent } from '../../shared/time-window/time-window.component';
import { skip, Subscription } from 'rxjs';
import { NodeServicesComponent } from './node-services.component';
import { PrimitiveWarningsComponent } from './primitive-warnings.component';

// Key of the service row without a serviceIdentifier (null in the contract).
const NO_SERVICE_KEY = '~unknown';

const ATTEMPT_STATE_PRIORITY: readonly AttemptState[] = [
  'PAYING', 'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_ACCEPTED',
  'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR', 'PAYMENT_REFUSED', 'PAID', 'CANCELLED', 'NOTIFIED',
  'PAYING_RPT', 'PAID_NORPT', 'NOTICE_GENERATED', 'NOTICE_STORED', 'NOTICE_SENT',
  'CANCELLED_NORPT', 'FAILED', 'FAILED_NORPT',
];

const UNRESOLVED_MATRIX_STATES = [
  'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR',
] as const satisfies readonly AttemptState[];

interface AggregateEvent {
  type: 'ready' | 'aggregate.delta';
  projectionRevision: number;
  window?: { from: string; to: string };
  freshness?: Overview['freshness'];
  changes?: {
    counts: Record<string, number>;
    logicalStates: { state: string; count: number }[];
    attemptStates: { state: string; count: number }[];
    recipientStates?: { state: string; count: number }[];
    primitives?: PrimitiveCount[];
    traffic: { bucketStart: string; startedAttempts: number; estimatedStarts: number }[];
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
  selector: 'app-overview',
  imports: [DecimalPipe, RouterLink, TimeWindowComponent, MatTabNav, MatTabLink, MatTabNavPanel, StateBadgeComponent, PieChartComponent, PrimitiveWarningsComponent, NodeServicesComponent],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent implements OnInit {
  private readonly api = inject(ObservabilityApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(SessionService);
  readonly timezone = inject(TimezoneService);
  readonly overview = signal<Overview | null>(null);
  readonly recipientsAvailable = computed(() => Array.isArray(this.overview()?.recipientStates));
  readonly recipientMatrixAvailable = computed(() => Array.isArray(this.overview()?.matrices?.recipient));
  readonly presentation = statePresentation;
  readonly primitiveBudgetSeconds = PRIMITIVE_RESPONSE_BUDGET_SECONDS;
  readonly primitivesAvailable = computed(() => Array.isArray(this.overview()?.primitives));
  readonly primitiveTotals = computed(() => {
    const rows = this.overview()?.primitives ?? [];
    return rows.reduce(
      (total, row) => ({
        requests: total.requests + row.requests,
        responses: total.responses + row.responses,
        warnings: total.warnings + row.warnings,
      }),
      { requests: 0, responses: 0, warnings: 0 },
    );
  });
  readonly primitiveDirectionLabel = (direction: PrimitiveDirection): string =>
    PRIMITIVE_DIRECTIONS.find(info => info.direction === direction)?.label ?? '';
  readonly primitiveNatureTotals = computed(() => primitiveNatureTotals(this.overview()?.primitives ?? []));
  readonly primitiveNature = primitiveNature;
  readonly max = Math.max;
  readonly primitiveNatureLabel = (primitive: string): string =>
    PRIMITIVE_NATURES.find(info => info.nature === primitiveNature(primitive))?.label ?? '';
  readonly primitiveRows = computed(() => {
    const total = this.primitiveTotals().requests;
    const share = (requests: number, whole: number): number => whole ? requests / whole * 100 : 0;
    const services = new Map<string, {
      serviceIdentifier: string | null; requests: number; responses: number; warnings: number; primitives: PrimitiveCount[];
    }>();
    for (const row of this.overview()?.primitives ?? []) {
      const key = row.serviceIdentifier ?? NO_SERVICE_KEY;
      const service = services.get(key)
        ?? { serviceIdentifier: row.serviceIdentifier, requests: 0, responses: 0, warnings: 0, primitives: [] };
      service.requests += row.requests;
      service.responses += row.responses;
      service.warnings += row.warnings;
      service.primitives.push(row);
      services.set(key, service);
    }
    return [...services].map(([key, service]) => ({
      ...service,
      key,
      share: share(service.requests, total),
      details: [...service.primitives]
        .sort((a, b) => b.requests - a.requests || a.primitive.localeCompare(b.primitive) || a.direction.localeCompare(b.direction))
        .map(row => ({ ...row, share: share(row.requests, service.requests) })),
    })).sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key));
  });
  readonly expandedPrimitiveServices = signal<ReadonlySet<string>>(new Set());
  togglePrimitiveService(key: string): void {
    this.expandedPrimitiveServices.update(current => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  /** Primitives whose unanswered calls are listed, keyed by `primitiveWarningsKey`. */
  readonly expandedPrimitiveWarnings = signal<ReadonlySet<string>>(new Set());
  primitiveWarningsKey(serviceKey: string, primitive: string): string {
    return JSON.stringify([serviceKey, primitive]);
  }
  togglePrimitiveWarnings(serviceKey: string, primitive: string): void {
    const key = this.primitiveWarningsKey(serviceKey, primitive);
    this.expandedPrimitiveWarnings.update(current => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  /** Window and filters of the snapshot on screen, reused to list the calls behind a warning count. */
  readonly warningFilters = signal<Filters>({});
  readonly showAllPrimitiveRows = signal(false);
  readonly visiblePrimitiveRows = computed(() =>
    this.showAllPrimitiveRows() ? this.primitiveRows() : this.primitiveRows().slice(0, 10));
  readonly logicalGroups = computed(() => stateFilterGroups('logical', (this.overview()?.logicalStates ?? []).map(row => row.state)));
  readonly attemptGroups = computed(() => stateFilterGroups('attempt', (this.overview()?.attemptStates ?? []).map(row => row.state)));
  readonly showAllAttemptStates = signal(false);
  readonly matrixDimension = signal<'psp' | 'canale' | 'recipient'>('psp');
  readonly showAllMatrixRows = linkedSignal({
    source: this.matrixDimension,
    computation: () => false,
  });
  private matrixStates(): readonly string[] {
    return this.matrixDimension() === 'recipient' ? RECIPIENT_STATES : UNRESOLVED_MATRIX_STATES;
  }
  readonly matrixColumns = computed(() =>
    this.matrixStates().map(state => ({
      state,
      label: state,
      presentation: statePresentation(this.matrixDimension() === 'recipient' ? 'recipient' : 'attempt', state),
    })));
  readonly expandedMatrixRows = signal<ReadonlySet<string>>(new Set());
  matrixRowExpanded(value: string | null): boolean {
    return this.expandedMatrixRows().has(JSON.stringify([this.matrixDimension(), value]));
  }
  toggleMatrixRow(value: string | null): void {
    const key = JSON.stringify([this.matrixDimension(), value]);
    this.expandedMatrixRows.update(current => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  matrixDetailId(dimension: 'psp' | 'canale' | 'recipient', value: string | null): string {
    return `matrix-detail-${encodeURIComponent(JSON.stringify([dimension, value]))}`;
  }
  readonly matrixRows = computed(() => {
    const dimension = this.matrixDimension();
    const rows = this.overview()?.matrices[dimension] ?? [];
    if (dimension === 'recipient') {
      return rows.map(row => {
        const counts = new Map(row.states.map(item => [item.state, item.count]));
        return {
          value: row.value,
          stateCells: [],
          cells: RECIPIENT_STATES.map(state => ({ state, count: counts.get(state) ?? 0 })),
          total: row.states.reduce((total, item) => total + item.count, 0),
          unresolved: 0,
        };
      }).sort((a, b) => b.total - a.total);
    }

    return rows.map(row => {
      const counts = new Map(row.states.map(item => [item.state, item.count]));
      const stateCells = ATTEMPT_STATES.map(state => ({ state, count: counts.get(state) ?? 0 }));
      return {
        value: row.value,
        stateCells,
        total: stateCells.reduce((total, item) => total + item.count, 0),
        cells: UNRESOLVED_MATRIX_STATES.map(state => ({
          state,
          count: counts.get(state) ?? 0,
        })),
        unresolved: stateCells.reduce((total, item) =>
          total + (item.state === 'PAYMENT_UNKNOWN' || item.state === 'PAYMENT_SEND_ERROR' ? item.count : 0), 0),
      };
    }).sort((a, b) => {
      if (a.value === null) return b.value === null ? 0 : 1;
      if (b.value === null) return -1;
      return b.unresolved - a.unresolved || b.total - a.total ||
        (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
    });
  });
  readonly visibleMatrixRows = computed(() =>
    this.showAllMatrixRows() ? this.matrixRows() : this.matrixRows().slice(0, 10));
  readonly orderedAttemptStates = computed(() => {
    const rows = [...(this.overview()?.attemptStates ?? [])];
    for (const state of ATTEMPT_STATE_PRIORITY) {
      if (isUnresolvedState(state) && !rows.some(row => row.state === state)) {
        rows.push({ state, count: 0 });
      }
    }
    const priority = new Map<string, number>(ATTEMPT_STATE_PRIORITY.map((state, index) => [state, index]));
    return rows.sort((a, b) =>
      (priority.get(a.state) ?? priority.size) - (priority.get(b.state) ?? priority.size));
  });
  readonly visibleAttemptStates = computed(() =>
    this.showAllAttemptStates() ? this.orderedAttemptStates() : this.orderedAttemptStates().slice(0, 10));
  readonly transitionTrend = computed(() => {
    const buckets = new Map<number, { source: number; inferred: number }>();
    for (const row of this.overview()?.transitions ?? []) {
      if (row.timestampBasis !== 'SOURCE_EVENT' && row.timestampBasis !== 'INFERRED') continue;
      const instant = Date.parse(row.bucketStart);
      const bucket = buckets.get(instant) ?? { source: 0, inferred: 0 };
      if (row.timestampBasis === 'SOURCE_EVENT') bucket.source += row.count;
      else bucket.inferred += row.count;
      buckets.set(instant, bucket);
    }
    const rows = [...buckets].sort(([a], [b]) => a - b);
    const peak = Math.max(1, ...rows.map(([, row]) => row.source + row.inferred));
    const magnitude = 10 ** Math.floor(Math.log10(peak));
    const maximum = Math.ceil(peak / magnitude) * magnitude;
    const slotWidth = 844 / Math.max(1, rows.length);
    const daily = rows.length > 1 && rows.every(([instant], index) =>
      index === 0 || instant - rows[index - 1][0] >= 86_400_000);
    const timeZone = this.timezone.zone();
    const dayFormat = new Intl.DateTimeFormat('it-IT', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const spansDays = new Set(rows.map(([instant]) => dayFormat.format(instant))).size > 1;
    const axisOptions: Intl.DateTimeFormatOptions = {
      timeZone,
      ...(daily || spansDays ? { day: '2-digit', month: '2-digit' } : {}),
      ...(!daily ? { hour: '2-digit', minute: '2-digit' } : {}),
      ...(!daily && rows.some(([instant]) => instant % 60_000 !== 0) ? { second: '2-digit' } : {}),
    };
    let axisFormat = new Intl.DateTimeFormat('it-IT', axisOptions);
    const labels = rows.map(([instant]) => axisFormat.format(instant));
    if (new Set(labels).size < labels.length) {
      axisFormat = new Intl.DateTimeFormat('it-IT', { ...axisOptions, timeZoneName: 'shortOffset' });
    }
    const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
    return {
      ticks: [0, 0.5, 1].map(fraction => ({ value: maximum * fraction, y: 184 - 174 * fraction })),
      bars: rows.map(([instant, row], index) => ({
        instant,
        ...row,
        x: 48 + slotWidth * (index + 0.14),
        width: slotWidth * 0.72,
        sourceHeight: row.source / maximum * 174,
        inferredHeight: row.inferred / maximum * 174,
        sourceY: 184 - row.source / maximum * 174,
        inferredY: 184 - (row.source + row.inferred) / maximum * 174,
        labelX: 48 + slotWidth * (index + 0.5),
        label: index % labelEvery === 0 ? axisFormat.format(instant) : '',
        title: formatInstant(new Date(instant).toISOString(), timeZone),
      })),
    };
  });
  readonly durationEntity = signal<'logical' | 'attempt' | 'recipient'>('logical');
  readonly sourceDurations = computed(() =>
    (this.overview()?.durations ?? []).filter(row =>
      row.timestampBasis === 'SOURCE_EVENT' && row.entity === this.durationEntity())
      .sort((a, b) => b.p95Ms - a.p95Ms));
  readonly showAllDurations = linkedSignal({
    source: this.durationEntity,
    computation: () => false,
  });
  readonly visibleDurations = computed(() =>
    this.showAllDurations() ? this.sourceDurations() : this.sourceDurations().slice(0, 10));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly catalogLoading = signal(true);
  readonly catalogError = signal<string | null>(null);
  readonly catalogLoaded = signal(false);
  readonly serviceIdentifiers = signal<string[]>([]);
  readonly connection = signal('Connessione in attesa');
  /** False while the SSE link is down: the snapshot on screen is then the last one received, not live data. */
  readonly streamLive = signal(false);
  readonly degraded = computed(() => this.overview() !== null && !this.streamLive());
  readonly timeWindow = signal<TimeWindowSelection>({ range: '1h', from: '', to: '' });
  readonly range = computed(() => this.timeWindow().range);
  readonly logicalState = signal('');
  readonly attemptState = signal('');
  readonly serviceIdentifier = signal('');
  readonly serviceIdentifierOptions = computed(() => {
    const identifiers = this.serviceIdentifiers();
    const activeIdentifier = this.serviceIdentifier();
    return activeIdentifier && !identifiers.includes(activeIdentifier)
      ? [activeIdentifier, ...identifiers]
      : identifiers;
  });
  readonly psp = signal('');
  readonly canale = signal('');
  private readonly tokenChanges = toObservable(this.session.token);
  private readonly pending: AggregateEvent[] = [];
  private from = '';
  private to = '';
  private revision = 0;
  private resyncing = false;
  private snapshotAcquiring = false;
  private snapshotInitialized = false;
  private streamSubscription?: Subscription;
  private snapshotSubscription?: Subscription;
  readonly format = (value: string | null): string => formatInstant(value, this.timezone.zone());
  readonly isUnresolved = isUnresolvedState;
  readonly logicalTotal = computed(() => this.sumCounts(this.overview()?.logicalStates));
  readonly attemptTotal = computed(() => this.sumCounts(this.overview()?.attemptStates));
  readonly recipientTotal = computed(() => this.sumCounts(this.overview()?.recipientStates));
  readonly logicalSlices = computed<readonly PieSlice[]>(() =>
    (this.overview()?.logicalStates ?? []).map(row => ({ key: row.state, label: row.state, count: row.count })));
  readonly attemptSlices = computed<readonly PieSlice[]>(() =>
    this.orderedAttemptStates().map(row => ({
      key: row.state, label: row.state, count: row.count,
      flag: isUnresolvedState(row.state) ? 'non risolto' : undefined,
    })));
  readonly recipientSlices = computed<readonly PieSlice[]>(() =>
    (this.overview()?.recipientStates ?? []).map(row => ({ key: row.state, label: row.state, count: row.count })));

  /** Share of `count` over `total`, in [0, 100]; 0 when the group is empty. */
  percent(count: number, total: number): number {
    return total > 0 ? count / total * 100 : 0;
  }

  /** Bar width for a share: non-zero counts keep a minimum visible sliver. */
  barWidth(count: number, total: number): number {
    return count > 0 ? Math.max(1.5, this.percent(count, total)) : 0;
  }

  private sumCounts(rows: readonly { count: number }[] | undefined): number {
    return (rows ?? []).reduce((sum, row) => sum + row.count, 0);
  }

  formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) {
      return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(milliseconds / 1000)} s`;
    }
    const seconds = Math.round(milliseconds / 100) / 10;
    const number = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
    if (seconds < 60) return `${number.format(seconds)} s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round((seconds - minutes * 60) * 10) / 10;
    return `${number.format(minutes)} min${remainder ? ` ${number.format(remainder)} s` : ''}`;
  }

  ngOnInit(): void {
    this.loadServiceIdentifierCatalog();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.timeWindow.set(readTimeWindow(params));
      this.logicalState.set(params.get('logicalState') ?? '');
      this.attemptState.set(params.get('attemptState') ?? '');
      this.serviceIdentifier.set(params.get('serviceIdentifier') ?? '');
      this.psp.set(params.get('psp') ?? '');
      this.canale.set(params.get('canale') ?? '');
      this.openStream();
    });
    this.tokenChanges.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.openStream());
  }

  updateFilter(key: string, value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  updateFromEvent(key: string, event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
      this.updateFilter(key, target.value);
    }
  }

  retryCatalog(): void {
    if (!this.catalogLoading() && this.catalogError()) this.loadServiceIdentifierCatalog();
  }

  retry(): void {
    this.error.set(null);
    this.openStream();
  }

  private loadServiceIdentifierCatalog(): void {
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

  /**
   * A preset range ("last N minutes") is a rolling window: `live` tells the server that the window stays
   * open on the right, so activity that happens after the stream opened still counts. A custom
   * range is closed. `from`/`to` are identical for REST and SSE in both cases.
   */
  private liveFlag(): { live?: string } {
    return this.range() === 'custom' ? {} : { live: 'true' };
  }

  private makeFilters(): Record<string, string> | null {
    const result = resolveTimeWindow(this.timeWindow());
    if (!result.bounds) {
      this.error.set(result.error);
      this.loading.set(false);
      this.connection.set('Intervallo non valido');
      return null;
    }
    this.from = result.bounds.from;
    this.to = result.bounds.to;
    const filters = {
      from: this.from,
      to: this.to,
      ...this.liveFlag(),
      logicalState: this.logicalState(),
      attemptState: this.attemptState(),
      serviceIdentifier: this.serviceIdentifier(),
      psp: this.psp(),
      canale: this.canale(),
    };
    this.warningFilters.set(filters);
    return filters;
  }

  private openStream(): void {
    this.streamSubscription?.unsubscribe();
    this.snapshotSubscription?.unsubscribe();
    this.pending.length = 0;
    this.overview.set(null);
    this.snapshotAcquiring = false;
    this.snapshotInitialized = false;
    this.resyncing = false;
    this.loading.set(true);
    this.error.set(null);
    this.streamLive.set(false);
    this.connection.set('Connessione SSE in apertura');
    const filters = this.makeFilters();
    if (!filters) return;
    this.streamSubscription = this.api.connect({ scope: 'overview', ...filters }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: event => {
        if (event.type === 'connection-error') {
          this.streamLive.set(false);
          this.connection.set('Connessione interrotta; riconnessione in corso');
          if (!this.snapshotInitialized && !this.snapshotAcquiring) {
            this.loading.set(false);
            const status = this.connectionStatus(event);
            this.error.set(status ? this.streamError(status) : 'Stream non disponibile. Verifica il servizio e riprova.');
          }
          return;
        }
        if (event.type === 'replay-expired') {
          this.connection.set('Replay scaduto; riallineamento dello snapshot in corso');
          this.resync();
          return;
        }
        const data = JSON.parse(event.data) as AggregateEvent;
        this.streamLive.set(true);
        if (data.type === 'ready') {
          this.connection.set('Stream attivo');
          if (!this.snapshotInitialized && !this.snapshotAcquiring) this.loadSnapshot();
          return;
        }
        if (this.snapshotAcquiring || !this.snapshotInitialized) {
          this.pending.push(data);
          return;
        }
        this.applyEvent(data);
      },
      error: (failure: unknown) => {
        this.streamLive.set(false);
        this.connection.set('Stream non disponibile');
        this.loading.set(false);
        this.error.set(failure instanceof StreamHttpError
          ? this.streamError(failure.status)
          : 'Stream di aggiornamento non disponibile. Riprova la connessione.');
      },
    });
  }

  private loadSnapshot(): void {
    if (this.snapshotAcquiring) return;
    const params = { from: this.from, to: this.to, ...this.liveFlag(), logicalState: this.logicalState(), attemptState: this.attemptState(),
      serviceIdentifier: this.serviceIdentifier(), psp: this.psp(), canale: this.canale() };
    this.snapshotAcquiring = true;
    this.loading.set(true);
    this.snapshotSubscription?.unsubscribe();
    this.snapshotSubscription = this.api.overview(params).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: value => {
        this.overview.set(value);
        this.revision = value.projectionRevision;
        this.loading.set(false);
        this.error.set(null);
        this.resyncing = false;
        this.snapshotInitialized = true;
        this.snapshotAcquiring = false;
        this.reconcilePending();
      },
      error: (failure: HttpErrorResponse) => {
        this.snapshotAcquiring = false;
        this.loading.set(false);
        this.resyncing = false;
        this.error.set(failure.status === 422
          ? 'Questa combinazione non è disponibile negli aggregati. Apri l’elenco dei tentativi per applicare tutti i filtri.'
          : failure.status === 401 || failure.status === 403
            ? 'Sessione non autorizzata per questa vista.'
            : failure.status === 0
              ? 'Servizio non raggiungibile. Verifica che il backend sia attivo e riprova.'
              : `Caricamento non riuscito (HTTP ${failure.status}).`);
      },
    });
  }

  private applyEvent(event: AggregateEvent): void {
    const current = this.overview();
    if (!current || !event.changes || event.projectionRevision <= this.revision) return;
    if (event.projectionRevision !== this.revision + 1) {
      this.pending.push(event);
      if (!this.resyncing) {
        this.resyncing = true;
        this.loadSnapshot();
      }
      return;
    }
    const changes = event.changes;
    const values: Record<string, unknown> = {
      payments: current.counts.payments + (changes.counts['payments'] ?? 0),
      attempts: current.counts.attempts + (changes.counts['attempts'] ?? 0),
    };
    const next: Overview = {
      ...current,
      projectionRevision: event.projectionRevision,
      counts: { payments: Number(values['payments']), attempts: Number(values['attempts']) },
      unresolved: {
        payments: current.unresolved.payments + (changes.counts['unresolvedPayments'] ?? 0),
        attempts: current.unresolved.attempts + (changes.counts['unresolvedAttempts'] ?? 0),
      },
      logicalStates: applyAggregateRows(current.logicalStates, changes.logicalStates, ['state'], ['count'], true),
      attemptStates: applyAggregateRows(current.attemptStates, changes.attemptStates, ['state'], ['count'], true),
      recipientStates: applyAggregateRows(current.recipientStates, changes.recipientStates ?? [], ['state'], ['count'], true),
      primitives: applyAggregateRows(current.primitives ?? [], changes.primitives ?? [],
        ['serviceIdentifier', 'primitive', 'direction'], ['requests', 'responses', 'warnings']),
      traffic: applyAggregateRows(current.traffic, changes.traffic, ['bucketStart'], ['startedAttempts', 'estimatedStarts']),
      transitions: applyAggregateRows(current.transitions, changes.transitions, ['bucketStart', 'entity', 'state', 'timestampBasis'], ['count']),
      matrices: {
        psp: this.updateMatrix(current.matrices.psp, changes.matrices.psp),
        canale: this.updateMatrix(current.matrices.canale, changes.matrices.canale),
        recipient: this.updateMatrix(current.matrices.recipient, changes.matrices.recipient ?? []),
      },
      anomalies: {
        transitions: current.anomalies.transitions + changes.anomalies.transitions,
        payments: current.anomalies.payments + changes.anomalies.payments,
      },
      durations: changes.durationSnapshot,
      freshness: event.freshness ?? current.freshness,
    };
    this.overview.set(next);
    this.revision = event.projectionRevision;
  }

  private updateMatrix(
    matrix: Overview['matrices']['psp'],
    delta: { value: string | null; state: string; count: number }[],
  ): Overview['matrices']['psp'] {
    const flat = matrix.flatMap(row => row.states.map(state => ({ value: row.value, ...state })));
    const updated = applyAggregateRows(flat, delta, ['value', 'state'], ['count']);
    const values = new Map<string | null, { state: string; count: number }[]>();
    for (const item of updated) values.set(item.value, [...(values.get(item.value) ?? []), { state: item.state, count: item.count }]);
    return [...values].map(([value, states]) => ({ value, states }));
  }

  private resync(): void {
    if (this.resyncing || this.snapshotAcquiring) return;
    this.resyncing = true;
    this.loadSnapshot();
  }

  private reconcilePending(): void {
    const pending = this.pending.splice(0);
    for (let index = 0; index < pending.length; index++) {
      const event = pending[index];
      if (event.projectionRevision > this.revision) this.applyEvent(event);
      if (this.snapshotAcquiring) {
        this.pending.push(...pending.slice(index + 1));
        return;
      }
    }
  }

  private streamError(status: number): string {
    if (status === 422) return 'Questa combinazione non è disponibile negli aggregati. Apri l’elenco dei tentativi per applicare tutti i filtri.';
    if (status === 401) return 'Accesso al servizio non autenticato (401). Riprova più tardi.';
    if (status === 403) return 'La sessione non è autorizzata ad accedere a questa vista.';
    if (status === 404) return 'La risorsa richiesta per questa vista non è disponibile.';
    if (status >= 500) return `Servizio di aggiornamento non disponibile (HTTP ${status}).`;
    return `Connessione SSE non riuscita (HTTP ${status}).`;
  }

  private connectionStatus(event: MessageEvent<string>): number | null {
    try {
      const data = JSON.parse(event.data) as { status?: unknown };
      return typeof data.status === 'number' ? data.status : null;
    } catch {
      return null;
    }
  }

  paymentListParams(extra: Record<string, string> = {}): Record<string, string> {
    return this.cleanParams({
      window: this.range(),
      ...(this.range() === 'custom' ? { from: this.timeWindow().from, to: this.timeWindow().to } : {}),
      logicalState: this.logicalState(),
      attemptState: this.attemptState(),
      serviceIdentifier: this.serviceIdentifier(),
      psp: this.psp(),
      canale: this.canale(),
      ...extra,
    });
  }

  attemptListParams(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...this.paymentListParams(),
      view: 'attempts',
      ...extra,
    };
  }

  matrixListParams(dimension: 'psp' | 'canale' | 'recipient', value: string | null): Record<string, string> {
    // Recipients are not attempts: there is no attempt-list drill-down by stazione_recipient.
    if (dimension === 'recipient') return {};
    return this.attemptListParams({ [dimension]: value ?? '~unknown' });
  }

  matrixDimensionLabel(): string {
    const dimension = this.matrixDimension();
    return dimension === 'psp' ? 'PSP' : dimension === 'canale' ? 'Canale' : 'Destinatario';
  }

  private cleanParams(params: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value.length > 0));
  }
}
