import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Catalog } from '../../models/domain';
import { ObservabilityApi, StreamHttpError } from './observability-api.service';
import { SessionService } from '../auth/session.service';
import { RE_FIELDS } from '../../models/re-event';

describe('ObservabilityApi catalog', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      httpTesting.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  const expectPath = (path: string) =>
    httpTesting.expectOne(request => new URL(request.url).pathname === path);

  it('reads the Nodo microservices from the cache version endpoint', async () => {
    const response = { checkedAt: '2026-11-04T13:10:36.723Z', nodes: [{
      node: 'NDP001', target: 'NDP001DEV', outcome: 'OK', dbStatus: 'UP', cacheId: '2575664583527662',
      version: '3.40.4', environment: 'ND', serviceIdentifier: 'NDP001DEV',
    }] };
    const result = firstValueFrom(TestBed.inject(ObservabilityApi).nodeServices());
    const request = expectPath('/api/nodo-monitoring/cache/version');
    expect(request.request.method).toBe('GET');
    request.flush(response);
    await expect(result).resolves.toEqual(response);
  });

  it('reads the cached scheduled maintenances', async () => {
    const response = { fetchedAt: '2026-11-04T00:00:00.000Z', windowFrom: '2026-11-04T00:00:00.000Z',
      windowTo: '2026-11-11T00:00:00.000Z', stale: false, items: [{ brokerCode: 'B', brokerName: 'Broker',
        startDateTime: '2026-11-05T08:00:00.000Z', endDateTime: '2026-11-05T10:00:00.000Z', stations: ['B_01'],
        creditorInstitutions: [{ businessName: 'Ente', code: '00000000001' }] }] };
    const result = firstValueFrom(TestBed.inject(ObservabilityApi).maintenances());
    const request = expectPath('/api/apiconfig/maintenances');
    expect(request.request.method).toBe('GET');
    request.flush(response);
    await expect(result).resolves.toEqual(response);
  });

  it('rejects a malformed maintenances payload', async () => {
    const result = firstValueFrom(TestBed.inject(ObservabilityApi).maintenances());
    const failed = expect(result).rejects.toThrow('manutenzioni programmate non valida');
    expectPath('/api/apiconfig/maintenances').flush({ items: [{}] });
    await failed;
  });

  it('rejects a malformed Nodo microservices payload', async () => {
    const result = firstValueFrom(TestBed.inject(ObservabilityApi).nodeServices());
    const failed = expect(result).rejects.toThrow('Risposta delle istanze del Nodo non valida');
    expectPath('/api/nodo-monitoring/cache/version').flush({ nodes: 'none' });
    await failed;
  });

  it('posts only a UTC window and cursor to the technical attempt RE endpoint', async () => {
    const window = { from: '2026-10-23T10:00:00.000Z', to: '2026-10-23T11:00:00.000Z' };
    const result = firstValueFrom(TestBed.inject(ObservabilityApi).reEvents('attempt/1', window));
    const request = expectPath('/api/attempts/attempt%2F1/re-events');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(window);
    expect(request.request.params.keys()).toEqual([]);
    const response = { attemptId: 'attempt/1', source: 'RE', retrievedAt: window.to, window,
      coverage: 'WINDOW_ONLY', events: [], nextCursor: null, truncated: false, warnings: [] };
    request.flush(response);
    await expect(result).resolves.toEqual(response);
  });

  it('rejects wrong attempt identity or malformed RE events', async () => {
    const window = { from: '2026-10-23T10:00:00.000Z', to: '2026-10-23T11:00:00.000Z' };
    for (const patch of [{ attemptId: 'wrong' }, { events: [{}] },
      { events: [Object.fromEntries(RE_FIELDS.map(field => [field, null]))] }]) {
      const result = firstValueFrom(TestBed.inject(ObservabilityApi).reEvents('attempt-1', window));
      const failed = expect(result).rejects.toThrow('Risposta RE non valida');
      expectPath('/api/attempts/attempt-1/re-events').flush({
        attemptId: 'attempt-1', source: 'RE', retrievedAt: window.to, window,
        coverage: 'WINDOW_ONLY', events: [], nextCursor: null, truncated: false, warnings: [], ...patch,
      });
      await failed;
    }
  });

  it('checks an attempt through a read-only endpoint without sending token or database routing', async () => {
    const result = firstValueFrom(TestBed.inject(ObservabilityApi).checkDb('attempt/1'));
    const request = expectPath('/api/attempts/attempt%2F1/check-db');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.body).toBeNull();
    const response = {
      attemptId: 'attempt/1', paFiscalCode: '00000000001', noticeNumber: '300000000000000001',
      serviceIdentifier: 'svc-1', projectionRevision: 1, source: 'NODO_ONLINE',
      checkedAt: '2026-10-23T10:00:00.000Z',
      observed: { logicalState: 'PAYING', attemptState: 'PAYMENT_UNKNOWN' },
      database: { logicalState: 'PAID', attemptState: null },
    };
    request.flush(response);
    await expect(result).resolves.toEqual(response);
  });

  it('rejects incomplete or misattributed Check DB responses instead of reporting a match', async () => {
    for (const response of [
      {},
      {
        attemptId: 'different', paFiscalCode: '00000000001', noticeNumber: '300000000000000001',
        serviceIdentifier: 'svc-1', projectionRevision: 1, source: 'NODO_ONLINE',
        checkedAt: '2026-10-23T10:00:00.000Z',
        observed: { logicalState: 'PAYING', attemptState: 'PAYING' },
        database: { logicalState: 'PAYING', attemptState: 'PAYING' },
      },
    ]) {
      const result = firstValueFrom(TestBed.inject(ObservabilityApi).checkDb('attempt/1'));
      const failure = expect(result).rejects.toThrow('Risposta Check DB non valida');
      expectPath('/api/attempts/attempt%2F1/check-db').flush(response);
      await failure;
    }
  });

  it('rejects missing provenance, invalid dates and states assigned to the wrong entity', async () => {
    const response = {
      attemptId: 'attempt-1', paFiscalCode: '00000000001', noticeNumber: '300000000000000001',
      serviceIdentifier: 'svc-1', projectionRevision: 1, source: 'NODO_ONLINE',
      checkedAt: '2026-10-23T10:00:00.000Z',
      observed: { logicalState: 'PAYING', attemptState: 'PAYING' },
      database: { logicalState: 'PAYING', attemptState: 'PAYING' },
    };
    for (const patch of [
      { source: undefined }, { source: 'UNKNOWN' }, { projectionRevision: 0 },
      { checkedAt: 'invalid' }, { checkedAt: '2026-02-30T10:00:00.000Z' },
      { database: { attemptState: 'PAYING' } },
      { database: { logicalState: 'CANCELLED', attemptState: 'PAYING' } },
      { observed: { logicalState: 'PAYING', attemptState: 'INSERTED' } },
    ]) {
      const result = firstValueFrom(TestBed.inject(ObservabilityApi).checkDb('attempt-1'));
      const failure = expect(result).rejects.toThrow('Risposta Check DB non valida');
      expectPath('/api/attempts/attempt-1/check-db').flush({ ...response, ...patch });
      await failure;
    }
  });

  it('composes the catalog and service identifiers from parallel requests', async () => {
    const api = TestBed.inject(ObservabilityApi);
    const catalog: Catalog = {
      logicalStates: ['INSERTED', 'PAYING', 'PAID', 'NOTICE_STORED', 'NOTIFIED'],
      attemptStates: ['PAYING', 'PAID'],
      warningStates: ['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'],
      unknownFilterValue: '~unknown',
      serviceIdentifiers: ['old identifier', null],
      psps: ['psp-a', null],
      canali: ['channel-a', null],
      stazioni: ['station-a', null],
      aggregateFilterPolicy: 'ONE_ATTEMPT_DIMENSION;STATION_REQUIRES_PA',
    };
    const identifiers = ['service-a', 'service-b'];
    const resultPromise = firstValueFrom(api.catalogWithServiceIdentifiers());

    const catalogRequest = expectPath('/api/catalog');
    const identifiersRequest = expectPath('/api/serviceIdentifiers');
    expect(catalogRequest.request.method).toBe('GET');
    expect(identifiersRequest.request.method).toBe('GET');

    catalogRequest.flush(catalog);
    identifiersRequest.flush(identifiers);

    await expect(resultPromise).resolves.toEqual({ ...catalog, serviceIdentifiers: identifiers });
  });

  it('cancels the pending service-identifier request after catalog failure and can retry', async () => {
    const api = TestBed.inject(ObservabilityApi);
    const partialResults: unknown[] = [];
    const failedResult = new Promise<unknown>(resolve => {
      api.catalogWithServiceIdentifiers().subscribe({
        next: result => partialResults.push(result),
        error: resolve,
      });
    });
    const firstCatalogRequest = expectPath('/api/catalog');
    const firstIdentifiersRequest = expectPath('/api/serviceIdentifiers');

    firstCatalogRequest.flush({ error: 'catalog failed' }, { status: 500, statusText: 'Server Error' });
    await expect(failedResult).resolves.toMatchObject({ status: 500 });
    expect(partialResults).toEqual([]);
    expect(firstIdentifiersRequest.cancelled).toBe(true);

    const retryResult = firstValueFrom(api.catalogWithServiceIdentifiers());
    const retryCatalogRequest = expectPath('/api/catalog');
    const retryIdentifiersRequest = expectPath('/api/serviceIdentifiers');
    const catalog: Catalog = {
      logicalStates: ['INSERTED', 'PAYING', 'PAID', 'NOTICE_STORED', 'NOTIFIED'],
      attemptStates: ['PAYING'],
      warningStates: ['PAYMENT_UNKNOWN'],
      unknownFilterValue: '~unknown',
      serviceIdentifiers: [],
      psps: [],
      canali: [],
      stazioni: [],
      aggregateFilterPolicy: 'ONE_ATTEMPT_DIMENSION;STATION_REQUIRES_PA',
    };
    retryCatalogRequest.flush(catalog);
    retryIdentifiersRequest.flush(['retry-service']);
    await expect(retryResult).resolves.toEqual({ ...catalog, serviceIdentifiers: ['retry-service'] });
  });

  it('cancels the pending catalog request after service-identifier failure and can retry', async () => {
    const api = TestBed.inject(ObservabilityApi);
    const partialResults: unknown[] = [];
    const failedResult = new Promise<unknown>(resolve => {
      api.catalogWithServiceIdentifiers().subscribe({
        next: result => partialResults.push(result),
        error: resolve,
      });
    });
    const firstCatalogRequest = expectPath('/api/catalog');
    const firstIdentifiersRequest = expectPath('/api/serviceIdentifiers');

    firstIdentifiersRequest.flush({ error: 'identifiers failed' }, { status: 503, statusText: 'Unavailable' });
    await expect(failedResult).resolves.toMatchObject({ status: 503 });
    expect(partialResults).toEqual([]);
    expect(firstCatalogRequest.cancelled).toBe(true);

    const retryResult = firstValueFrom(api.catalogWithServiceIdentifiers());
    const retryCatalogRequest = expectPath('/api/catalog');
    const retryIdentifiersRequest = expectPath('/api/serviceIdentifiers');
    const catalog: Catalog = {
      logicalStates: ['INSERTED'],
      attemptStates: ['PAYING'],
      warningStates: ['PAYMENT_SEND_ERROR'],
      unknownFilterValue: '~unknown',
      serviceIdentifiers: ['stale'],
      psps: [null],
      canali: [null],
      stazioni: [null],
      aggregateFilterPolicy: 'ONE_ATTEMPT_DIMENSION;STATION_REQUIRES_PA',
    };
    retryCatalogRequest.flush(catalog);
    retryIdentifiersRequest.flush(['recovered-service']);

    await expect(retryResult).resolves.toEqual({ ...catalog, serviceIdentifiers: ['recovered-service'] });
  });
});

describe('ObservabilityApi SSE establishment', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('preserves an HTTP 422 status from stream establishment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 422 })));
    const api = TestBed.inject(ObservabilityApi);

    await expect(firstValueFrom(api.connect({ scope: 'overview', psp: 'psp-a', canale: 'channel-a' })))
      .rejects.toMatchObject<Partial<StreamHttpError>>({ status: 422 });
  });

  it('exposes an HTTP 500 status while retaining the retrying stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    const api = TestBed.inject(ObservabilityApi);

    const event = await firstValueFrom(api.connect({ scope: 'overview' }));

    expect(event.type).toBe('connection-error');
    expect(JSON.parse(event.data)).toEqual({ status: 500 });
  });

  it('signals replay expiration only after the fresh stream is established', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 410 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const api = TestBed.inject(ObservabilityApi);

    const event = await firstValueFrom(api.connect({ scope: 'payment', paFiscalCode: '00000000001', noticeNumber: '300000000000000001' }));

    expect(event.type).toBe('replay-expired');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('sends one normalized page scope through a single SSE request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      'event: ready\ndata: {"type":"ready","scope":{"scope":"payment-list","keys":"00000000001:300000000000000001"},"projectionRevision":1}\n\n',
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetch);
    const api = TestBed.inject(ObservabilityApi);

    const event = await firstValueFrom(api.connect({
      scope: 'payment-list',
      keys: '00000000001:300000000000000001',
    }));

    expect(event.type).toBe('ready');
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]), 'http://localhost');
    expect(url.searchParams.get('scope')).toBe('payment-list');
    expect(url.searchParams.get('keys')).toBe('00000000001:300000000000000001');
  });

  it('releases browser connections on pagehide and replays when a cached page is restored', async () => {
    const encoder = new TextEncoder();
    let eventNumber = 0;
    const fetch = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`id: event-${++eventNumber}\nevent: ready\ndata: {"type":"ready"}\n\n`));
          options?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    vi.stubGlobal('fetch', fetch);
    const events: MessageEvent<string>[] = [];
    const subscription = TestBed.inject(ObservabilityApi).connect({ scope: 'overview' })
      .subscribe(event => events.push(event));

    try {
      await vi.waitFor(() => expect(events).toHaveLength(1));
      const firstSignal = fetch.mock.calls[0][1]?.signal;
      window.dispatchEvent(new Event('pagehide'));
      expect(firstSignal?.aborted).toBe(true);

      window.dispatchEvent(new Event('pageshow'));
      await vi.waitFor(() => expect(events).toHaveLength(2));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(new Headers(fetch.mock.calls[1][1]?.headers).get('Last-Event-ID')).toBe('event-1');
      expect(events.every(event => event.type === 'ready')).toBe(true);
    } finally {
      subscription.unsubscribe();
    }

    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
    window.dispatchEvent(new Event('pageshow'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
