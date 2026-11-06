import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ObservabilityApi, StreamHttpError } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { ATTEMPT_STATES, Attempt, isUnresolvedState, LOGICAL_STATES, Page, PaymentSummary } from '../../models/domain';
import { stateFilterGroups, statePresentation } from '../../models/state-presentation';
import { readTimeWindow, resolveTimeWindow, TimeWindowSelection } from '../../models/time-window';
import { StateBadgeComponent } from '../../shared/state-badge/state-badge.component';
import { TimeWindowComponent } from '../../shared/time-window/time-window.component';
import { skip, Subscription } from 'rxjs';

type Row = PaymentSummary | Attempt;

@Component({
  selector: 'app-payments',
  imports: [FormsModule, RouterLink, StateBadgeComponent, TimeWindowComponent],
  templateUrl: './payments.component.html',
  styleUrl: './payments.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentsComponent implements OnInit {
  private readonly api = inject(ObservabilityApi);
  readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly session = inject(SessionService);
  private readonly tokenChanges = toObservable(this.session.token);
  private readonly sessionChanges = toObservable(this.session.session);
  readonly logicalGroups = stateFilterGroups('logical', LOGICAL_STATES);
  readonly attemptGroups = stateFilterGroups('attempt', ATTEMPT_STATES);
  readonly presentation = statePresentation;
  readonly isUnresolved = isUnresolvedState;
  private readonly loadedRows = signal<Row[]>([]);
  private readonly loadedScopeKey = signal('');
  readonly rows = computed(() => this.loadedScopeKey() === this.scopeKey() && this.session.session()
    ? this.loadedRows()
    : []);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly catalogLoading = signal(true);
  readonly catalogError = signal<string | null>(null);
  readonly catalogLoaded = signal(false);
  readonly serviceIdentifiers = signal<string[]>([]);
  private readonly nextCursorState = signal<string | null>(null);
  readonly nextCursor = computed(() => this.loadedScopeKey() === this.scopeKey() ? this.nextCursorState() : null);
  private readonly hasPreviousState = signal(false);
  readonly hasPrevious = computed(() => this.loadedScopeKey() === this.scopeKey() && this.hasPreviousState());
  readonly view = signal<'payments' | 'attempts'>('payments');
  readonly filter = signal({
    paFiscalCode: '',
    noticeNumber: '',
    logicalState: '',
    attemptState: '',
    serviceIdentifier: '',
    psp: '',
    canale: '',
    stazione: '',
    unresolvedOnly: '',
    anomaliesOnly: '',
  });
  /** Without a `window` query parameter the list covers the whole retention (60 days) and sends no bounds. */
  readonly timeWindow = signal<TimeWindowSelection>({ range: '60d', from: '', to: '' });
  readonly windowActive = signal(false);
  private windowBounds: { from: string; to: string; live: boolean } | null = null;
  readonly serviceIdentifierOptions = computed(() => {
    const identifiers = this.serviceIdentifiers();
    const activeIdentifier = this.filter().serviceIdentifier;
    return activeIdentifier && !identifiers.includes(activeIdentifier)
      ? [activeIdentifier, ...identifiers]
      : identifiers;
  });
  readonly tokenInput = signal('');
  readonly tokenMessage = signal<string | null>(null);
  readonly revealedTokens = signal<Record<string, string>>({});
  readonly tokenRevealErrors = signal<Record<string, string>>({});
  private readonly resultsChangedState = signal(false);
  readonly resultsChanged = computed(() => this.loadedScopeKey() === this.scopeKey() && this.resultsChangedState());
  readonly liveStatus = signal('Aggiornamenti live non collegati');
  private cursors: (string | null)[] = [null];
  private request?: Subscription;
  private live = new Subscription();
  private tokenRevealRequests = new Subscription();
  private lookupRequest?: Subscription;
  private lookupGeneration = 0;
  private pageGeneration = 0;

  ngOnInit(): void {
    this.loadServiceIdentifierCatalog();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.cancelLookup();
      this.view.set(params.get('view') === 'attempts' ? 'attempts' : 'payments');
      this.windowActive.set(params.has('window'));
      this.timeWindow.set(params.has('window') ? readTimeWindow(params) : { range: '60d', from: '', to: '' });
      this.filter.set({
        paFiscalCode: params.get('paFiscalCode') ?? '',
        noticeNumber: params.get('noticeNumber') ?? '',
        logicalState: params.get('logicalState') ?? '',
        attemptState: params.get('attemptState') ?? '',
        serviceIdentifier: params.get('serviceIdentifier') ?? '',
        psp: params.get('psp') ?? '',
        canale: params.get('canale') ?? '',
        stazione: params.get('stazione') ?? '',
        unresolvedOnly: params.get('unresolvedOnly') ?? '',
        anomaliesOnly: params.get('anomaliesOnly') ?? '',
      });
      this.cursors = [null];
      this.hasPreviousState.set(false);
      this.resultsChangedState.set(false);
      if (this.refreshWindow()) this.load();
    });
    this.tokenChanges.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.clearForIdentityChange());
    this.sessionChanges.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      this.clearForIdentityChange();
      if (value) this.load();
    });
  }

  detailParams(attemptId?: string): Record<string, string> {
    return attemptId
      ? { ...this.route.snapshot.queryParams, attemptId }
      : this.route.snapshot.queryParams;
  }

  setFilter(key: string, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: target.value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  changeView(value: 'payments' | 'attempts'): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: value === 'attempts' ? 'attempts' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  changeViewFromEvent(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLSelectElement) {
      this.changeView(target.value === 'attempts' ? 'attempts' : 'payments');
    }
  }

  attempt(row: Row): Attempt | null {
    return 'attemptId' in row ? row : null;
  }

  displayToken(item: Attempt): string {
    return this.revealedTokens()[item.attemptId]
      ?? (this.requiresReveal(item.tokenDisplay) ? 'Recupero token…' : item.tokenDisplay);
  }

  payment(row: Row): PaymentSummary | null {
    return 'attemptCount' in row ? row : null;
  }

  next(): void {
    const cursor = this.nextCursor();
    if (!cursor) return;
    this.cursors.push(cursor);
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
    this.resultsChangedState.set(false);
    this.error.set(null);
    if (this.loadedScopeKey() !== this.scopeKey()) this.cursors = [null];
    // A rolling window moves forward when the first page is reloaded; later pages keep the bounds of the cursor.
    if (this.cursors.length > 1 || this.refreshWindow()) this.load();
  }

  retryCatalog(): void {
    if (!this.catalogLoading() && this.catalogError()) this.loadServiceIdentifierCatalog();
  }

  lookupToken(): void {
    const value = this.tokenInput().trim();
    if (!value) return;
    this.lookupRequest?.unsubscribe();
    const generation = ++this.lookupGeneration;
    const token = this.session.token();
    const sessionId = this.session.session()?.id;
    const currentFilters = this.filter();
    const constraints = {
      ...(currentFilters.paFiscalCode ? { paFiscalCode: currentFilters.paFiscalCode } : {}),
      ...(currentFilters.noticeNumber ? { noticeNumber: currentFilters.noticeNumber } : {}),
    };
    this.tokenMessage.set(null);
    this.lookupRequest = this.api.lookupToken(value, constraints).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (!this.lookupIsCurrent(generation, token, sessionId)) return;
        this.lookupRequest = undefined;
        this.tokenInput.set('');
        this.tokenMessage.set('Ricerca verificata dal server e registrata in audit.');
        void this.router.navigate(['/payments', result.paFiscalCode, result.noticeNumber], {
          queryParams: { ...this.route.snapshot.queryParams, attemptId: result.attemptId },
        });
      },
      error: (failure: HttpErrorResponse) => {
        if (!this.lookupIsCurrent(generation, token, sessionId)) return;
        this.lookupRequest = undefined;
        this.tokenInput.set('');
        this.tokenMessage.set(failure.status === 403
          ? 'Il server non autorizza la ricerca del token.'
          : failure.status === 404
            ? 'Nessun tentativo in retention corrisponde al token.'
            : failure.status === 500
              ? 'Ricerca negata: audit non disponibile.'
              : `Ricerca non riuscita (HTTP ${failure.status}).`);
      },
    });
  }

  private load(): void {
    this.request?.unsubscribe();
    this.live.unsubscribe();
    this.live = new Subscription();
    this.tokenRevealRequests.unsubscribe();
    this.tokenRevealRequests = new Subscription();
    this.revealedTokens.set({});
    this.tokenRevealErrors.set({});
    this.liveStatus.set('Aggiornamenti live non collegati');
    const generation = ++this.pageGeneration;
    const requestedScopeKey = this.scopeKey();
    this.loadedRows.set([]);
    this.loadedScopeKey.set('');
    this.loading.set(true);
    this.error.set(null);
    const bounds = this.windowBounds;
    const filters = {
      ...this.filter(), view: this.view(), pageSize: '20', cursor: this.cursors.at(-1) ?? undefined,
      ...(bounds ? { from: bounds.from, to: bounds.to, ...(bounds.live ? { live: 'true' } : {}) } : {}),
    };
    this.request = this.api.payments<Row>(filters).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (page: Page<Row>) => {
        if (generation !== this.pageGeneration || requestedScopeKey !== this.scopeKey()) return;
        this.loadedRows.set(page.items);
        this.loadedScopeKey.set(requestedScopeKey);
        this.nextCursorState.set(page.nextCursor);
        this.loading.set(false);
        this.revealMaskedAttempts(page.items, generation, requestedScopeKey);
        this.watchVisiblePayments(page.items, page.snapshotRevision);
      },
      error: (failure: HttpErrorResponse) => {
        if (generation !== this.pageGeneration) return;
        this.loading.set(false);
        if (failure.status === 401 || failure.status === 403) {
          this.loadedRows.set([]);
          this.loadedScopeKey.set('');
        }
        if (failure.status === 410) {
          this.cursors = [null];
          this.hasPreviousState.set(false);
          this.nextCursorState.set(null);
          this.error.set('La pagina è scaduta perché i dati sono cambiati. Ricarica la prima pagina.');
        } else {
          this.error.set(failure.status === 0
            ? 'Servizio non raggiungibile. Verifica che il backend sia attivo e riprova.'
            : `Ricerca non riuscita (HTTP ${failure.status}).`);
        }
      },
    });
  }

  /**
   * Resolves the selected interval into fixed bounds shared by every page of the same search: a preset is a
   * rolling window (`live`, open on the right), a custom range is closed. Returns false for an invalid range.
   */
  private refreshWindow(): boolean {
    this.windowBounds = null;
    if (!this.windowActive()) return true;
    const selection = this.timeWindow();
    const result = resolveTimeWindow(selection);
    if (!result.bounds) {
      this.pageGeneration++;
      this.request?.unsubscribe();
      this.live.unsubscribe();
      this.live = new Subscription();
      this.loadedRows.set([]);
      this.loadedScopeKey.set('');
      this.loading.set(false);
      this.error.set(result.error);
      return false;
    }
    this.windowBounds = { ...result.bounds, live: selection.range !== 'custom' };
    return true;
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

  private watchVisiblePayments(rows: Row[], snapshotRevision: number): void {
    const keys = new Set<string>();
    for (const row of rows) {
      keys.add(`${row.paFiscalCode}:${row.noticeNumber}`);
    }
    const orderedKeys = [...keys].sort();
    this.liveStatus.set(orderedKeys.length
      ? `Aggiornamenti scoped attivi per ${orderedKeys.length} pagamenti visibili`
      : 'Nessun pagamento visibile da aggiornare');
    if (!orderedKeys.length) return;
    const subscribedScopeKey = this.scopeKey();
    this.live.add(this.api.connect({ scope: 'payment-list', keys: orderedKeys.join(',') })
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

  private clearForIdentityChange(): void {
    this.pageGeneration++;
    this.request?.unsubscribe();
    this.live.unsubscribe();
    this.live = new Subscription();
    this.tokenRevealRequests.unsubscribe();
    this.tokenRevealRequests = new Subscription();
    this.revealedTokens.set({});
    this.tokenRevealErrors.set({});
    this.cancelLookup();
    this.loadedRows.set([]);
    this.loadedScopeKey.set('');
    this.nextCursorState.set(null);
    this.cursors = [null];
    this.hasPreviousState.set(false);
    this.resultsChangedState.set(false);
    this.tokenInput.set('');
    this.tokenMessage.set(null);
    this.loading.set(false);
    this.error.set(null);
    this.liveStatus.set('Aggiornamenti live non collegati');
  }

  private revealMaskedAttempts(rows: readonly Row[], generation: number, scopeKey: string): void {
    for (const row of rows) {
      const item = this.attempt(row);
      if (!item || !this.requiresReveal(item.tokenDisplay)) continue;

      this.tokenRevealRequests.add(this.api.reveal(item.attemptId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: result => {
            if (generation !== this.pageGeneration || scopeKey !== this.scopeKey()) return;
            if (result.attemptId !== item.attemptId
              || typeof result.paymentToken !== 'string'
              || !result.paymentToken.trim()) {
              this.tokenRevealErrors.update(errors => ({
                ...errors,
                [item.attemptId]: 'Il server ha restituito un token non valido.',
              }));
              return;
            }
            this.revealedTokens.update(tokens => ({ ...tokens, [item.attemptId]: result.paymentToken }));
          },
          error: (failure: HttpErrorResponse) => {
            if (generation !== this.pageGeneration || scopeKey !== this.scopeKey()) return;
            this.tokenRevealErrors.update(errors => ({
              ...errors,
              [item.attemptId]: failure.status === 403
                ? 'Il server non autorizza la visualizzazione del paymentToken.'
                : failure.status === 404
                  ? 'paymentToken non disponibile o scaduto.'
                  : `paymentToken non disponibile (HTTP ${failure.status}).`,
            }));
          },
        }));
    }
  }

  private requiresReveal(tokenDisplay: string): boolean {
    return !tokenDisplay || tokenDisplay.includes('•');
  }

  private cancelLookup(): void {
    this.lookupGeneration++;
    this.lookupRequest?.unsubscribe();
    this.lookupRequest = undefined;
  }

  private lookupIsCurrent(generation: number, token: string, sessionId: string | undefined): boolean {
    return generation === this.lookupGeneration
      && token === this.session.token()
      && sessionId !== undefined
      && sessionId === this.session.session()?.id;
  }

  private scopeKey(): string {
    return JSON.stringify([this.session.token(), this.session.session()]);
  }
}
