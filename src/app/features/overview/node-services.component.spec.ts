import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { ConfigCache, NodeService, NodeServicesCheck } from '../../models/node-service';
import { NodeServicesComponent } from './node-services.component';

const service = (serviceIdentifier: string, extra: Partial<NodeService> = {}): NodeService => ({
  node: 'NDP001', target: serviceIdentifier, outcome: 'OK', dbStatus: 'UP', cacheId: '2575664583527662',
  version: '3.40.4', environment: 'ND', serviceIdentifier, ...extra,
});
const check = (nodes: NodeService[], cache: ConfigCache | null = null): NodeServicesCheck =>
  ({ checkedAt: '2026-11-04T13:10:36.723Z', nodes, cache });
const configCache = (extra: Partial<ConfigCache> = {}): ConfigCache => ({
  outcome: 'OK', cacheId: '2575664583527662', version: 'GZIP_JSON-0.10.2',
  timestamp: '2026-11-24T09:53:25.633178+01:00[Europe/Rome]', environment: 'dev', serviceIdentifier: 'CACHE', ...extra,
});

describe('NodeServicesComponent', () => {
  const nodeServices = vi.fn<() => Observable<NodeServicesCheck>>();
  const create = async (): Promise<ComponentFixture<NodeServicesComponent>> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NodeServicesComponent],
      providers: [
        { provide: ObservabilityApi, useValue: { nodeServices } },
        { provide: TimezoneService, useValue: { zone: () => 'Europe/Rome' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(NodeServicesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  };
  const element = (fixture: ComponentFixture<NodeServicesComponent>): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (fixture: ComponentFixture<NodeServicesComponent>): string =>
    element(fixture).textContent?.replace(/\s+/g, ' ') ?? '';

  const heading = (item: Element): string | undefined => item.querySelector('h3')?.textContent?.trim();

  /** Cards of the Nodo instances, without the configuration cache card. */
  const nodeItems = (fixture: ComponentFixture<NodeServicesComponent>): Element[] =>
    [...element(fixture).querySelectorAll('li')].filter(item => heading(item) !== 'Cache di configurazione');

  /** Term → description pairs of each service, in rendering order. */
  const fields = (fixture: ComponentFixture<NodeServicesComponent>): Record<string, string>[] =>
    nodeItems(fixture).map(item => Object.fromEntries(
      [...item.querySelectorAll('dl > div')].map(row => [
        row.querySelector('dt')?.textContent?.trim() ?? '',
        row.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      ])));

  /** Term → description pairs of the configuration cache block. */
  const cacheFields = (fixture: ComponentFixture<NodeServicesComponent>): Record<string, string> => {
    const region = [...element(fixture).querySelectorAll('li')]
      .find(item => heading(item) === 'Cache di configurazione');
    return Object.fromEntries([...(region?.querySelectorAll('dl > div') ?? [])].map(row => [
      row.querySelector('dt')?.textContent?.trim() ?? '',
      row.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ]));
  };

  beforeEach(() => nodeServices.mockReset());

  it('shows the configuration cache as a distinct block with the values from the response', async () => {
    nodeServices.mockReturnValue(of(check([service('NDP001DEV')], configCache())));
    const fixture = await create();

    expect(cacheFields(fixture)).toEqual({
      Esito: 'OK', 'Cache ID': '2575664583527662', Versione: 'GZIP_JSON-0.10.2',
      'Aggiornata il': '24 nov 2026, 09:53:25', Ambiente: 'dev',
    });
    expect([...element(fixture).querySelectorAll('ul.services > li')].map(heading))
      .toEqual(['Cache di configurazione', 'NDP001DEV']);
  });

  it('marks each instance as aligned or not with the configuration cache', async () => {
    nodeServices.mockReturnValue(of(check([
      service('NDP001DEV'),
      service('NDP004IT', { cacheId: '1111' }),
      service('NDP005IT', { cacheId: null }),
    ], configCache())));
    const fixture = await create();

    expect(fields(fixture).map(item => item['Configurazione'])).toEqual(
      ['Allineata alla cache', 'Non allineata alla cache', undefined]);
  });

  it('shows a cache check that did not succeed with its outcome and missing values', async () => {
    nodeServices.mockReturnValue(of(check([service('NDP001DEV')],
      configCache({ outcome: 'UNAVAILABLE', cacheId: null, version: null, timestamp: null }))));
    const fixture = await create();

    expect(cacheFields(fixture)).toEqual({
      Esito: 'UNAVAILABLE', 'Cache ID': 'Non disponibile', Versione: 'Non disponibile',
      'Aggiornata il': 'Non disponibile', Ambiente: 'dev',
    });
    expect(text(fixture)).toContain('Cache di configurazione non raggiungibile.');
    expect(fields(fixture)[0]['Configurazione']).toBeUndefined();
  });

  it('shows an unparsable cache timestamp as received', async () => {
    nodeServices.mockReturnValue(of(check([], configCache({ timestamp: 'ieri' }))));
    const fixture = await create();

    expect(cacheFields(fixture)['Aggiornata il']).toBe('ieri');
  });

  it('states when the response has no configuration cache', async () => {
    nodeServices.mockReturnValue(of(check([service('NDP001DEV')])));
    const fixture = await create();

    expect(text(fixture)).toContain('Informazioni sulla cache di configurazione non disponibili.');
  });

  it('shows one section per microservice with identifier, database status, cache id and version', async () => {
    nodeServices.mockReturnValue(of(check([
      service('NDP001DEV'),
      service('NDP004IT', { version: '3.42.2-snapshot', environment: 'SIT' }),
    ])));
    const fixture = await create();

    expect(nodeItems(fixture).map(heading)).toEqual(['NDP001DEV', 'NDP004IT']);
    expect(fields(fixture)[1]).toEqual({ 'Stato DB': 'UP', 'Cache ID': '2575664583527662', Versione: '3.42.2-snapshot' });
    expect(text(fixture)).toContain('Verificato alle');
  });

  it('shows a database status other than UP with its original value', async () => {
    nodeServices.mockReturnValue(of(check([service('NDP001DEV', { dbStatus: 'DOWN' })])));
    const fixture = await create();

    expect(fields(fixture)[0]['Stato DB']).toBe('DOWN');
    expect(element(fixture).querySelector('.b-err')?.textContent?.trim()).toBe('DOWN');
  });

  it('marks missing values as not available', async () => {
    nodeServices.mockReturnValue(of(check([service('NDP001DEV', { dbStatus: null, cacheId: null, version: null })])));
    const fixture = await create();

    expect(fields(fixture)[0]).toEqual({ 'Stato DB': 'Non disponibile', 'Cache ID': 'Non disponibile', Versione: 'Non disponibile' });
  });

  it('shows the empty state', async () => {
    nodeServices.mockReturnValue(of(check([])));
    const fixture = await create();

    expect(text(fixture)).toContain('Nessuna istanza del Nodo restituita dal controllo.');
  });

  const syncButton = (fixture: ComponentFixture<NodeServicesComponent>): HTMLButtonElement | undefined =>
    [...element(fixture).querySelectorAll('button')].find(item => /Aggiorn/.test(item.textContent ?? ''));

  it('shows the error and syncs again on request', async () => {
    nodeServices.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
    const fixture = await create();

    expect(element(fixture).querySelector('[role="alert"]')?.textContent).toContain('non raggiungibile');

    nodeServices.mockReturnValueOnce(of(check([service('NDP001DEV')])));
    syncButton(fixture)?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(nodeServices).toHaveBeenCalledTimes(2);
    expect(element(fixture).querySelector('[role="alert"]')).toBeNull();
    expect(nodeItems(fixture).map(heading)[0]).toBe('NDP001DEV');
  });

  it('forces a new check, keeping the current services visible and the button disabled while it runs', async () => {
    nodeServices.mockReturnValueOnce(of(check([service('NDP001DEV')])));
    const fixture = await create();
    const pending = new Subject<NodeServicesCheck>();
    nodeServices.mockReturnValueOnce(pending);

    syncButton(fixture)?.click();
    fixture.detectChanges();

    expect(syncButton(fixture)?.disabled).toBe(true);
    expect(syncButton(fixture)?.textContent).toContain('Aggiornamento…');
    expect(nodeItems(fixture).map(heading)[0]).toBe('NDP001DEV');

    pending.next(check([service('NDP001DEV', { version: '3.40.5' })]));
    pending.complete();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(nodeServices).toHaveBeenCalledTimes(2);
    expect(syncButton(fixture)?.disabled).toBe(false);
    expect(fields(fixture)[0]['Versione']).toBe('3.40.5');
  });

  it('keeps the last successful check when a sync fails', async () => {
    nodeServices.mockReturnValueOnce(of(check([service('NDP001DEV')])));
    const fixture = await create();
    nodeServices.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));

    syncButton(fixture)?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element(fixture).querySelector('[role="alert"]')?.textContent).toContain('dati dell’ultima verifica riuscita');
    expect(nodeItems(fixture).map(heading)[0]).toBe('NDP001DEV');
  });
});
