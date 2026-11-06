import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { skip, Subscription } from 'rxjs';
import { ObservabilityApi, StreamHttpError } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { Creditor, Page } from '../../models/domain';
import { positiveStateCounts } from '../../models/state-presentation';
import { StateBadgeComponent } from '../../shared/state-badge/state-badge.component';
import { readTimeWindow, resolveTimeWindow, TimeWindowSelection } from '../../models/time-window';
import { TimeWindowComponent } from '../../shared/time-window/time-window.component';
import { toObservable } from '@angular/core/rxjs-interop';
import { MaintenanceComponent } from './maintenance.component';

@Component({
  selector: 'app-creditors',
  imports: [DecimalPipe, FormsModule, RouterLink, TimeWindowComponent, StateBadgeComponent, MaintenanceComponent],
  templateUrl: './creditors.component.html',
  styleUrl: './creditors.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreditorsComponent implements OnInit {
  readonly stateCounts = positiveStateCounts;
  readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ObservabilityApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(SessionService);
  private readonly tokenChanges = toObservable(this.session.token);
  private readonly sessionChanges = toObservable(this.session.session);
  private readonly loadedRows = signal<Creditor[]>([]);
  private readonly loadedScopeKey = signal('');
  readonly rows = computed(() => this.loadedScopeKey() === this.scopeKey() ? this.loadedRows() : []);
  readonly maxStarted = computed(() => Math.max(1, ...this.rows().map(row => row.startedAttempts)));
  readonly search = signal('');
  readonly sort = signal<'traffic' | 'unresolved'>('traffic');
  readonly timeWindow = signal<TimeWindowSelection>({ range: '1h', from: '', to: '' });
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private readonly nextCursorState = signal<string | null>(null);
  readonly nextCursor = computed(() => this.loadedScopeKey() === this.scopeKey() ? this.nextCursorState() : null);
  private readonly hasPreviousState = signal(false);
  readonly hasPrevious = computed(() => this.loadedScopeKey() === this.scopeKey() && this.hasPreviousState());
  private readonly resultsChangedState = signal(false);
  readonly resultsChanged = computed(() => this.loadedScopeKey() === this.scopeKey() && this.resultsChangedState());
  readonly liveStatus = signal('Aggiornamenti live non collegati');
  private cursors: (string | null)[] = [null];
  private request?: Subscription;
  private live = new Subscription();
  private from = '';
  private to = '';
  private pageGeneration = 0;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.search.set(params.get('paFiscalCode') ?? '');
      this.sort.set(params.get('sort') === 'unresolved' ? 'unresolved' : 'traffic');
      this.timeWindow.set(readTimeWindow(params));
      this.cursors = [null];
      this.hasPreviousState.set(false);
      this.resultsChangedState.set(false);
      this.loadedRows.set([]);
      this.loadedScopeKey.set('');
      this.setWindowBounds();
      this.load();
    });
    this.tokenChanges.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.clearForSessionChange());
    this.sessionChanges.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      this.clearForSessionChange();
      if (value) this.load();
    });
  }

  update(key: string, event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
      this.navigateParam(key, target.value);
    }
  }

  setSort(value: 'traffic' | 'unresolved'): void {
    this.navigateParam('sort', value);
  }

  private navigateParam(key: string, value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  next(): void {
    if (!this.nextCursor()) return;
    this.cursors.push(this.nextCursor());
    this.hasPreviousState.set(true);
    this.load();
  }

  previous(): void {
    if (!this.hasPrevious()) return;
    this.cursors.pop();
    this.hasPreviousState.set(this.cursors.length > 1);
    this.load();
  }

  retry(): void {
    this.cursors = [null];
    this.nextCursorState.set(null);
    this.error.set(null);
    this.load();
  }

  private load(): void {
    this.request?.unsubscribe();
    this.live.unsubscribe();
    this.live = new Subscription();
    this.liveStatus.set('Aggiornamenti live non collegati');
    const generation = ++this.pageGeneration;
    this.loadedRows.set([]);
    this.loadedScopeKey.set('');
    const validation = resolveTimeWindow(this.timeWindow());
    if (!validation.bounds) {
      this.loading.set(false);
      this.error.set(validation.error);
      this.nextCursorState.set(null);
      return;
    }
    const filters = {
      from: this.from,
      to: this.to,
      paFiscalCode: this.search(),
      sort: this.sort(),
      pageSize: '20',
      cursor: this.cursors.at(-1) ?? undefined,
    };
    const requestedScopeKey = this.scopeKey();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api.creditors(filters).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (page: Page<Creditor>) => {
        if (generation !== this.pageGeneration || requestedScopeKey !== this.scopeKey()) return;
        this.loadedRows.set(page.items);
        this.loadedScopeKey.set(requestedScopeKey);
        this.nextCursorState.set(page.nextCursor);
        this.loading.set(false);
        this.watchVisibleCreditors(page.items, page.snapshotRevision);
      },
      error: (failure: HttpErrorResponse) => {
        if (generation !== this.pageGeneration) return;
        this.loading.set(false);
        if (failure.status === 410) {
          this.cursors = [null];
          this.hasPreviousState.set(false);
          this.nextCursorState.set(null);
          this.error.set('Il cursore è scaduto. Ricarica la prima pagina.');
        } else {
          if (failure.status === 401 || failure.status === 403) {
            this.loadedRows.set([]);
            this.loadedScopeKey.set('');
          }
          this.error.set(failure.status === 0 ? 'Servizio non raggiungibile. Verifica che il backend sia attivo e riprova.' : `Elenco non disponibile (HTTP ${failure.status}).`);
        }
      },
    });
  }

  private setWindowBounds(): void {
    const result = resolveTimeWindow(this.timeWindow());
    if (result.bounds) {
      this.from = result.bounds.from;
      this.to = result.bounds.to;
    }
  }

  private clearForSessionChange(): void {
    this.request?.unsubscribe();
    this.pageGeneration++;
    this.live.unsubscribe();
    this.live = new Subscription();
    this.loadedRows.set([]);
    this.loadedScopeKey.set('');
    this.nextCursorState.set(null);
    this.cursors = [null];
    this.hasPreviousState.set(false);
    this.resultsChangedState.set(false);
    this.loading.set(false);
    this.error.set(null);
    this.liveStatus.set('Aggiornamenti live non collegati');
    this.setWindowBounds();
  }

  private watchVisibleCreditors(rows: Creditor[], snapshotRevision: number): void {
    const keys = [...new Set(rows.map(row => row.paFiscalCode))].sort();
    this.liveStatus.set(keys.length
      ? `Aggiornamenti scoped attivi per ${keys.length} enti visibili`
      : 'Nessun ente visibile da aggiornare');
    if (!keys.length) return;
    const subscribedScopeKey = this.scopeKey();
    this.live.add(this.api.connect({ scope: 'creditor-list', keys: keys.join(',') })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: event => {
          if (subscribedScopeKey !== this.scopeKey()) return;
          if (event.type === 'connection-error') {
            this.liveStatus.set('Connessione interrotta; riconnessione in corso');
            return;
          }
          if (event.type === 'replay-expired') {
            this.resultsChangedState.set(true);
            this.liveStatus.set('Replay scaduto; aggiorna i risultati');
            return;
          }
          if (event.type !== 'ready' && event.type !== 'list.changed') return;
          try {
            const update = JSON.parse(event.data) as { type?: unknown; projectionRevision?: unknown };
            if (update.type === 'ready' && typeof update.projectionRevision === 'number'
              && update.projectionRevision > snapshotRevision) this.resultsChangedState.set(true);
            if (update.type === 'list.changed') this.resultsChangedState.set(true);
          } catch {
            this.liveStatus.set('Evento di aggiornamento non valido');
          }
        },
        error: failure => {
          if (subscribedScopeKey !== this.scopeKey()) return;
          if (failure instanceof StreamHttpError && failure.status === 404) {
            this.resultsChangedState.set(true);
            this.liveStatus.set('La pagina è cambiata prima della sottoscrizione; aggiorna i risultati');
          } else {
            const status = failure instanceof StreamHttpError ? ` (HTTP ${failure.status})` : '';
            this.liveStatus.set(`Stream non disponibile${status}`);
          }
        },
      }));
  }

  private scopeKey(): string {
    return JSON.stringify([this.session.token(), this.session.session()]);
  }
}
