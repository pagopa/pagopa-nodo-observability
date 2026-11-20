import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { NodeService, NodeServicesCheck } from '../../models/node-service';
import { NodeServicesComponent } from './node-services.component';

const service = (serviceIdentifier: string, extra: Partial<NodeService> = {}): NodeService => ({
  node: 'NDP001', target: serviceIdentifier, outcome: 'OK', dbStatus: 'UP', cacheId: '2575664583527662',
  version: '3.40.4', environment: 'ND', serviceIdentifier, ...extra,
});
const check = (nodes: NodeService[]): NodeServicesCheck => ({ checkedAt: '2026-11-04T13:10:36.723Z', nodes });

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

  /** Term → description pairs of each service, in rendering order. */
  const fields = (fixture: ComponentFixture<NodeServicesComponent>): Record<string, string>[] =>
    [...element(fixture).querySelectorAll('li')].map(item => Object.fromEntries(
      [...item.querySelectorAll('dl > div')].map(row => [
        row.querySelector('dt')?.textContent?.trim() ?? '',
        row.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      ])));

  beforeEach(() => nodeServices.mockReset());

  it('shows one section per microservice with identifier, database status, cache id and version', async () => {
    nodeServices.mockReturnValue(of(check([
      service('NDP001DEV'),
      service('NDP004IT', { version: '3.42.2-snapshot', environment: 'SIT' }),
    ])));
    const fixture = await create();

    const items = [...element(fixture).querySelectorAll('li')];
    expect(items.map(item => item.querySelector('h3')?.textContent?.trim())).toEqual(['NDP001DEV', 'NDP004IT']);
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
    expect(element(fixture).querySelector('h3')?.textContent?.trim()).toBe('NDP001DEV');
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
    expect(element(fixture).querySelector('h3')?.textContent?.trim()).toBe('NDP001DEV');

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
    expect(element(fixture).querySelector('h3')?.textContent?.trim()).toBe('NDP001DEV');
  });
});
