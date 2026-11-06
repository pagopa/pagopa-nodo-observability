import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { TimezoneService } from '../../core/timezone.service';
import { Attempt, Payment, TimelineItem } from '../../models/domain';
import { PaymentDetailComponent } from './payment-detail.component';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';

const transition = (state: string): TimelineItem => ({
  state,
  transitionAt: '2026-10-16T10:00:00.000Z',
  timestampBasis: 'SOURCE_EVENT',
});

const attempt = (id: string, state: string): Attempt => ({
  attemptId: id,
  paFiscalCode: '00000000001',
  noticeNumber: '300000000000000001',
  tokenDisplay: `SYNTHETIC-TOKEN-${id}`,
  state,
  warning: false,
  hasAnomaly: false,
  serviceIdentifier: null,
  psp: null,
  stazione: null,
  canale: null,
  attemptStartedAt: null,
  startTimestampBasis: 'ANOMALY',
  timelineIncomplete: false,
  timeline: [transition(state)],
  projectionRevision: 1,
});

const payment = (revision: number): Payment => ({
  paFiscalCode: '00000000001',
  noticeNumber: '300000000000000001',
  state: 'PAYING',
  projectionRevision: revision,
  timelineIncomplete: false,
  hasAnomaly: false,
  warning: false,
  attemptCount: 1,
  timeline: [transition('PAYING')],
  attempts: [attempt('attempt-1', 'PAYING')],
  recipients: [],
});

const delta = (projectionRevision: number, state: string, deleted = false) => ({
  projectionRevision,
  changes: {
    ...(deleted ? { deleted: true } : {
      logicalTransitions: [transition(state)],
      attemptChanges: [{ attemptId: 'attempt-2', transitions: [transition(state)], warning: false, upsert: attempt('attempt-2', state) }],
    }),
  },
});

describe('PaymentDetailComponent live snapshot reconciliation', () => {
  let stream: Subject<MessageEvent<string>>;
  let snapshots: Subject<Payment>[];
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let routeQuery: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let api: {
    connect: ReturnType<typeof vi.fn>;
    payment: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
    checkDb: ReturnType<typeof vi.fn>;
    reEvents: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    stream = new Subject<MessageEvent<string>>();
    snapshots = [];
    routeParams = new BehaviorSubject(convertToParamMap({ paFiscalCode: '00000000001', noticeNumber: '300000000000000001' }));
    routeQuery = new BehaviorSubject(convertToParamMap({}));
    api = {
      connect: vi.fn(() => stream),
      payment: vi.fn(() => {
        const request = new Subject<Payment>();
        snapshots.push(request);
        return request;
      }),
      reveal: vi.fn((attemptId: string) => of({
        attemptId,
        paymentToken: `SYNTHETIC-TOKEN-${attemptId}`,
      })),
      checkDb: vi.fn(),
      reEvents: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [PaymentDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          paramMap: routeParams,
          queryParamMap: routeQuery,
          snapshot: { queryParams: {} },
        } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: {
          token: signal('DEMO_OPERATOR'),
          session: signal({ id: 'operator' }),
        } },
        { provide: TimezoneService, useValue: { zone: () => 'Europe/Rome' } },
      ],
    }).compileComponents();
  });

  function emit(type: string, value: unknown): void {
    stream.next(new MessageEvent(type, { data: JSON.stringify(value) }));
  }

  it('opens a full screen RE snapshot for the correct token without altering live state', async () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    const item = payment(1);
    item.attempts.push(attempt('attempt-2', 'CANCELLED'));
    snapshots[0].next(item);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const attempt2 = [...host.querySelectorAll('article')].find((article) =>
      article.querySelector('h3')?.textContent?.includes('Tentativo attempt-2'),
    );
    expect(attempt2).toBeDefined();
    const reButton = [...(attempt2?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Recupera tentativo da RE',
    );
    expect(reButton).toBeDefined();
    if (!reButton) return;
    reButton.focus();
    reButton.click();
    await fixture.whenStable();
    const dialog = TestBed.inject(MatDialog).openDialogs[0];
    expect(dialog).toBeDefined();
    expect(dialog.componentInstance.data.paymentToken).toBe('SYNTHETIC-TOKEN-attempt-2');
    expect(dialog.componentInstance.data.attemptId).toBe('attempt-2');
    expect(dialog.componentInstance.data.suggestedWindow).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('UTC');
    expect(fixture.componentInstance.payment()).toEqual(item);
    const harness = await TestbedHarnessEnvironment.documentRootLoader(fixture).getHarness(MatDialogHarness);
    expect(await harness.getRole()).toBe('dialog');
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Chiudi consultazione RE'));
    const afterClosed = new Promise(resolve => dialog.afterClosed().subscribe(resolve));
    await harness.close();
    await afterClosed;
    expect(TestBed.inject(MatDialog).openDialogs.length).toBe(0);
    expect(document.activeElement).toBe(reButton);
  });

  it('groups Check DB and RE actions for every attempt without automatic checks', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    const item = payment(1);
    item.attempts = [
      { ...attempt('attempt-1', 'PAYING'), serviceIdentifier: 'svc-1' },
      { ...attempt('attempt-2', 'CANCELLED'), serviceIdentifier: 'svc-2' },
    ];
    snapshots[0].next(item);
    fixture.detectChanges();
    expect(api.checkDb).not.toHaveBeenCalled();
    expect(api.reEvents).not.toHaveBeenCalled();
    const host: HTMLElement = fixture.nativeElement;
    const groups = [
      ...host.querySelectorAll<HTMLElement>(
        '[role="group"][aria-label="Azioni diagnostiche del tentativo"]',
      ),
    ];
    expect(groups).toHaveLength(2);
    const traceButtons = [
      ...host.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Aggiorna cronologia primitive per il tentativo "]',
      ),
    ];
    expect(traceButtons).toHaveLength(2);
    for (const attemptId of ['attempt-1', 'attempt-2']) {
      const matchingGroups = groups.filter((group) =>
        group.querySelector(`button[aria-label="Check DB per il tentativo ${attemptId}"]`),
      );
      expect(matchingGroups).toHaveLength(1);
      const group = matchingGroups[0];
      expect(group.querySelector('button[aria-label^="Check DB"]')?.textContent?.trim()).toBe(
        'Check on DB Replica',
      );
      const reButton = [...group.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Recupera tentativo da RE',
      );
      expect(reButton).toBeDefined();
      expect(reButton?.disabled).toBe(false);
      expect(
        [...host.querySelectorAll('code')].some(
          (token) => token.textContent?.trim() === `SYNTHETIC-TOKEN-${attemptId}`,
        ),
      ).toBe(true);
      expect(
        traceButtons.some(
          (button) =>
            button.getAttribute('aria-label') ===
            `Aggiorna cronologia primitive per il tentativo ${attemptId}`,
        ),
      ).toBe(true);
    }
    expect(fixture.componentInstance.payment()).toEqual(item);
    fixture.destroy();
  });

  it('links only available attempts, reports an expired selection and exposes incomplete histories', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    routeQuery.next(convertToParamMap({ attemptId: 'expired' }));
    emit('message', { type: 'ready', projectionRevision: 0 });
    const snapshot = payment(1);
    snapshot.attempts[0].timelineIncomplete = true;
    snapshots[0].next(snapshot);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Stato posizione');
    expect(element.textContent).toContain('Tentativi disponibili in retention');
    expect(element.textContent).toContain('Il tentativo selezionato non è più disponibile');
    expect(element.textContent).toContain('Storia del tentativo incompleta');
    expect(element.querySelector('a[href*="attemptId=attempt-1"]')).not.toBeNull();
    expect(element.textContent).not.toContain('Tentativo 1');
    fixture.destroy();
  });

  it('reports missing recipients as unavailable, not an empty successful delivery list', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    snapshots[0].next({ ...payment(1), recipients: undefined } as unknown as Payment);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Destinatari non disponibili');
    expect(element.textContent).not.toContain('Nessun destinatario ricevuta per questo pagamento');
    fixture.destroy();
  });

  it('applies a contiguous restore after a deleted projection without waiting for another snapshot', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    snapshots[0].next(payment(1));
    emit('message', { type: 'payment.delta', ...delta(2, '', true) });

    expect(fixture.componentInstance.payment()).toBeNull();
    emit('message', { type: 'payment.delta', ...delta(3, 'PAYING') });

    expect(api.payment).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.payment()?.projectionRevision).toBe(3);
    expect(fixture.componentInstance.payment()?.attempts.map(item => item.attemptId)).toEqual(['attempt-2']);
    fixture.destroy();
  });

  it('identifies the current step separately in each accessible FSM progression', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    snapshots[0].next(payment(1));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const currentSteps = [...element.querySelectorAll('[aria-current="step"]')];
    expect(currentSteps).toHaveLength(2);
    expect(currentSteps.every(step => step.textContent?.includes('PAYING'))).toBe(true);
    expect(element.textContent).toContain('Percorsi possibili, non eventi osservati');
    fixture.destroy();
  });

  it('uses an adaptive grid without horizontal scrolling for every FSM progression', async () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    await fixture.whenStable();
    emit('message', { type: 'ready', projectionRevision: 0 });
    const snapshot = payment(1);
    snapshot.recipients = [{
      recipientId: 'recipient-1',
      stazioneRecipient: '00000000001_01',
      paFiscalCode: snapshot.paFiscalCode,
      noticeNumber: snapshot.noticeNumber,
      state: 'NOTICE_SENT',
      timelineIncomplete: false,
      hasAnomaly: false,
      timeline: [transition('NOTICE_SENT')],
      projectionRevision: 1,
    }];
    snapshots[0].next(snapshot);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    for (const label of [
      'Progressione FSM del pagamento logico',
      'Progressione FSM del tentativo',
      'Progressione FSM del destinatario ricevuta',
    ]) {
      const flow = element.querySelector<HTMLElement>(`[aria-label="${label}"]`);
      expect(flow, label).not.toBeNull();
      if (!flow) throw new Error(`Missing progression: ${label}`);
      const style = getComputedStyle(flow);
      expect(style.display, label).toBe('grid');
      expect(style.gridTemplateColumns, label).toContain('auto-fit');
      expect(style.overflowX, label).toBe('visible');
      for (const connector of flow.querySelectorAll('span:empty')) {
        expect(getComputedStyle(connector).display, label).toBe('none');
      }
    }
    fixture.destroy();
  });

  it('shows the primitive that triggered each attempt state transition', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    const snapshot = payment(1);
    snapshot.attempts[0].timeline[0].trigger = 'activatePaymentNotice';
    snapshots[0].next(snapshot);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Primitiva / trigger');
    expect(element.querySelector('.attempt .flow')?.textContent).toContain('activatePaymentNotice');
    expect(element.querySelector('.attempt .tbl tbody')?.textContent).toContain('activatePaymentNotice');
    fixture.destroy();
  });

  it('shows logical source provenance without replacing it with a receipt primitive', async () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    await fixture.whenStable();
    emit('message', { type: 'ready', projectionRevision: 0 });
    const snapshot = payment(1);
    snapshot.state = 'NOTIFIED';
    snapshot.timeline = [{ ...transition('NOTIFIED'), trigger: 'sendPaymentOutcomeV2' }];
    snapshots[0].next(snapshot);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const flow = element.querySelector('[aria-label="Progressione FSM del pagamento logico"]');
    expect(flow?.textContent).toContain('sendPaymentOutcomeV2');
    const table = element.querySelector('table');
    expect(table?.textContent).toContain('Primitiva / trigger');
    expect(table?.textContent).toContain('sendPaymentOutcomeV2');
    expect(table?.textContent).not.toContain('paSendRTV2');
    fixture.destroy();
  });

  it('buffers all deltas while a gap snapshot is being acquired and reconciles them atomically', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    snapshots[0].next(payment(1));

    emit('message', { type: 'payment.delta', ...delta(3, 'PAYING') });
    expect(api.payment).toHaveBeenCalledTimes(2);
    emit('message', { type: 'payment.delta', ...delta(4, 'PAID') });
    expect(fixture.componentInstance.payment()?.projectionRevision).toBe(1);

    snapshots[1].next(payment(2));

    expect(api.payment).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.payment()?.projectionRevision).toBe(4);
    expect(fixture.componentInstance.payment()?.attempts.find(item => item.attemptId === 'attempt-2')?.state).toBe('PAID');
    fixture.destroy();
  });

  it('removes an attempt from the view when a live delta drops it', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    snapshots[0].next(payment(1));

    emit('payment.delta', {
      projectionRevision: 2,
      changes: { removedAttemptIds: ['attempt-1'], deleted: false },
    });

    expect(fixture.componentInstance.payment()?.attempts).toEqual([]);
    fixture.destroy();
  });

  it('reveals a masked paymentToken for each attempt', () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    const snapshot = payment(1);
    snapshot.attempts[0].tokenDisplay = '••••••••';
    snapshots[0].next(snapshot);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(api.reveal).toHaveBeenCalledWith('attempt-1');
    expect(element.querySelector('.tok')?.textContent).toContain('SYNTHETIC-TOKEN-attempt-1');
    fixture.destroy();
  });

  it('selects and focuses the attempt identified by the opaque route query parameter', async () => {
    const fixture = TestBed.createComponent(PaymentDetailComponent);
    fixture.detectChanges();
    emit('message', { type: 'ready', projectionRevision: 0 });
    snapshots[0].next(payment(1));
    routeQuery.next(convertToParamMap({ attemptId: 'attempt-1' }));
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Tentativo selezionato dalla ricerca token');
    expect(document.activeElement?.id).toBe('attempt-attempt-1');
    fixture.destroy();
  });
});
