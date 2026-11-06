import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, convertToParamMap, Router } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { ObservabilityApi, StreamHttpError } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { Attempt, PaymentSummary, Session } from '../../models/domain';
import { PaymentsComponent } from './payments.component';

const viewer: Session = {
  id: 'viewer',
  authentication: 'LOCAL_DEMO_ONLY',
};

const paymentRow = (index: number, paFiscalCode = '00000000001'): PaymentSummary => ({
  paFiscalCode,
  noticeNumber: `3000000000000000${String(index).padStart(2, '0')}`,
  state: 'PAYING',
  projectionRevision: 1,
  timelineIncomplete: false,
  hasAnomaly: false,
  warning: false,
  attemptCount: 1,
});

const attemptRow = (index: number): Attempt => ({
  attemptId: `attempt-${index}`,
  paFiscalCode: '00000000001',
  noticeNumber: `3000000000000000${String(index).padStart(2, '0')}`,
  tokenDisplay: `SYNTHETIC-TOKEN-${index}-1`,
  state: 'PAYING',
  warning: false,
  hasAnomaly: false,
  serviceIdentifier: null,
  psp: null,
  stazione: null,
  canale: null,
  attemptStartedAt: null,
  startTimestampBasis: 'ANOMALY',
  timelineIncomplete: false,
  timeline: [],
  projectionRevision: 1,
});

describe('PaymentsComponent token lookup navigation', () => {
  it('passes only the opaque attemptId into the detail route and keeps list filters', async () => {
    const filters = {
      view: 'attempts',
      window: '24h',
      psp: 'psp-a',
      paFiscalCode: '00000000001',
      noticeNumber: '300000000000000001',
    };
    const api = {
      catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
      payments: vi.fn(() => of({ items: [], nextCursor: null, snapshotRevision: 1 })),
      lookupToken: vi.fn(() => of({
        paFiscalCode: '00000000001',
        noticeNumber: '300000000000000001',
        attemptId: 'attempt-opaque-7',
      })),
      connect: vi.fn(() => of()),
    };
    await TestBed.configureTestingModule({
      imports: [PaymentsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          queryParamMap: of(convertToParamMap(filters)),
          snapshot: { queryParams: filters },
        } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: {
          token: signal('DEMO_OPERATOR'),
          session: signal({ id: 'operator', authentication: 'LOCAL_DEMO_ONLY' }),
        } },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(PaymentsComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('optgroup[label="Prenotazione e notifica PSP"]')?.textContent).toContain('PAYMENT_ACCEPTED');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Stato tentativo');
    fixture.componentInstance.tokenInput.set('secret-payment-token');
    fixture.componentInstance.lookupToken();

    expect(api.lookupToken).toHaveBeenCalledWith('secret-payment-token', {
      paFiscalCode: '00000000001',
      noticeNumber: '300000000000000001',
    });
    expect(navigate).toHaveBeenCalledWith(
      ['/payments', '00000000001', '300000000000000001'],
      { queryParams: { ...filters, attemptId: 'attempt-opaque-7' } },
    );
    expect(JSON.stringify(navigate.mock.calls)).not.toContain('secret-payment-token');
    expect(fixture.componentInstance.detailParams('attempt-opaque-7')).toEqual({ ...filters, attemptId: 'attempt-opaque-7' });
    fixture.destroy();
  });

  describe('PaymentsComponent page-scoped live updates', () => {
    it('opens one stream for eight visible payments and detects races and invalidations without an automatic GET', async () => {
      const query = new BehaviorSubject(convertToParamMap({}));
      const stream = new Subject<MessageEvent<string>>();
      const rows = Array.from({ length: 8 }, (_, index) => paymentRow(index + 1));
      const api = {
        catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
        payments: vi.fn(() => of({ items: rows, nextCursor: null, snapshotRevision: 1 })),
        lookupToken: vi.fn(),
        connect: vi.fn(() => stream),
      };
      await TestBed.configureTestingModule({
        imports: [PaymentsComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          { provide: ActivatedRoute, useValue: { queryParamMap: query, snapshot: { queryParams: {} } } },
          { provide: ObservabilityApi, useValue: api },
          { provide: SessionService, useValue: { token: signal('DEMO_VIEWER'), session: signal(viewer) } },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(PaymentsComponent);
      fixture.detectChanges();
      expect(api.connect).toHaveBeenCalledTimes(1);
      expect(api.connect).toHaveBeenCalledWith({
        scope: 'payment-list',
        keys: Array.from({ length: 8 }, (_, index) =>
          `00000000001:3000000000000000${String(index + 1).padStart(2, '0')}`).join(','),
      });

      stream.next(new MessageEvent('ready', { data: JSON.stringify({
        type: 'ready', projectionRevision: 2,
      }) }));
      expect(fixture.componentInstance.resultsChanged()).toBe(true);
      stream.next(new MessageEvent('list.changed', { data: JSON.stringify({
        type: 'list.changed', projectionRevision: 3,
      }) }));
      expect(fixture.componentInstance.resultsChanged()).toBe(true);
      expect(api.payments).toHaveBeenCalledTimes(1);

      stream.next(new MessageEvent('replay-expired'));
      expect(fixture.componentInstance.resultsChanged()).toBe(true);
      stream.error(new StreamHttpError(404));
      expect(fixture.componentInstance.liveStatus()).toContain('prima della sottoscrizione');
      expect(fixture.componentInstance.resultsChanged()).toBe(true);
      fixture.destroy();
    });

    it('uses one stream for a page of attempts and replaces it when route filters change', async () => {
      const query = new BehaviorSubject(convertToParamMap({ view: 'attempts' }));
      const streams = [new Subject<MessageEvent<string>>(), new Subject<MessageEvent<string>>()];
      let requestedPage = 0;
      let connected = 0;
      const api = {
        catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
        payments: vi.fn(() => {
          requestedPage++;
          const items = Array.from({ length: 20 }, (_, index) => ({
            ...attemptRow(index + 1),
            tokenDisplay: '••••••••',
          }));
          return of({ items, nextCursor: null, snapshotRevision: requestedPage });
        }),
        reveal: vi.fn((attemptId: string) => attemptId === 'attempt-2'
          ? throwError(() => ({ status: 403 }))
          : of({
            attemptId,
            paymentToken: `SYNTHETIC-TOKEN-${attemptId.slice(-1)}-1`,
          })),
        lookupToken: vi.fn(),
        connect: vi.fn(() => streams[connected++]),
      };
      await TestBed.configureTestingModule({
        imports: [PaymentsComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          { provide: ActivatedRoute, useValue: { queryParamMap: query, snapshot: { queryParams: {} } } },
          { provide: ObservabilityApi, useValue: api },
          { provide: SessionService, useValue: { token: signal('DEMO_VIEWER'), session: signal(viewer) } },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(PaymentsComponent);
      fixture.detectChanges();
      const table = (fixture.nativeElement as HTMLElement).querySelector('.tbl');
      expect(table?.textContent).toContain('SYNTHETIC-TOKEN-1-1');
      expect(table?.querySelector('[role="alert"]')?.textContent)
        .toContain('non autorizza la visualizzazione');
      expect(api.connect).toHaveBeenCalledTimes(1);
      expect(api.connect).toHaveBeenCalledWith({
        scope: 'payment-list',
        keys: Array.from({ length: 20 }, (_, index) =>
          `00000000001:3000000000000000${String(index + 1).padStart(2, '0')}`).join(','),
      });

      query.next(convertToParamMap({ view: 'attempts', psp: 'ABI00001' }));
      fixture.detectChanges();
      expect(api.connect).toHaveBeenCalledTimes(2);
      expect(streams[0].observed).toBe(false);
      fixture.destroy();
    });

    it('clears page state and cancels token input when the verified identity changes', async () => {
      const query = new BehaviorSubject(convertToParamMap({}));
      const token = signal('DEMO_VIEWER');
      const activeSession = signal<Session | null>(viewer);
      const requests: Record<string, string | undefined>[] = [];
      const streams: Subject<MessageEvent<string>>[] = [];
      const api = {
        catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
        payments: vi.fn((filters: Record<string, string | undefined>) => {
          requests.push(filters);
          const pa = activeSession()?.id === 'pa-viewer' ? '00000000001' : '00000000002';
          const items = activeSession() ? [paymentRow(pa === '00000000001' ? 1 : 2, pa)] : [];
          return of({ items, nextCursor: requests.length === 1 ? 'next' : null, snapshotRevision: requests.length });
        }),
        lookupToken: vi.fn(),
        connect: vi.fn(() => {
          const stream = new Subject<MessageEvent<string>>();
          streams.push(stream);
          return stream;
        }),
      };
      await TestBed.configureTestingModule({
        imports: [PaymentsComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          { provide: ActivatedRoute, useValue: { queryParamMap: query, snapshot: { queryParams: {} } } },
          { provide: ObservabilityApi, useValue: api },
          { provide: SessionService, useValue: { token, session: activeSession } },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(PaymentsComponent);
      fixture.detectChanges();
      fixture.componentInstance.next();
      expect(fixture.componentInstance.hasPrevious()).toBe(true);
      fixture.componentInstance.tokenInput.set('secret');

      token.set('DEMO_PA_VIEWER');
      expect(fixture.componentInstance.rows()).toEqual([]);
      activeSession.set(null);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.rows()).toEqual([]);
      expect(fixture.componentInstance.nextCursor()).toBeNull();
      expect(fixture.componentInstance.hasPrevious()).toBe(false);
      expect(fixture.componentInstance.tokenInput()).toBe('');
      expect(requests).toHaveLength(2);

      activeSession.set({ ...viewer, id: 'pa-viewer' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(requests).toHaveLength(3);
      expect(requests[2]['cursor']).toBeUndefined();
      expect(fixture.componentInstance.rows().map(row => row.paFiscalCode)).toEqual(['00000000001']);
      expect(streams[0].observed).toBe(false);
      expect(streams[1].observed).toBe(false);
      expect(streams[2].observed).toBe(true);
      fixture.destroy();
    });

    it('does not navigate from a token lookup after the PA/NAV filter changes', async () => {
      const filters = { paFiscalCode: '00000000001', noticeNumber: '300000000000000001' };
      const query = new BehaviorSubject(convertToParamMap(filters));
      const response = new Subject<{ paFiscalCode: string; noticeNumber: string; attemptId: string }>();
      const api = {
        catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
        payments: vi.fn(() => of({ items: [], nextCursor: null, snapshotRevision: 1 })),
        lookupToken: vi.fn(() => response),
        connect: vi.fn(() => of()),
      };
      await TestBed.configureTestingModule({
        imports: [PaymentsComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          { provide: ActivatedRoute, useValue: { queryParamMap: query, snapshot: { queryParams: filters } } },
          { provide: ObservabilityApi, useValue: api },
          { provide: SessionService, useValue: {
            token: signal('DEMO_OPERATOR'),
            session: signal({ id: 'operator', authentication: 'LOCAL_DEMO_ONLY' }),
          } },
        ],
      }).compileComponents();

      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const fixture = TestBed.createComponent(PaymentsComponent);
      fixture.detectChanges();
      fixture.componentInstance.tokenInput.set('secret');
      fixture.componentInstance.lookupToken();
      expect(api.lookupToken).toHaveBeenCalledWith('secret', filters);

      query.next(convertToParamMap({ paFiscalCode: '00000000002', noticeNumber: '300000000000000002' }));
      fixture.detectChanges();
      response.next({ paFiscalCode: '00000000001', noticeNumber: '300000000000000001', attemptId: 'attempt-1' });

      expect(navigate).not.toHaveBeenCalled();
      expect(JSON.stringify(navigate.mock.calls)).not.toContain('secret');
      fixture.destroy();
    });
  });

  describe('PaymentsComponent service identifier catalog', () => {
    interface CatalogResponse {
      serviceIdentifiers: string[];
    }

    interface PaymentsApiMock {
      catalogWithServiceIdentifiers: ReturnType<typeof vi.fn>;
      payments: ReturnType<typeof vi.fn>;
      lookupToken: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
    }

    const createApi = (catalog: () => Observable<CatalogResponse>): PaymentsApiMock => ({
      catalogWithServiceIdentifiers: vi.fn(catalog),
      payments: vi.fn(() => of({ items: [], nextCursor: null, snapshotRevision: 1 })),
      lookupToken: vi.fn(),
      connect: vi.fn(() => of()),
    });

    const createFixture = async (
      api: PaymentsApiMock,
      queryParams: Record<string, string> = {},
    ): Promise<ComponentFixture<PaymentsComponent>> => {
      await TestBed.configureTestingModule({
        imports: [PaymentsComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          { provide: ActivatedRoute, useValue: {
            queryParamMap: of(convertToParamMap(queryParams)),
            snapshot: { queryParams },
          } },
          { provide: ObservabilityApi, useValue: api },
          { provide: SessionService, useValue: { token: signal('DEMO_VIEWER'), session: signal(viewer) } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(PaymentsComponent);
      fixture.detectChanges();
      return fixture;
    };

    const serviceSelect = (fixture: ComponentFixture<PaymentsComponent>): HTMLSelectElement =>
      fixture.nativeElement.querySelector('select[aria-label="Identificativo del servizio"]') as HTMLSelectElement;

    it('shows populated catalog options and selects the active query parameter', async () => {
      const fixture = await createFixture(createApi(() => of({ serviceIdentifiers: ['svc-1', 'svc-2'] })), {
        serviceIdentifier: 'svc-2',
      });

      expect([...serviceSelect(fixture).options].map(option => option.textContent?.trim()))
        .toEqual(['Tutti', 'svc-1', 'svc-2']);
      expect(serviceSelect(fixture).value).toBe('svc-2');
      expect(fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]')).toBeNull();
      fixture.destroy();
    });

    it('shows only Tutti when the catalog is empty and no filter is active', async () => {
      const fixture = await createFixture(createApi(() => of({ serviceIdentifiers: [] })));

      expect([...serviceSelect(fixture).options].map(option => option.textContent?.trim())).toEqual(['Tutti']);
      expect(serviceSelect(fixture).disabled).toBe(false);
      fixture.destroy();
    });

    it('preserves and allows clearing a stale active filter from an empty catalog', async () => {
      const fixture = await createFixture(createApi(() => of({ serviceIdentifiers: [] })), {
        serviceIdentifier: 'svc-removed',
      });
      const select = serviceSelect(fixture);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      expect(select.value).toBe('svc-removed');
      expect([...select.options].map(option => option.textContent?.trim())).toEqual([
        'Tutti',
        'svc-removed (non presente nell’elenco)',
      ]);
      select.value = '';
      select.dispatchEvent(new Event('change'));
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
        queryParams: { serviceIdentifier: null },
        queryParamsHandling: 'merge',
      }));
      fixture.destroy();
    });

    it('preserves and allows clearing a stale active filter when the catalog has other services', async () => {
      const request = new Subject<CatalogResponse>();
      const fixture = await createFixture(createApi(() => request), { serviceIdentifier: 'svc-stale' });
      const select = serviceSelect(fixture);
      const staleOptionLabel = () => [...select.options]
        .find(option => option.value === 'svc-stale')?.textContent?.trim();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      expect(select.value).toBe('svc-stale');
      expect(staleOptionLabel()).toBe('svc-stale');

      request.next({ serviceIdentifiers: ['svc-listed'] });
      request.complete();
      fixture.detectChanges();

      expect(select.value).toBe('svc-stale');
      expect(staleOptionLabel()).toBe('svc-stale (non presente nell’elenco)');
      const optionLabels = [...select.options].map(option => option.textContent?.trim());
      expect(optionLabels).toContain('Tutti');
      expect(optionLabels).toContain('svc-listed');
      expect(optionLabels).toContain('svc-stale (non presente nell’elenco)');

      select.value = '';
      select.dispatchEvent(new Event('change'));
      expect(select.value).toBe('');
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
        queryParams: { serviceIdentifier: null },
        queryParamsHandling: 'merge',
      }));
      fixture.destroy();
    });

    it('shows loading and disables the select while catalog data is pending', async () => {
      const request = new Subject<CatalogResponse>();
      const fixture = await createFixture(createApi(() => request), { serviceIdentifier: 'svc-active' });

      expect(serviceSelect(fixture).disabled).toBe(true);
      expect(serviceSelect(fixture).value).toBe('svc-active');
      expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Caricamento elenco');
      expect(fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]')).toBeNull();
      fixture.destroy();
    });

    it('does not mark a URL value obsolete until a catalog request succeeds', async () => {
      const initialRequest = new Subject<CatalogResponse>();
      const retryRequest = new Subject<CatalogResponse>();
      const api = createApi(() => of({ serviceIdentifiers: [] }));
      api.catalogWithServiceIdentifiers.mockReset()
        .mockReturnValueOnce(initialRequest)
        .mockReturnValueOnce(retryRequest);
      const fixture = await createFixture(api, { serviceIdentifier: 'svc-stale' });
      const staleOptionLabel = () => [...serviceSelect(fixture).options]
        .find(option => option.value === 'svc-stale')?.textContent?.trim();

      expect(staleOptionLabel()).toBe('svc-stale');
      initialRequest.error(new Error('catalog unavailable'));
      fixture.detectChanges();
      expect(staleOptionLabel()).toBe('svc-stale');

      (fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      retryRequest.next({ serviceIdentifiers: ['svc-current'] });
      retryRequest.complete();
      fixture.detectChanges();
      expect(staleOptionLabel()).toBe('svc-stale (non presente nell’elenco)');
      fixture.destroy();
    });

    it('shows a separate catalog error and retries without losing the URL filter', async () => {
      const initialRequest = new Subject<CatalogResponse>();
      const retryRequest = new Subject<CatalogResponse>();
      const api = createApi(() => of({ serviceIdentifiers: [] }));
      api.catalogWithServiceIdentifiers.mockReset()
        .mockReturnValueOnce(initialRequest)
        .mockReturnValueOnce(retryRequest);
      const fixture = await createFixture(api, { serviceIdentifier: 'svc-active' });
      initialRequest.error(new Error('catalog unavailable'));
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
      const retry = fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]') as HTMLButtonElement;
      expect(alert.textContent).toContain('elenco degli identificativi');
      expect(serviceSelect(fixture).disabled).toBe(true);
      expect(fixture.componentInstance.error()).toBeNull();
      expect(retry.disabled).toBe(false);
      expect(serviceSelect(fixture).value).toBe('svc-active');

      retry.click();
      fixture.detectChanges();
      expect(api.catalogWithServiceIdentifiers).toHaveBeenCalledTimes(2);
      expect((fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]') as HTMLButtonElement).disabled)
        .toBe(true);
      expect(serviceSelect(fixture).disabled).toBe(true);
      expect(serviceSelect(fixture).value).toBe('svc-active');

      retryRequest.next({ serviceIdentifiers: ['svc-active', 'svc-other'] });
      retryRequest.complete();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]')).toBeNull();
      expect(serviceSelect(fixture).disabled).toBe(false);
      expect(serviceSelect(fixture).value).toBe('svc-active');
      fixture.destroy();
    });

    it('keeps the catalog error visible and select disabled after a failed retry', async () => {
      const initialRequest = new Subject<CatalogResponse>();
      const retryRequest = new Subject<CatalogResponse>();
      const api = createApi(() => of({ serviceIdentifiers: [] }));
      api.catalogWithServiceIdentifiers.mockReset()
        .mockReturnValueOnce(initialRequest)
        .mockReturnValueOnce(retryRequest);
      const fixture = await createFixture(api);
      initialRequest.error(new Error('initial failure'));
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      retryRequest.error(new Error('retry failure'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent)
        .toContain('elenco degli identificativi');
      expect(serviceSelect(fixture).disabled).toBe(true);
      expect((fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]') as HTMLButtonElement).disabled)
        .toBe(false);
      fixture.destroy();
    });
  });
});

describe('PaymentsComponent observation window', () => {
  const create = async (params: Record<string, string>) => {
    const api = {
      catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
      payments: vi.fn<(filters: Record<string, string | undefined>) => Observable<unknown>>(() => of({ items: [], nextCursor: null, snapshotRevision: 1 })),
      connect: vi.fn(() => of()),
    };
    await TestBed.configureTestingModule({
      imports: [PaymentsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          queryParamMap: of(convertToParamMap(params)),
          snapshot: { queryParams: params },
        } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: {
          token: signal('DEMO_OPERATOR'),
          session: signal({ id: 'operator', authentication: 'LOCAL_DEMO_ONLY' }),
        } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return { api, fixture };
  };

  it('sends no bounds when no window is selected and says the whole retention is listed', async () => {
    const { api, fixture } = await create({});
    const filters = api.payments.mock.calls[0][0];
    expect(filters['from']).toBeUndefined();
    expect(filters['to']).toBeUndefined();
    expect(filters['live']).toBeUndefined();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('tutta la retention');
    fixture.destroy();
  });

  it('sends a rolling live window for a preset range, matching the overview drill-down', async () => {
    const { api, fixture } = await create({ window: '5m', attemptState: 'PAYING' });
    const filters = api.payments.mock.calls[0][0];
    expect(Date.parse(filters['to'] ?? '') - Date.parse(filters['from'] ?? '')).toBe(300_000);
    expect(filters['live']).toBe('true');
    expect(filters['attemptState']).toBe('PAYING');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('con attività nell’intervallo selezionato');
    fixture.destroy();
  });

  it('sends a closed window for a custom range', async () => {
    const { api, fixture } = await create({
      window: 'custom', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z',
    });
    const filters = api.payments.mock.calls[0][0];
    expect(filters).toMatchObject({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' });
    expect(filters['live']).toBeUndefined();
    fixture.destroy();
  });

  it('does not query the service for an invalid custom range', async () => {
    const { api, fixture } = await create({ window: 'custom', from: 'bad', to: 'worse' });
    expect(api.payments).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('date e ore valide in UTC');
    fixture.destroy();
  });
});
