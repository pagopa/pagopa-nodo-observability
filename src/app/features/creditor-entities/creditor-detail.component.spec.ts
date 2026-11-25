import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { TimezoneService } from '../../core/timezone.service';
import { Overview, Station } from '../../models/domain';
import { CreditorDetailComponent } from './creditor-detail.component';

const snapshot: Overview = {
  snapshotAt: '2026-10-16T10:00:00.000Z',
  projectionRevision: 1,
  window: { from: '2026-10-16T09:00:00.000Z', to: '2026-10-16T10:00:00.000Z' },
  counts: { payments: 1, attempts: 1 },
  logicalStates: [{ state: 'PAYING', count: 1 }],
  attemptStates: [{ state: 'PAYING', count: 1 }],
  recipientStates: [{ state: 'NOTICE_SENT', count: 1 }],
  unresolved: { payments: 0, attempts: 0 },
  matrices: { psp: [], canale: [], recipient: [] },
  traffic: [{ bucketStart: '2026-10-16T09:00:00.000Z', startedAttempts: 99, estimatedStarts: 0 }],
  transitions: [],
  durations: [],
  anomalies: { transitions: 0, payments: 0 },
  freshness: {
    status: 'CURRENT',
    lagSeconds: 0,
    gapsDetected: false,
    observedAt: '2026-10-16T10:00:00.000Z',
    lastProcessedAt: '2026-10-16T10:00:00.000Z',
    lastPublishedAt: '2026-10-16T10:00:00.000Z',
  },
};
const station: Station = {
  stazione: 'station-1',
  traffic: [{ bucketStart: '2026-10-16T09:00:00.000Z', startedAttempts: 4, estimatedStarts: 1 }],
  startedAttempts: 4,
  logicalStates: [{ state: 'PAYING', count: 1 }],
  attemptStates: [{ state: 'PAYING', count: 1 }],
  unresolved: { payments: 0, attempts: 0 },
};

describe('CreditorDetailComponent station traffic', () => {
  it('renders station-specific interval series instead of substituting creditor totals', async () => {
    const api = {
      connect: vi.fn(() => throwError(() => new Error('offline'))),
      creditor: vi.fn(() => of(snapshot)),
      stations: vi.fn(() => of({ items: [station], nextCursor: null, snapshotRevision: 1 })),
    };
    await TestBed.configureTestingModule({
      imports: [CreditorDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          paramMap: of(convertToParamMap({ paFiscalCode: '00000000001' })),
          queryParamMap: of(convertToParamMap({ window: '1h', attemptState: 'PAYMENT_UNKNOWN', psp: 'psp-old' })),
          snapshot: { queryParams: {
            window: '1h',
            attemptState: 'PAYMENT_UNKNOWN',
            psp: 'psp-old',
            from: 'unsupported',
            to: 'unsupported',
          } },
        } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER'), session: signal(null) } },
        { provide: TimezoneService, useValue: { zone: () => 'UTC' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CreditorDetailComponent);
    fixture.detectChanges();

    const content = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(content).toContain('4 avvii');
    expect(content).toContain('1 stimati');
    expect(content).not.toContain('99 avvii');
    expect(api.stations).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.attemptListParams({ attemptState: 'PAID', stazione: 'station-1' })).toEqual({
      window: '1h',
      attemptState: 'PAID',
      psp: 'psp-old',
      paFiscalCode: '00000000001',
      view: 'attempts',
      stazione: 'station-1',
    });
    fixture.destroy();
  });

  it('queues events through initial and gap snapshots without overwriting newer revisions', async () => {
    const stream = new Subject<MessageEvent<string>>();
    const requests: Subject<Overview>[] = [];
    const api = {
      connect: vi.fn(() => stream),
      creditor: vi.fn(() => {
        const request = new Subject<Overview>();
        requests.push(request);
        return request;
      }),
      stations: vi.fn(() => of({ items: [], nextCursor: null, snapshotRevision: 1 })),
    };
    await TestBed.configureTestingModule({
      imports: [CreditorDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          paramMap: of(convertToParamMap({ paFiscalCode: '00000000001' })),
          queryParamMap: of(convertToParamMap({ window: '1h' })),
          snapshot: { queryParams: { window: '1h' } },
        } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER'), session: signal(null) } },
        { provide: TimezoneService, useValue: { zone: () => 'UTC' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CreditorDetailComponent);
    fixture.detectChanges();
    const emit = (value: unknown) => stream.next(new MessageEvent('message', { data: JSON.stringify(value) }));
    const delta = (revision: number) => ({
      type: 'aggregate.delta',
      projectionRevision: revision,
      changes: {
        counts: {},
        logicalStates: [],
        attemptStates: [],
        traffic: [],
        transitions: [],
        matrices: { psp: [], canale: [], recipient: [] },
        anomalies: { transitions: 0, payments: 0 },
        durationSnapshot: [],
      },
    });

    emit({ type: 'ready', projectionRevision: 0 });
    emit(delta(2));
    requests[0].next(snapshot);
    expect(fixture.componentInstance.snapshot()?.projectionRevision).toBe(2);

    emit(delta(4));
    expect(api.creditor).toHaveBeenCalledTimes(2);
    emit(delta(5));
    requests[1].next({ ...snapshot, projectionRevision: 4 });

    expect(api.creditor).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.snapshot()?.projectionRevision).toBe(5);
    expect(fixture.componentInstance.stationResultsChanged()).toBe(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('pagina delle stazioni non si sposta automaticamente');
    fixture.destroy();
  });
});
