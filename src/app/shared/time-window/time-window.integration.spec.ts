import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { OverviewComponent } from '../../features/overview/overview.component';
import { CreditorsComponent } from '../../features/creditor-entities/creditors.component';
import { CreditorDetailComponent } from '../../features/creditor-entities/creditor-detail.component';
import { Overview, Page } from '../../models/domain';

describe.each([
  { name: 'Overview', component: OverviewComponent },
  { name: 'Creditors', component: CreditorsComponent },
  { name: 'Creditor detail', component: CreditorDetailComponent },
])('$name time window integration', ({ component }) => {
  const fixed = { from: '2026-10-20T12:00:00.000Z', to: '2026-10-20T12:15:00.000Z' };
  const setup = async (params: Record<string, string>) => {
    const query = new BehaviorSubject(convertToParamMap(params));
    const data: Overview = {
      snapshotAt: fixed.to,
      projectionRevision: 1,
      window: fixed,
      counts: { payments: 0, attempts: 0 },
      unresolved: { payments: 0, attempts: 0 },
      logicalStates: [],
      attemptStates: [],
      recipientStates: [],
      matrices: { psp: [], canale: [], recipient: [] },
      traffic: [],
      transitions: [],
      durations: [],
      anomalies: { transitions: 0, payments: 0 },
      freshness: {
        status: 'CURRENT',
        lagSeconds: 0,
        gapsDetected: false,
        observedAt: fixed.to,
        lastProcessedAt: fixed.to,
        lastPublishedAt: fixed.to,
      },
    };
    const api = {
      nodeServices: vi.fn(() => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] })),
      connect: vi.fn<(filters: Record<string, string>) => Observable<MessageEvent<string>>>(() =>
        of(new MessageEvent('ready', { data: JSON.stringify({ type: 'ready' }) })),
      ),
      overview: vi.fn<(filters: Record<string, string>) => Observable<Overview>>(() => of(data)),
      creditor: vi.fn<(code: string, filters: Record<string, string>) => Observable<Overview>>(() =>
        of(data),
      ),
      maintenances: vi.fn(() => of({ fetchedAt: '2026-11-04T00:00:00.000Z', windowFrom: '2026-11-04T00:00:00.000Z', windowTo: '2026-11-11T00:00:00.000Z', stale: false, items: [] })),
      creditors: vi.fn<(filters: Record<string, string>) => Observable<Page<never>>>(() =>
        of({ items: [], nextCursor: null, snapshotRevision: 1 }),
      ),
      stations: vi.fn<(code: string, filters: Record<string, string>) => Observable<Page<never>>>(
        () => of({ items: [], nextCursor: null, snapshotRevision: 1 }),
      ),
      catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
    };
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: query,
            paramMap: of(convertToParamMap({ paFiscalCode: '00000000001' })),
            snapshot: { queryParams: params },
          },
        },
        { provide: ObservabilityApi, useValue: api },
        {
          provide: SessionService,
          useValue: { token: signal('demo'), session: signal({ id: 'viewer' }) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent<
      OverviewComponent | CreditorsComponent | CreditorDetailComponent
    >(component);
    await fixture.whenStable();
    return { fixture, api, query };
  };

  const requests = (api: Awaited<ReturnType<typeof setup>>['api']) => [
    ...api.connect.mock.calls.map((call) => call[0]),
    ...api.overview.mock.calls.map((call) => call[0]),
    ...api.creditors.mock.calls.map((call) => call[0]),
    ...api.creditor.mock.calls.map((call) => call[1]),
    ...api.stations.mock.calls.map((call) => call[1]),
  ];

  it.each([
    ['5m', 5],
    ['15m', 15],
    ['30m', 30],
  ] as const)('uses the exact %s preset for REST and SSE', async (window, minutes) => {
    const { api } = await setup({ window });
    const calls = requests(api);
    expect(calls.length).toBeGreaterThan(0);
    for (const bounds of calls) {
      expect(Date.parse(bounds['to']) - Date.parse(bounds['from'])).toBe(minutes * 60_000);
    }
    expect(new Set(calls.map((bounds) => `${bounds['from']}/${bounds['to']}`)).size).toBe(1);
  });

  it('uses fixed bounds for REST, SSE, retries and drill-down links', async () => {
    const { api, fixture } = await setup({ window: 'custom', ...fixed });
    fixture.componentInstance.retry();
    for (const bounds of requests(api)) expect(bounds).toMatchObject(fixed);
    const instance = fixture.componentInstance;
    if (instance instanceof OverviewComponent || instance instanceof CreditorDetailComponent) {
      expect(instance.attemptListParams()).toMatchObject({ window: 'custom', ...fixed });
    }
  });

  it('blocks invalid URL bounds, cancels stale requests and recovers on a valid range', async () => {
    const { api, fixture, query } = await setup({
      window: 'custom',
      from: 'invalid',
      to: fixed.to,
    });
    expect(requests(api)).toEqual([]);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent,
    ).toBeTruthy();
    query.next(convertToParamMap({ window: '5m' }));
    await fixture.whenStable();
    expect(requests(api).length).toBeGreaterThan(0);
  });
});
