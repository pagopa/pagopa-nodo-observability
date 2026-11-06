import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { applyPaymentDelta, PaymentDelta } from '../../core/realtime/payment-reducer';
import { Attempt, formatInstant, Payment } from '../../models/domain';
import { StateBadgeComponent } from '../../shared/state-badge/state-badge.component';
import { StateProgressionComponent } from '../../shared/state-progression/state-progression.component';
import { paymentDetailPresentation } from './payment-detail-presentation';
import { AttemptDbCheckComponent } from './attempt-db-check.component';
import { AttemptReTraceComponent } from './attempt-re-trace.component';
import { Subscription } from 'rxjs';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AttemptReDetailComponent } from './attempt-re-detail.component';
import { defaultReWindow, positionReWindow } from '../../models/re-event';
import { PaymentRePositionComponent } from './payment-re-position.component';

@Component({
  selector: 'app-payment-detail',
  imports: [
    RouterLink,
    StateBadgeComponent,
    StateProgressionComponent,
    AttemptDbCheckComponent,
    AttemptReTraceComponent,
    PaymentRePositionComponent,
  ],
  templateUrl: './payment-detail.component.html',
  styleUrl: './payment-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentDetailComponent implements OnInit, OnDestroy {
  readonly route = inject(ActivatedRoute);
  readonly api = inject(ObservabilityApi);
  readonly timezone = inject(TimezoneService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogs = inject(MatDialog);
  private reDialog?: MatDialogRef<AttemptReDetailComponent>;
  readonly payment = signal<Payment | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly connection = signal('Connessione in attesa');
  readonly selectedAttemptId = signal('');
  readonly revealedTokens = signal<Record<string, string>>({});
  readonly tokenRevealErrors = signal<Record<string, string>>({});
  readonly pendingTokenIds = signal<ReadonlySet<string>>(new Set());
  readonly detail = computed(() => {
    const payment = this.payment();
    return payment ? paymentDetailPresentation(payment, this.selectedAttemptId(), this.timezone.zone()) : null;
  });
  readonly reWindows = computed(() => {
    const now = Date.now();
    return new Map(
      (this.payment()?.attempts ?? []).map(attempt => [
        attempt.attemptId,
        defaultReWindow(attempt, now),
      ]),
    );
  });
  readonly positionWindow = computed(() => positionReWindow(this.payment()?.attempts ?? [], Date.now()));
  readonly format = (value: string | null): string => formatInstant(value, this.timezone.zone());

  rePaymentToken(attempt: Attempt): string {
    const token = this.revealedTokens()[attempt.attemptId] ?? attempt.tokenDisplay;
    return this.requiresReveal(token) ? '' : token;
  }

  private stream?: Subscription;
  private request?: Subscription;
  private tokenRevealRequests = new Subscription();
  private pending: PaymentDelta[] = [];
  private paymentGeneration = 0;
  private currentPa = '';
  private currentNotice = '';
  private revision = 0;
  private resyncing = false;
  private lastFocusedAttemptId = '';

  constructor() {
    afterRenderEffect(() => {
      const attemptId = this.selectedAttemptId();
      const payment = this.payment();
      if (!attemptId || !payment?.attempts.some(attempt => attempt.attemptId === attemptId)) {
        this.lastFocusedAttemptId = '';
        return;
      }
      if (this.lastFocusedAttemptId === attemptId) return;
      const target = document.getElementById(`attempt-${attemptId}`);
      target?.focus();
      if (target) this.lastFocusedAttemptId = attemptId;
    });
  }
  private snapshotAcquiring = false;
  private snapshotInitialized = false;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const pa = params.get('paFiscalCode') ?? '';
      const noticeNumber = params.get('noticeNumber') ?? '';
      this.startPayment(pa, noticeNumber);
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.selectedAttemptId.set(params.get('attemptId') ?? '');
    });
  }

  ngOnDestroy(): void {
    this.reDialog?.close();
    this.stream?.unsubscribe();
    this.request?.unsubscribe();
    this.tokenRevealRequests.unsubscribe();
  }

  retry(): void {
    this.startPayment(this.currentPa, this.currentNotice);
  }

  displayToken(attempt: Attempt): string {
    return this.revealedTokens()[attempt.attemptId]
      ?? (this.pendingTokenIds().has(attempt.attemptId) || this.requiresReveal(attempt.tokenDisplay)
        ? 'Recupero token…'
        : attempt.tokenDisplay);
  }

  openRe(attempt: Attempt): void {
    const payment = this.payment();
    const token = this.revealedTokens()[attempt.attemptId] ?? attempt.tokenDisplay;
    if (!payment || this.requiresReveal(token) || this.tokenRevealErrors()[attempt.attemptId]) return;
    this.reDialog?.close();
    this.reDialog = this.dialogs.open(AttemptReDetailComponent, {
      width: '100vw', maxWidth: '100vw', height: '100dvh',
      panelClass: 're-fullscreen-dialog', autoFocus: '[data-re-close]', restoreFocus: true,
      ariaLabel: 'Consultazione diagnostica tentativo RE',
      data: {
        attemptId: attempt.attemptId, paFiscalCode: payment.paFiscalCode,
        noticeNumber: payment.noticeNumber, paymentToken: token,
        suggestedWindow: defaultReWindow(attempt, Date.now()),
      },
    });
  }

  private startPayment(pa: string, noticeNumber: string): void {
    this.reDialog?.close();
    this.paymentGeneration++;
    this.stream?.unsubscribe();
    this.request?.unsubscribe();
    this.tokenRevealRequests.unsubscribe();
    this.tokenRevealRequests = new Subscription();
    this.revealedTokens.set({});
    this.tokenRevealErrors.set({});
    this.pendingTokenIds.set(new Set());
    this.lastFocusedAttemptId = '';
    this.pending = [];
    this.payment.set(null);
    this.snapshotAcquiring = false;
    this.snapshotInitialized = false;
    this.resyncing = false;
    this.currentPa = pa;
    this.currentNotice = noticeNumber;
    this.error.set(null);
    this.loading.set(true);
    this.connection.set('Apertura stream scoped al pagamento');
    this.stream = this.api.connect({ scope: 'payment', paFiscalCode: pa, noticeNumber }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: event => {
        if (event.type === 'connection-error') {
          this.connection.set('Connessione interrotta; riconnessione in corso');
          if (!this.snapshotInitialized && !this.snapshotAcquiring) {
            this.loading.set(false);
            const status = this.connectionStatus(event);
            this.error.set(status === null ? 'Stream non disponibile. Verifica il servizio e riprova.'
              : status === 401 ? 'Sessione non autenticata per questo pagamento.'
                : status === 403 ? 'Sessione non autorizzata a consultare questo pagamento.'
                  : status === 404 ? 'Pagamento non disponibile per questa sessione.'
                    : `Servizio di aggiornamento non disponibile (HTTP ${status}).`);
          }
          return;
        }
        if (event.type === 'replay-expired') {
          this.connection.set('Replay scaduto; riallineamento dello snapshot in corso');
          this.resync();
          return;
        }
        const value = JSON.parse(event.data) as PaymentDelta & { type: string };
        if (value.type === 'ready') {
          this.connection.set('Stream attivo');
          if (!this.snapshotInitialized && !this.snapshotAcquiring) this.loadSnapshot();
        } else if (this.snapshotAcquiring || !this.snapshotInitialized) {
          this.pending.push(value);
        } else {
          this.applyDelta(value);
        }
      },
      error: () => {
        this.connection.set('Stream non disponibile');
        this.loadSnapshot();
      },
    });
  }

  private loadSnapshot(): void {
    if (this.snapshotAcquiring) return;
    this.request?.unsubscribe();
    this.snapshotAcquiring = true;
    this.loading.set(true);
    this.request = this.api.payment(this.currentPa, this.currentNotice).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: payment => {
        this.setPayment(payment);
        this.revision = payment.projectionRevision;
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
        this.error.set(failure.status === 404
          ? 'Pagamento non disponibile: potrebbe non essere mai stato acquisito o essere scaduto per retention.'
          : failure.status === 401 || failure.status === 403
            ? 'Sessione non autorizzata a consultare questo pagamento.'
            : failure.status === 0
              ? 'Servizio non raggiungibile. Verifica che il backend sia attivo e riprova.'
              : `Dettaglio non disponibile (HTTP ${failure.status}).`);
      },
    });
  }

  private applyDelta(delta: PaymentDelta): void {
    const current = this.payment();
    if (!current) {
      if (!this.snapshotInitialized || this.snapshotAcquiring) {
        this.pending.push(delta);
        return;
      }
      if (delta.projectionRevision <= this.revision) return;
      if (delta.projectionRevision !== this.revision + 1) {
        this.pending.push(delta);
        this.resync();
        return;
      }
      if (delta.changes.deleted) {
        this.revision = delta.projectionRevision;
        this.error.set('Il pagamento non ha più tentativi in retention.');
        return;
      }
      const attempts = (delta.changes.attemptChanges ?? []).flatMap(change => change.upsert ? [change.upsert] : []);
      if (!attempts.length || !delta.changes.logicalTransitions?.length) {
        this.pending.push(delta);
        this.resync();
        return;
      }
      const timeline = delta.changes.logicalTransitions;
      const state = timeline.at(-1)?.state ?? 'INSERTED';
      const payment: Payment = {
        paFiscalCode: this.currentPa,
        noticeNumber: this.currentNotice,
        state,
        projectionRevision: delta.projectionRevision,
        timelineIncomplete: delta.changes.timelineIncomplete ?? false,
        hasAnomaly: timeline.some(item => item.timestampBasis === 'ANOMALY') || attempts.some(attempt => attempt.hasAnomaly),
        warning: attempts.some(attempt => attempt.warning),
        attemptCount: attempts.length,
        timeline,
        attempts: attempts.map(attempt => ({ ...attempt, projectionRevision: delta.projectionRevision })),
        recipients: (delta.changes.recipientChanges ?? [])
          .flatMap(change => (change.upsert ? [change.upsert] : []))
          .map(recipient => ({ ...recipient, projectionRevision: delta.projectionRevision })),
      };
      this.setPayment(payment);
      this.revision = delta.projectionRevision;
      this.error.set(null);
      return;
    }
    const result = applyPaymentDelta(current, delta);
    if (result.kind === 'duplicate') return;
    if (result.kind === 'gap') {
      this.pending.push(delta);
      this.resync();
      return;
    }
    this.revision = delta.projectionRevision;
    this.setPayment(result.payment);
    if (result.kind === 'deleted') {
      this.error.set('Il pagamento non ha più tentativi in retention.');
    }
  }

  private resync(): void {
    if (this.resyncing || this.snapshotAcquiring) return;
    this.resyncing = true;
    this.loadSnapshot();
  }

  private setPayment(payment: Payment | null): void {
    this.payment.set(payment);
    if (!payment) {
      this.tokenRevealRequests.unsubscribe();
      this.tokenRevealRequests = new Subscription();
      this.revealedTokens.set({});
      this.tokenRevealErrors.set({});
      this.pendingTokenIds.set(new Set());
      return;
    }

    const attemptIds = new Set(payment.attempts.map(attempt => attempt.attemptId));
    this.revealedTokens.update(tokens => Object.fromEntries(
      Object.entries(tokens).filter(([attemptId]) => attemptIds.has(attemptId)),
    ));
    this.tokenRevealErrors.update(errors => Object.fromEntries(
      Object.entries(errors).filter(([attemptId]) => attemptIds.has(attemptId)),
    ));
    this.pendingTokenIds.update(ids => new Set([...ids].filter(attemptId => attemptIds.has(attemptId))));
    this.revealMaskedAttempts(payment);
  }

  private revealMaskedAttempts(payment: Payment): void {
    const generation = this.paymentGeneration;
    for (const attempt of payment.attempts) {
      const attemptId = attempt.attemptId;
      if (!this.requiresReveal(attempt.tokenDisplay)
        || this.revealedTokens()[attemptId]
        || this.pendingTokenIds().has(attemptId)
        || this.tokenRevealErrors()[attemptId]) continue;

      this.pendingTokenIds.update(ids => new Set(ids).add(attemptId));
      this.tokenRevealRequests.add(this.api.reveal(attemptId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: result => {
            if (generation !== this.paymentGeneration
              || !this.payment()?.attempts.some(item => item.attemptId === attemptId)) return;
            this.pendingTokenIds.update(ids => {
              const next = new Set(ids);
              next.delete(attemptId);
              return next;
            });
            if (result.attemptId !== attemptId
              || typeof result.paymentToken !== 'string'
              || !result.paymentToken.trim()) {
              this.tokenRevealErrors.update(errors => ({
                ...errors,
                [attemptId]: 'Il server ha restituito un token non valido.',
              }));
              return;
            }
            this.revealedTokens.update(tokens => ({ ...tokens, [attemptId]: result.paymentToken }));
          },
          error: (failure: HttpErrorResponse) => {
            if (generation !== this.paymentGeneration
              || !this.payment()?.attempts.some(item => item.attemptId === attemptId)) return;
            this.pendingTokenIds.update(ids => {
              const next = new Set(ids);
              next.delete(attemptId);
              return next;
            });
            this.tokenRevealErrors.update(errors => ({
              ...errors,
              [attemptId]: failure.status === 403
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
}
