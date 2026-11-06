import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { Creditor, Page, Session } from '../../models/domain';
import { CreditorsComponent } from './creditors.component';

const creditor = (paFiscalCode: string): Creditor => ({
  paFiscalCode,
  startedAttempts: 1,
  counts: { payments: 1, attempts: 1 },
  logicalStates: [{ state: 'PAYING', count: 1 }],
  unresolved: { payments: 0, attempts: 0 },
});
const page = (items: Creditor[], nextCursor: string | null = null): Page<Creditor> => ({
  items,
  nextCursor,
  snapshotRevision: 1,
});
const viewer: Session = {
  id: 'viewer',
  authentication: 'LOCAL_DEMO_ONLY',
};
const paViewer: Session = {
  ...viewer,
  id: 'pa-viewer',
};

describe('CreditorsComponent session and cursor behavior', () => {
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let token: ReturnType<typeof signal<string>>;
  let activeSession: ReturnType<typeof signal<Session | null>>;
  let requests: Record<string, string | undefined>[];
  let streams: Subject<MessageEvent<string>>[];
  let api: { creditors: ReturnType<typeof vi.fn>; maintenances: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    query = new BehaviorSubject(convertToParamMap({ window: '1h' }));
    token = signal('DEMO_VIEWER');
    activeSession = signal<Session | null>(viewer);
    requests = [];
    streams = [];
    api = {
      maintenances: vi.fn(() => of({ fetchedAt: '2026-11-04T00:00:00.000Z', windowFrom: '2026-11-04T00:00:00.000Z', windowTo: '2026-11-11T00:00:00.000Z', stale: false, items: [] })),
      creditors: vi.fn((filters: Record<string, string | undefined>) => {
        requests.push(filters);
        const visible = activeSession()?.id === 'pa-viewer' ? ['00000000001'] : null;
        const rows = [creditor('00000000001'), creditor('00000000002')]
          .filter(row => !visible || visible.includes(row.paFiscalCode));
        return of(page(rows, requests.length === 1 ? 'next' : null));
      }),
      connect: vi.fn(() => {
        const stream = new Subject<MessageEvent<string>>();
        streams.push(stream);
        return stream;
      }),
    };
    await TestBed.configureTestingModule({
      imports: [CreditorsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: { queryParamMap: query, snapshot: { queryParams: {} } } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: { token, session: activeSession } },
      ],
    }).compileComponents();
  });

  it('clears scoped results and reloads after the verified PA identity changes', async () => {
    const fixture = TestBed.createComponent(CreditorsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.rows()).toHaveLength(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-state-badge')?.textContent).toContain('Posizione in pagamento');
    expect(api.connect).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-state-badge summary')?.textContent).toContain('PAYING');
    streams[0].next(new MessageEvent('list.changed', { data: JSON.stringify({ type: 'list.changed' }) }));
    expect(fixture.componentInstance.resultsChanged()).toBe(true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('dati degli enti visibili sono cambiati');

    fixture.componentInstance.next();
    expect(requests[1]['cursor']).toBe('next');
    token.set('DEMO_PA_VIEWER');
    expect(fixture.componentInstance.rows()).toEqual([]);
    activeSession.set(paViewer);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(requests).toHaveLength(3);
    expect(requests[2]['cursor']).toBeUndefined();
    expect(fixture.componentInstance.rows().map(row => row.paFiscalCode)).toEqual(['00000000001']);
    expect(streams[0].observed).toBe(false);
    expect(streams[1].observed).toBe(false);
    expect(streams[2].observed).toBe(true);
    expect(api.connect).toHaveBeenCalledTimes(3);
    fixture.destroy();
  });

  it('reuses one exact interval across cursor pages and freezes a new interval after filter changes', () => {
    const fixture = TestBed.createComponent(CreditorsComponent);
    fixture.detectChanges();
    const firstWindow = [requests[0]['from'], requests[0]['to']];

    fixture.componentInstance.next();
    expect(requests[1]['cursor']).toBe('next');
    expect([requests[1]['from'], requests[1]['to']]).toEqual(firstWindow);

    query.next(convertToParamMap({ window: '24h' }));
    fixture.detectChanges();
    expect(requests[2]['cursor']).toBeUndefined();
    expect([requests[2]['from'], requests[2]['to']]).not.toEqual(firstWindow);
    fixture.destroy();
  });

  it('uses one stream for the visible creditor page and handles replay expiry and terminal stream errors', () => {
    const fixture = TestBed.createComponent(CreditorsComponent);
    fixture.detectChanges();

    expect(api.connect).toHaveBeenCalledTimes(1);
    expect(api.connect).toHaveBeenCalledWith({
      scope: 'creditor-list',
      keys: '00000000001,00000000002',
    });
    streams[0].next(new MessageEvent('ready', { data: JSON.stringify({
      type: 'ready', projectionRevision: 2,
    }) }));
    expect(fixture.componentInstance.resultsChanged()).toBe(true);
    streams[0].next(new MessageEvent('list.changed', { data: JSON.stringify({
      type: 'list.changed', projectionRevision: 3,
    }) }));
    expect(fixture.componentInstance.resultsChanged()).toBe(true);
    expect(api.creditors).toHaveBeenCalledTimes(1);
    streams[0].next(new MessageEvent('replay-expired'));
    expect(fixture.componentInstance.resultsChanged()).toBe(true);
    streams[0].error(new Error('terminal'));

    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Stream non disponibile');
    fixture.destroy();
  });
});
