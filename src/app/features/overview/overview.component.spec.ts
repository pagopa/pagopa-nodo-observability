import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, convertToParamMap, Router } from '@angular/router';
import { signal } from '@angular/core';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ObservabilityApi, StreamHttpError } from '../../core/api/observability-api.service';
import { SessionService } from '../../core/auth/session.service';
import { TimezoneService } from '../../core/timezone.service';
import { OverviewComponent } from './overview.component';
import { ATTEMPT_STATES, Overview, Page, PrimitiveWarning } from '../../models/domain';

const snapshot = (revision: number, payments: number): Overview => ({
  snapshotAt: '2026-10-16T10:00:00.000Z',
  projectionRevision: revision,
  window: { from: '2026-10-16T09:00:00.000Z', to: '2026-10-16T10:00:00.000Z' },
  counts: { payments, attempts: payments },
  logicalStates: [],
  attemptStates: [],
  recipientStates: [],
  primitives: [],
  unresolved: { payments: 0, attempts: 0 },
  matrices: { psp: [], canale: [], recipient: [] },
  traffic: [],
  transitions: [],
  durations: [],
  anomalies: { transitions: 0, payments: 0 },
  freshness: {
    status: 'CURRENT', lagSeconds: 0, gapsDetected: false,
    observedAt: '2026-10-16T10:00:00.000Z', lastProcessedAt: '2026-10-16T10:00:00.000Z',
    lastPublishedAt: '2026-10-16T10:00:00.000Z',
  },
});
const aggregateDelta = (projectionRevision: number, count: number) => ({
  type: 'aggregate.delta',
  projectionRevision,
  changes: {
    counts: { payments: count },
    logicalStates: [],
    attemptStates: [],
    traffic: [],
    transitions: [],
    matrices: { psp: [], canale: [], recipient: [] },
    anomalies: { transitions: 0, payments: 0 },
    durationSnapshot: [],
  },
});

describe('OverviewComponent attempt state distribution', () => {
  const primaryStates = [
    'PAYING', 'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_ACCEPTED',
    'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR', 'PAYMENT_REFUSED', 'PAID', 'CANCELLED', 'NOTIFIED',
  ];

  const createFixture = async (data: Overview) => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ psp: 'psp-1' })) } },
        { provide: ObservabilityApi, useValue: {
          nodeServices: () => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] }),
          connect: () => of(new MessageEvent('message', { data: JSON.stringify({ type: 'ready' }) })),
          overview: () => of(data),
          catalogWithServiceIdentifiers: () => of({ serviceIdentifiers: [] }),
        } },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
        { provide: TimezoneService, useValue: { zone: () => 'Europe/Rome' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OverviewComponent);
    await fixture.whenStable();
    return fixture;
  };

  const attemptLinks = (fixture: ComponentFixture<OverviewComponent>): HTMLAnchorElement[] =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a[href*="attemptState="]')];
  const renderedStates = (fixture: ComponentFixture<OverviewComponent>) =>
    attemptLinks(fixture).map(link => new URL(link.href).searchParams.get('attemptState'));
  const toggleButton = (fixture: ComponentFixture<OverviewComponent>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .find(button => button.textContent?.trim().startsWith('Mostra'));

  it('uses entity-specific explanations and phase filter groups without nesting controls in links', async () => {
    const data = snapshot(1, 1);
    data.logicalStates = [{ state: 'NOTICE_STORED', count: 1 }];
    data.attemptStates = [{ state: 'PAYMENT_ACCEPTED', count: 1 }];
    data.recipientStates = [{ state: 'NOTIFIED', count: 1 }];
    const fixture = await createFixture(data);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Ricevuta archiviata');
    expect(element.textContent).toContain('Accettato dal PSP, in attesa dell’esito del pagamento');
    expect(element.textContent).toContain('dal destinatario, OK o KO');
    expect(element.querySelector('optgroup[label="Prenotazione e notifica PSP"]')).not.toBeNull();
    expect(element.querySelector('a details')).toBeNull();
    fixture.componentInstance.overview.set({ ...data, recipientStates: undefined } as unknown as Overview);
    await fixture.whenStable();
    expect(element.textContent).toContain('Dati destinatari non disponibili');
    fixture.destroy();
  });

  it('shows the total and the share of each state within its entity', async () => {
    const data = snapshot(1, 1);
    data.logicalStates = [{ state: 'PAYING', count: 3 }, { state: 'PAID', count: 1 }];
    data.attemptStates = [{ state: 'PAYING', count: 0 }, { state: 'PAID', count: 0 }];
    data.recipientStates = [{ state: 'NOTIFIED', count: 2 }];
    const fixture = await createFixture(data);
    const totals = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.dist-total')]
      .map(total => total.textContent?.replace(/\s+/g, ' ').trim());
    expect(totals).toEqual(['4 totali', '0 totali', '2 totali']);
    const logicalLink = (fixture.nativeElement as HTMLElement).querySelector('a[aria-label="Apri pagamenti in stato PAYING"]');
    expect(logicalLink?.textContent).toContain('75%');
    expect(fixture.componentInstance.percent(1, 0)).toBe(0);
    fixture.destroy();
  });

  it('shows one pie chart per entity with the state lists inside a "Mostra dettaglio" accordion', async () => {
    const data = snapshot(1, 1);
    data.logicalStates = [{ state: 'PAID', count: 2 }];
    data.attemptStates = [{ state: 'PAID', count: 2 }];
    data.recipientStates = [{ state: 'NOTIFIED', count: 2 }];
    const fixture = await createFixture(data);
    const element = fixture.nativeElement as HTMLElement;
    const labels = [...element.querySelectorAll('app-pie-chart svg')].map(svg => svg.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Distribuzione dei pagamenti per stato',
      'Distribuzione dei tentativi per stato',
      'Distribuzione dei destinatari ricevuta per stato',
    ]);
    const details = [...element.querySelectorAll<HTMLDetailsElement>('details.dist-detail')];
    expect(details).toHaveLength(3);
    for (const detail of details) {
      expect(detail.querySelector('summary')?.textContent?.trim()).toBe('Mostra dettaglio');
      expect(detail.open).toBe(false);
      expect(detail.querySelector('.dist-list')).not.toBeNull();
    }
    fixture.destroy();
  });

  it('declares that every count follows the selected interval', async () => {
    const fixture = await createFixture(snapshot(1, 1));
    const text = (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('con attività nell’intervallo');
    expect(text).toContain('riguardano i pagamenti, i tentativi e i destinatari con attività nello stesso intervallo');
    expect(text).not.toContain('indipendentemente dalla finestra');
    fixture.destroy();
  });

  it('shows exactly the ten main states in mockup order regardless of API order or counts', async () => {
    const data = snapshot(1, 100);
    data.attemptStates = ATTEMPT_STATES.map((state, index) => ({ state, count: 100 - index }));
    const originalRows = [...data.attemptStates];
    const fixture = await createFixture(data);

    expect(renderedStates(fixture)).toEqual(primaryStates);
    expect(toggleButton(fixture)?.textContent?.trim()).toBe('Mostra tutti gli stati');
    expect(toggleButton(fixture)?.getAttribute('aria-expanded')).toBe('false');
    expect(data.attemptStates).toEqual(originalRows);
    for (const link of attemptLinks(fixture)) {
      expect(new URL(link.href).searchParams.get('psp')).toBe('psp-1');
      expect(new URL(link.href).searchParams.get('view')).toBe('attempts');
    }
    fixture.destroy();
  });

  it('expands all eighteen states and collapses back to the ten main states', async () => {
    const data = snapshot(1, 100);
    data.attemptStates = ATTEMPT_STATES.map(state => ({ state, count: 1 }));
    const fixture = await createFixture(data);

    toggleButton(fixture)?.click();
    await fixture.whenStable();
    expect(renderedStates(fixture)).toEqual([
      ...primaryStates, 'PAYING_RPT', 'PAID_NORPT', 'NOTICE_GENERATED', 'NOTICE_STORED',
      'NOTICE_SENT', 'CANCELLED_NORPT', 'FAILED', 'FAILED_NORPT',
    ]);
    expect(toggleButton(fixture)?.textContent?.trim()).toBe('Mostra solo i principali');
    expect(toggleButton(fixture)?.getAttribute('aria-expanded')).toBe('true');

    toggleButton(fixture)?.click();
    await fixture.whenStable();
    expect(renderedStates(fixture)).toEqual(primaryStates);
    fixture.destroy();
  });

  it('always displays both unresolved states even when absent from the snapshot', async () => {
    const fixture = await createFixture(snapshot(1, 0));

    expect(renderedStates(fixture)).toEqual(['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR']);
    expect(attemptLinks(fixture).every(link => link.textContent?.includes('0'))).toBe(true);
    expect(toggleButton(fixture)).toBeUndefined();
    fixture.destroy();
  });

  it('updates displayed counts without collapsing the expanded list', async () => {
    const data = snapshot(1, 100);
    data.attemptStates = ATTEMPT_STATES.map(state => ({ state, count: 1 }));
    const fixture = await createFixture(data);
    toggleButton(fixture)?.click();
    await fixture.whenStable();

    fixture.componentInstance.overview.set({
      ...data,
      attemptStates: data.attemptStates.map(row => ({ ...row, count: 42 })),
    });
    await fixture.whenStable();
    expect(attemptLinks(fixture)).toHaveLength(18);
    expect(attemptLinks(fixture).every(link => link.textContent?.includes('42'))).toBe(true);
    fixture.destroy();
  });
});

describe('OverviewComponent primitives per service', () => {
  const stream = new Subject<MessageEvent<string>>();
  const primitiveWarnings = vi.fn<(filters: Record<string, string | null | undefined>) => Observable<Page<PrimitiveWarning>>>();
  const createFixture = async (data: Overview) => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: ObservabilityApi, useValue: {
          nodeServices: () => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] }),
          connect: () => stream,
          overview: () => of(data),
          primitiveWarnings,
          catalogWithServiceIdentifiers: () => of({ serviceIdentifiers: [] }),
        } },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
        { provide: TimezoneService, useValue: { zone: () => 'Europe/Rome' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OverviewComponent);
    await fixture.whenStable();
    stream.next(new MessageEvent('message', { data: JSON.stringify({ type: 'ready' }) }));
    await fixture.whenStable();
    return fixture;
  };
  const section = (fixture: ComponentFixture<OverviewComponent>): HTMLElement => {
    const element = [...(fixture.nativeElement as HTMLElement).querySelectorAll('section')]
      .find(item => item.querySelector('h2')?.textContent === 'Primitive inviate per servizio');
    if (!element) throw new Error('Primitives section not found');
    return element;
  };
  const bodyRows = (fixture: ComponentFixture<OverviewComponent>): HTMLTableRowElement[] =>
    [...section(fixture).querySelectorAll<HTMLTableRowElement>('tbody tr')];
  const cells = (row: HTMLTableRowElement): string[] =>
    [...row.querySelectorAll('td')].map(cell => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  it('shows the total and each service with count, share, responses and warning text', async () => {
    const data = snapshot(1, 1);
    data.primitives = [
      { serviceIdentifier: 'SERVICE_B', primitive: 'verifyPaymentNotice', direction: 'INBOUND', requests: 25, responses: 25, warnings: 0 },
      { serviceIdentifier: 'SERVICE_A', primitive: 'activatePaymentNotice', direction: 'INBOUND', requests: 50, responses: 50, warnings: 0 },
      { serviceIdentifier: 'SERVICE_A', primitive: 'pspNotifyPayment', direction: 'OUTBOUND', requests: 25, responses: 22, warnings: 3 },
      { serviceIdentifier: null, primitive: 'paGetPayment', direction: 'OUTBOUND', requests: 0, responses: 0, warnings: 0 },
    ];
    const fixture = await createFixture(data);
    const text = section(fixture).textContent ?? '';
    expect(text).toContain('Totale chiamate di primitiva');
    expect(section(fixture).querySelector('.primitive-total-count')?.textContent?.trim()).toBe('100');
    const rows = bodyRows(fixture).map(cells);
    expect(rows[0]).toEqual(['SERVICE_A (2 primitive)', '75.0%', '75', '72', '3 senza risposta entro 10 s']);
    expect(rows[1]).toEqual(['SERVICE_B (1 primitiva)', '25.0%', '25', '25', 'Nessuno']);
    expect(rows[2][0]).toContain('Non disponibile');
    expect(section(fixture).querySelector('.primitive-warning')?.textContent).toContain('3 in warning');
    fixture.destroy();
  });

  it('expands a service into its primitives with their own counts, share and warnings', async () => {
    const data = snapshot(1, 1);
    data.primitives = [
      { serviceIdentifier: 'SERVICE_A', primitive: 'activatePaymentNotice', direction: 'INBOUND', requests: 50, responses: 50, warnings: 0 },
      { serviceIdentifier: 'SERVICE_A', primitive: 'pspNotifyPayment', direction: 'OUTBOUND', requests: 25, responses: 22, warnings: 3 },
      { serviceIdentifier: 'SERVICE_B', primitive: 'verifyPaymentNotice', direction: 'INBOUND', requests: 25, responses: 25, warnings: 0 },
    ];
    const fixture = await createFixture(data);
    const toggle = section(fixture).querySelector<HTMLButtonElement>('.primitive-toggle-row');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(section(fixture).querySelector('.primitive-detail')).toBeNull();

    toggle?.click();
    await fixture.whenStable();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const details = [...section(fixture).querySelectorAll<HTMLTableRowElement>('.primitive-detail')].map(cells);
    expect(details).toEqual([
      ['activatePaymentNotice · Pagamento · In ingresso', '66.7%', '50', '50', 'Nessuno'],
      ['pspNotifyPayment · Pagamento · In uscita', '33.3%', '25', '22', '3 senza risposta entro 10 s'],
    ]);
    const natures = [...section(fixture).querySelectorAll('.primitive-nature')].map(group => [
      group.querySelector('h3')?.textContent?.trim(),
      group.querySelector('.primitive-nature-total b')?.textContent?.trim(),
      [...group.querySelectorAll('.primitive-nature-list li')].map(item => [
        item.querySelector('.mono')?.textContent?.trim(),
        item.querySelector('b')?.textContent?.trim(),
        item.querySelector('.primitive-nature-warn')?.textContent?.trim() ?? null,
      ]),
    ]);
    expect(natures).toEqual([
      ['Consultazione', '25', [['verifyPaymentNotice', '25', null]]],
      ['Pagamento', '75', [
        ['activatePaymentNotice', '50', null],
        ['pspNotifyPayment', '25', '3 senza risposta'],
      ]],
    ]);
    expect(toggle?.getAttribute('aria-controls')).toBe(section(fixture).querySelector('.primitive-detail')?.id);

    toggle?.click();
    await fixture.whenStable();
    expect(section(fixture).querySelector('.primitive-detail')).toBeNull();
    fixture.destroy();
  });

  beforeEach(() => primitiveWarnings.mockReset().mockReturnValue(of({ items: [], nextCursor: null, snapshotRevision: 1 })));

  it('lists psp, channel, entity, station and call time of the unanswered calls behind a primitive warning', async () => {
    primitiveWarnings.mockClear();
    primitiveWarnings.mockReturnValue(of({
      items: [
        { calledAt: '2026-10-16T09:30:15.000Z', psp: 'ABI00001', canale: 'CHANNEL_A', paFiscalCode: '00000000001', stazione: '00000000001_01' },
        { calledAt: '2026-10-16T09:10:00.000Z', psp: null, canale: null, paFiscalCode: null, stazione: null },
      ],
      nextCursor: null,
      snapshotRevision: 3,
    }));
    const data = snapshot(1, 1);
    data.primitives = [
      { serviceIdentifier: 'SERVICE_A', primitive: 'activatePaymentNotice', direction: 'INBOUND', requests: 50, responses: 50, warnings: 0 },
      { serviceIdentifier: 'SERVICE_A', primitive: 'pspNotifyPayment', direction: 'OUTBOUND', requests: 25, responses: 22, warnings: 2 },
    ];
    const fixture = await createFixture(data);
    section(fixture).querySelector<HTMLButtonElement>('.primitive-toggle-row')?.click();
    await fixture.whenStable();
    expect(primitiveWarnings).not.toHaveBeenCalled();
    expect(section(fixture).querySelectorAll('.primitive-warning-toggle')).toHaveLength(1);

    const toggle = section(fixture).querySelector<HTMLButtonElement>('.primitive-warning-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    toggle?.click();
    await fixture.whenStable();

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(primitiveWarnings).toHaveBeenCalledTimes(1);
    expect(primitiveWarnings.mock.calls[0][0]).toMatchObject({ primitive: 'pspNotifyPayment', serviceIdentifier: 'SERVICE_A' });
    const panel = section(fixture).querySelector<HTMLElement>('.primitive-warnings-row');
    expect(toggle?.getAttribute('aria-controls')).toBe(panel?.id);
    const headers = [...(panel?.querySelectorAll('th') ?? [])].map(cell => cell.textContent?.trim());
    expect(headers).toEqual(['Data-ora chiamata', 'PSP', 'Canale', 'Ente', 'Stazione']);
    const rows = [...(panel?.querySelectorAll<HTMLTableRowElement>('.warnings-table tbody tr') ?? [])].map(cells);
    expect(rows).toEqual([
      ['16 ott 2026, 11:30:15', 'ABI00001', 'CHANNEL_A', '00000000001', '00000000001_01'],
      ['16 ott 2026, 11:10:00', 'Non disponibile', 'Non disponibile', 'Non disponibile', 'Non disponibile'],
    ]);

    toggle?.click();
    await fixture.whenStable();
    expect(section(fixture).querySelector('.primitive-warnings-row')).toBeNull();
    fixture.destroy();
  });

  it('asks for the service without identifier with the ~unknown filter value', async () => {
    primitiveWarnings.mockClear();
    const data = snapshot(1, 1);
    data.primitives = [{ serviceIdentifier: null, primitive: 'paGetPayment', direction: 'OUTBOUND', requests: 1, responses: 0, warnings: 1 }];
    const fixture = await createFixture(data);
    section(fixture).querySelector<HTMLButtonElement>('.primitive-toggle-row')?.click();
    await fixture.whenStable();
    section(fixture).querySelector<HTMLButtonElement>('.primitive-warning-toggle')?.click();
    await fixture.whenStable();
    expect(primitiveWarnings.mock.calls[0][0]).toMatchObject({ primitive: 'paGetPayment', serviceIdentifier: '~unknown' });
    fixture.destroy();
  });

  it('shows an empty state without warnings when no primitive was sent', async () => {
    const fixture = await createFixture(snapshot(1, 1));
    expect(bodyRows(fixture)).toHaveLength(1);
    expect(section(fixture).textContent).toContain('Nessuna primitiva inviata nella finestra selezionata');
    expect(section(fixture).querySelector('.primitive-warning')).toBeNull();
    fixture.destroy();
  });

  it('reports a missing primitives aggregate instead of an empty chart', async () => {
    const data = { ...snapshot(1, 1), primitives: undefined } as unknown as Overview;
    const fixture = await createFixture(data);
    expect(section(fixture).querySelector('[role="alert"]')?.textContent).toContain('Dati primitive non disponibili');
    fixture.destroy();
  });

  it('limits the list to ten services and expands on request', async () => {
    const data = snapshot(1, 1);
    data.primitives = Array.from({ length: 12 }, (_, index) =>
      ({ serviceIdentifier: `SERVICE_${index}`, primitive: 'activatePaymentNotice', direction: 'INBOUND', requests: 12 - index, responses: 12 - index, warnings: 0 }));
    const fixture = await createFixture(data);
    expect(bodyRows(fixture)).toHaveLength(10);
    section(fixture).querySelector<HTMLButtonElement>('.primitive-toggle')?.click();
    await fixture.whenStable();
    expect(bodyRows(fixture)).toHaveLength(12);
    fixture.destroy();
  });

  it('applies aggregate deltas, adding new services and dropping rows that return to zero', async () => {
    const data = snapshot(1, 1);
    data.primitives = [
      { serviceIdentifier: 'SERVICE_A', primitive: 'activatePaymentNotice', direction: 'INBOUND', requests: 4, responses: 4, warnings: 0 },
      { serviceIdentifier: 'SERVICE_B', primitive: 'activatePaymentNotice', direction: 'INBOUND', requests: 2, responses: 2, warnings: 0 },
    ];
    const fixture = await createFixture(data);
    const delta = aggregateDelta(2, 0);
    stream.next(new MessageEvent('message', { data: JSON.stringify({
      ...delta,
      changes: { ...delta.changes, primitives: [
        { serviceIdentifier: 'SERVICE_A', primitive: 'activatePaymentNotice', direction: 'INBOUND', requests: 2, responses: 1, warnings: 1 },
        { serviceIdentifier: 'SERVICE_B', primitive: 'activatePaymentNotice', direction: 'INBOUND', requests: -2, responses: -2, warnings: 0 },
        { serviceIdentifier: 'SERVICE_C', primitive: 'verifyPaymentNotice', direction: 'INBOUND', requests: 1, responses: 1, warnings: 0 },
      ] },
    }) }));
    await fixture.whenStable();
    expect(bodyRows(fixture).map(cells).map(row => [row[0].split(' (')[0], row[2], row[3]]))
      .toEqual([['SERVICE_A', '6', '5'], ['SERVICE_C', '1', '1']]);
    expect(section(fixture).querySelector('.primitive-warning')?.textContent).toContain('1 in warning');
    fixture.destroy();
  });

  it('splits each group of primitives by direction relative to the Nodo, listing "Non determinata" only when present', async () => {
    const data = snapshot(1, 1);
    data.primitives = [
      { serviceIdentifier: 'SERVICE_A', primitive: 'verifyPaymentNotice', direction: 'INBOUND', requests: 6, responses: 6, warnings: 0 },
      { serviceIdentifier: 'SERVICE_A', primitive: 'paVerifyPaymentNotice', direction: 'OUTBOUND', requests: 3, responses: 1, warnings: 2 },
      { serviceIdentifier: 'SERVICE_A', primitive: 'cacheVersion', direction: 'UNKNOWN', requests: 4, responses: 4, warnings: 0 },
    ];
    const fixture = await createFixture(data);
    const parts = (nature: string): string[][] => [...section(fixture).querySelectorAll('.primitive-nature')]
      .filter(group => group.querySelector('h3')?.textContent?.trim() === nature)
      .flatMap(group => [...group.querySelectorAll('.primitive-direction-group')])
      .map(part => [
        part.querySelector('h4')?.textContent?.split('·')[0].trim() ?? '',
        part.querySelector('.primitive-direction-head b')?.textContent?.trim() ?? '',
        ...[...part.querySelectorAll('.primitive-nature-list .mono')].map(name => name.textContent?.trim() ?? ''),
      ]);
    expect(parts('Consultazione')).toEqual([
      ['In ingresso', '6', 'verifyPaymentNotice'],
      ['In uscita', '3', 'paVerifyPaymentNotice'],
    ]);
    expect(parts('Altre')).toEqual([['Non determinata', '4', 'cacheVersion']]);
    expect(section(fixture).querySelector('[data-direction="OUTBOUND"] .primitive-nature-warn')?.textContent)
      .toContain('2 senza risposta');
    expect(parts('Pagamento')).toEqual([]);
    fixture.destroy();
  });

  it('keeps the same primitive under different directions as separate rows, in snapshots and deltas', async () => {
    const data = snapshot(1, 1);
    data.primitives = [
      { serviceIdentifier: 'SERVICE_A', primitive: 'pspNotifyPayment', direction: 'OUTBOUND', requests: 3, responses: 3, warnings: 0 },
      { serviceIdentifier: 'SERVICE_A', primitive: 'pspNotifyPayment', direction: 'UNKNOWN', requests: 1, responses: 1, warnings: 0 },
    ];
    const fixture = await createFixture(data);
    const delta = aggregateDelta(2, 0);
    stream.next(new MessageEvent('message', { data: JSON.stringify({
      ...delta,
      changes: { ...delta.changes, primitives: [
        { serviceIdentifier: 'SERVICE_A', primitive: 'pspNotifyPayment', direction: 'OUTBOUND', requests: 2, responses: 2, warnings: 0 },
      ] },
    }) }));
    await fixture.whenStable();
    section(fixture).querySelector<HTMLButtonElement>('.primitive-toggle-row')?.click();
    await fixture.whenStable();
    const details = bodyRows(fixture).filter(row => row.classList.contains('primitive-detail')).map(cells);
    expect(details.map(row => [row[0], row[2]])).toEqual([
      ['pspNotifyPayment · Pagamento · In uscita', '5'],
      ['pspNotifyPayment · Pagamento · Non determinata', '1'],
    ]);
    fixture.destroy();
  });
});

describe('OverviewComponent rolling window', () => {
  const setup = async (params: Record<string, string>) => {
    const connect = vi.fn(() => new Subject<MessageEvent<string>>());
    const overview = vi.fn(() => of(snapshot(1, 1)));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(params)) } },
        { provide: ObservabilityApi, useValue: {
          nodeServices: () => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] }),
          connect, overview,
          catalogWithServiceIdentifiers: () => of({ serviceIdentifiers: [] }),
        } },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
        { provide: TimezoneService, useValue: { zone: () => 'Europe/Rome' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OverviewComponent);
    await fixture.whenStable();
    return { connect, overview, fixture };
  };

  it('keeps the window open on the right for a preset range so live primitive requests are counted', async () => {
    const { connect, fixture } = await setup({ window: '15m' });
    const filters = (connect.mock.calls as unknown as [Record<string, string>][])[0][0];
    expect(filters['live']).toBe('true');
    expect(Date.parse(filters['to']) - Date.parse(filters['from'])).toBe(15 * 60_000);
    fixture.destroy();
  });

  it('closes the window for a custom range and sends no live flag', async () => {
    const { connect, fixture } = await setup({
      window: 'custom', from: '2026-10-16T09:00:00.000Z', to: '2026-10-16T10:00:00.000Z',
    });
    const filters = (connect.mock.calls as unknown as [Record<string, string>][])[0][0];
    expect(filters['live']).toBeUndefined();
    expect(filters['to']).toBe('2026-10-16T10:00:00.000Z');
    fixture.destroy();
  });
});

describe('OverviewComponent transition trend', () => {
  const zone = signal('Europe/Rome');
  const stream = new Subject<MessageEvent<string>>();
  const createFixture = async (data: Overview, entity: 'logical' | 'attempt' = 'logical') => {
    zone.set('Europe/Rome');
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: ObservabilityApi, useValue: {
          nodeServices: () => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] }),
          connect: () => stream,
          overview: () => of(data),
          catalogWithServiceIdentifiers: () => of({ serviceIdentifiers: [] }),
        } },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
        { provide: TimezoneService, useValue: { zone } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OverviewComponent);
    await fixture.whenStable();
    stream.next(new MessageEvent('message', { data: JSON.stringify({ type: 'ready' }) }));
    await fixture.whenStable();
    if (entity === 'attempt') await selectDurationTab(fixture, 'Tentativi');
    return fixture;
  };
  const section = (fixture: ComponentFixture<OverviewComponent>): HTMLElement => {
    const element = [...(fixture.nativeElement as HTMLElement).querySelectorAll('section')]
      .find(item => item.querySelector('h2')?.textContent === 'Andamento dei passaggi di stato');
    if (!element) throw new Error('Transition trend section not found');
    return element;
  };
  const transition = (bucketStart: string, count: number, timestampBasis = 'SOURCE_EVENT') =>
    ({ bucketStart, count, timestampBasis, entity: 'attempt', state: 'PAYING' });
  const durationTab = (fixture: ComponentFixture<OverviewComponent>, label: string): HTMLElement => {
    const tab = [...section(fixture).querySelectorAll<HTMLElement>('[role="tab"]')]
      .find(item => item.textContent?.trim() === label);
    if (!tab) throw new Error(`Duration tab ${label} not found`);
    return tab;
  };
  const selectDurationTab = async (fixture: ComponentFixture<OverviewComponent>, label: string) => {
    durationTab(fixture, label).click();
    await fixture.whenStable();
  };

  it.each([0, 1])('explains transition timestamps and provenance with %i chart buckets', async count => {
    const data = snapshot(1, 10);
    data.transitions = count ? [transition('2026-10-16T09:00:00Z', 10)] : [];
    const fixture = await createFixture(data);
    const note = section(fixture).querySelector('aside[aria-label="Come leggere il grafico"]');

    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('transitionAt');
    expect(note?.textContent).toContain('non è l’ora di ricezione o elaborazione');
    expect(note?.textContent).toContain('Da evento');
    expect(note?.textContent).toContain('dataOraEvento');
    expect(note?.textContent).toContain('Inferito');
    expect(note?.textContent).toContain('ricostruito secondo le regole della macchina a stati');
    expect(note?.textContent).toContain('l’ora è quindi stimata');
    fixture.destroy();
  });

  it('renders chronologically ordered stacked bars with source and inferred totals and a legend', async () => {
    const data = snapshot(1, 100);
    data.transitions = [
      transition('2026-10-16T09:00:00Z', 20, 'INFERRED'),
      transition('2026-10-16T08:00:00Z', 10),
      transition('2026-10-16T09:00:00Z', 30),
      { ...transition('2026-10-16T09:00:00Z', 5), entity: 'logical', state: 'PAID' },
      transition('2026-10-16T09:00:00Z', 999, 'ANOMALY'),
    ];
    const originalRows = structuredClone(data.transitions);
    const fixture = await createFixture(data);
    const element = section(fixture);
    const chart = element.querySelector('svg[role="img"]');
    expect(chart).not.toBeNull();
    expect([...chart!.querySelectorAll('rect title')].map(title => title.textContent)).toEqual([
      expect.stringContaining('Da evento (sorgente): 10'),
      expect.stringContaining('Da evento (sorgente): 35'),
      expect.stringContaining('Inferito (ora stimata): 20'),
    ]);
    const bars = [...chart!.querySelectorAll('rect')].filter(rect => rect.querySelector('title'));
    expect(Number(bars[1].getAttribute('y'))).toBeGreaterThan(Number(bars[2].getAttribute('y')));
    expect(Number(bars[2].getAttribute('y')) + Number(bars[2].getAttribute('height')))
      .toBeCloseTo(Number(bars[1].getAttribute('y')));
    expect(bars[2].getAttribute('fill')).toMatch(/^url\(#.+\)$/);
    expect(element.textContent).toContain('Da evento (sorgente)');
    expect(element.textContent).toContain('Inferito (ora stimata)');
    expect(element.querySelectorAll('table')).toHaveLength(0);
    expect(data.transitions).toEqual(originalRows);
    fixture.destroy();
  });

  it('updates bars and durations from aggregate SSE deltas', async () => {
    const data = snapshot(1, 10);
    data.transitions = [transition('2026-10-16T09:00:00Z', 10)];
    const fixture = await createFixture(data);
    const delta = aggregateDelta(2, 0);
    stream.next(new MessageEvent('message', { data: JSON.stringify({
      ...delta,
      changes: {
        ...delta.changes,
        transitions: [transition('2026-10-16T09:00:00Z', 7)],
        durationSnapshot: [{
          entity: 'attempt', fromState: 'PAYING', toState: 'PAID', timestampBasis: 'SOURCE_EVENT',
          samples: 10, averageMs: 41000, medianMs: 41000, p95Ms: 252000,
        }],
      },
    }) }));
    await fixture.whenStable();
    expect(section(fixture).querySelector('rect title')?.textContent).toContain('Da evento (sorgente): 17');
    await selectDurationTab(fixture, 'Tentativi');
    expect(section(fixture).querySelector('table')?.textContent).toContain('41 s');
    expect(section(fixture).querySelector('table')?.textContent).toContain('4 min 12 s');
    fixture.destroy();
  });

  it('reformats the time axis when the selected timezone changes', async () => {
    const data = snapshot(1, 10);
    data.transitions = [transition('2026-10-16T09:00:00Z', 10)];
    const fixture = await createFixture(data);
    expect(section(fixture).querySelector('svg')?.textContent).toContain('11:00');
    zone.set('UTC');
    await fixture.whenStable();
    expect(section(fixture).querySelector('svg')?.textContent).toContain('09:00');
    expect(section(fixture).querySelector('svg')?.textContent).not.toContain('11:00');
    fixture.destroy();
  });

  it('labels daily buckets with dates instead of repeating midnight', async () => {
    const data = snapshot(1, 10);
    data.transitions = [
      transition('2026-10-15T00:00:00Z', 10),
      transition('2026-10-16T00:00:00Z', 20),
    ];
    const fixture = await createFixture(data);
    const labels = [...section(fixture).querySelectorAll('svg text')].map(text => text.textContent);
    expect(labels).toContain('15/10');
    expect(labels).toContain('16/10');
    fixture.destroy();
  });

  it('distinguishes sampled hourly labels that fall at the same time on different days', async () => {
    const data = snapshot(1, 10);
    data.transitions = Array.from({ length: 192 }, (_, index) =>
      transition(new Date(Date.parse('2026-10-09T09:00:00Z') + index * 3_600_000).toISOString(), 10));
    const fixture = await createFixture(data);
    const labels = fixture.componentInstance.transitionTrend().bars.map(bar => bar.label).filter(Boolean);

    expect(labels).toHaveLength(8);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toContain('09/10');
    expect(labels[1]).toContain('10/10');
    expect(labels.every(label => label.includes('11:00'))).toBe(true);
    fixture.destroy();
  });

  it('keeps dates on mixed-resolution series rather than falling back to time-only labels', async () => {
    const data = snapshot(1, 10);
    data.transitions = [
      transition('2026-10-14T00:00:00Z', 10),
      transition('2026-10-15T00:00:00Z', 20),
      transition('2026-10-15T01:00:00Z', 30),
      transition('2026-10-16T00:00:00Z', 40),
    ];
    const fixture = await createFixture(data);
    const labels = fixture.componentInstance.transitionTrend().bars.map(bar => bar.label).filter(Boolean);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels[0]).toContain('14/10');
    expect(labels.at(-1)).toContain('16/10');
    fixture.destroy();
  });

  it('shows seconds for subminute buckets instead of repeating the same minute', async () => {
    const data = snapshot(1, 10);
    data.transitions = [
      transition('2026-10-16T09:00:10Z', 10),
      transition('2026-10-16T09:00:20Z', 20),
      transition('2026-10-16T09:00:30Z', 30),
    ];
    const fixture = await createFixture(data);
    const labels = fixture.componentInstance.transitionTrend().bars.map(bar => bar.label);

    expect(labels).toEqual(['11:00:10', '11:00:20', '11:00:30']);
    fixture.destroy();
  });

  it('distinguishes the repeated local hour during the daylight saving fallback', async () => {
    const data = snapshot(1, 10);
    data.transitions = [
      transition('2026-10-25T00:00:00Z', 10),
      transition('2026-10-25T01:00:00Z', 20),
    ];
    const fixture = await createFixture(data);
    const labels = fixture.componentInstance.transitionTrend().bars.map(bar => bar.label);

    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toContain('02:00');
    expect(labels[0]).toContain('GMT+2');
    expect(labels[1]).toContain('GMT+1');
    fixture.destroy();
  });

  it('keeps zero-count charts finite and preserves the empty state', async () => {
    const data = snapshot(1, 0);
    data.transitions = [transition('2026-10-16T09:00:00Z', 0)];
    const fixture = await createFixture(data);
    expect(section(fixture).querySelector('svg')).not.toBeNull();
    expect(section(fixture).innerHTML).not.toMatch(/NaN|Infinity/);
    fixture.componentInstance.overview.set({ ...data, transitions: [] });
    await fixture.whenStable();
    expect(section(fixture).querySelector('svg')).toBeNull();
    expect(section(fixture).textContent).toContain('Nessun passaggio di stato registrato');
    fixture.destroy();
  });

  it('shows only source-event durations with original states and readable units in three columns', async () => {
    const data = snapshot(1, 10);
    data.durations = [
      { entity: 'attempt', fromState: 'PAYING', toState: 'PAYMENT_RESERVED', timestampBasis: 'SOURCE_EVENT',
        samples: 10, averageMs: 41000, medianMs: 41000, p95Ms: 252000 },
      { entity: 'attempt', fromState: 'PAYMENT_RESERVED', toState: 'PAYMENT_SENT', timestampBasis: 'SOURCE_EVENT',
        samples: 10, averageMs: 400, medianMs: 400, p95Ms: 1100 },
      { entity: 'attempt', fromState: 'PAYMENT_SENT', toState: 'PAYMENT_ACCEPTED', timestampBasis: 'INFERRED',
        samples: 10, averageMs: 100, medianMs: 100, p95Ms: 200 },
    ];
    const fixture = await createFixture(data, 'attempt');
    const table = section(fixture).querySelector('table');
    expect([...table!.querySelectorAll('th')].map(th => th.textContent?.trim())).toEqual(['Passaggio', 'Mediana', 'p95']);
    expect([...table!.querySelectorAll('tbody tr')].map(row =>
      [...row.querySelectorAll('td')].map(td => (td.querySelector('.duration-code') ?? td).textContent?.trim()))).toEqual([
        ['PAYING → PAYMENT_RESERVED', '41 s', '4 min 12 s'],
        ['PAYMENT_RESERVED → PAYMENT_SENT', '0,4 s', '1,1 s'],
      ]);
    fixture.componentInstance.overview.set({ ...data, durations: data.durations.filter(row => row.timestampBasis === 'INFERRED') });
    await fixture.whenStable();
    expect(section(fixture).querySelector('table')).toBeNull();
    expect(section(fixture).textContent).toContain('Nessuna durata calcolabile');
    fixture.destroy();
  });

  const durationRows = (): Overview['durations'] =>
    ATTEMPT_STATES.slice(0, 12).map((state, index) => ({
      entity: 'attempt', fromState: 'PAYING', toState: state, timestampBasis: 'SOURCE_EVENT',
      samples: 10, averageMs: 100, medianMs: 100, p95Ms: index * 1000,
    }));
  const durationToggle = (fixture: ComponentFixture<OverviewComponent>) =>
    [...section(fixture).querySelectorAll('button')]
      .find(button => button.textContent?.trim() === 'Mostra tutto'
        || button.textContent?.trim() === 'Mostra solo i primi 10');
  const durationStates = (fixture: ComponentFixture<OverviewComponent>) =>
    [...section(fixture).querySelectorAll('tbody tr')].map(row => row.querySelector('.duration-code')?.textContent?.trim());

  it('shows the ten highest p95 durations and expands and collapses all rows without mutating the snapshot', async () => {
    const data = snapshot(1, 10);
    data.durations = durationRows();
    const originalRows = structuredClone(data.durations);
    const orderedStates = [...originalRows].reverse().map(row => `${row.fromState} → ${row.toState}`);
    const fixture = await createFixture(data, 'attempt');

    expect(durationStates(fixture)).toEqual(orderedStates.slice(0, 10));
    expect(durationToggle(fixture)?.textContent?.trim()).toBe('Mostra tutto');
    expect(durationToggle(fixture)?.getAttribute('aria-expanded')).toBe('false');
    expect(durationToggle(fixture)?.getAttribute('aria-controls')).toBe('transition-durations');

    durationToggle(fixture)?.click();
    await fixture.whenStable();
    expect(durationStates(fixture)).toEqual(orderedStates);
    expect(durationToggle(fixture)?.textContent?.trim()).toBe('Mostra solo i primi 10');
    expect(durationToggle(fixture)?.getAttribute('aria-expanded')).toBe('true');

    durationToggle(fixture)?.click();
    await fixture.whenStable();
    expect(durationStates(fixture)).toEqual(orderedStates.slice(0, 10));
    expect(data.durations).toEqual(originalRows);
    fixture.destroy();
  });

  it.each([0, 10])('hides the duration expansion button with %i source rows, excluding inferred durations', async count => {
    const data = snapshot(1, 10);
    data.durations = [
      ...durationRows().slice(0, count),
      { ...durationRows()[11], timestampBasis: 'INFERRED', p95Ms: 999999 },
    ];
    const fixture = await createFixture(data, 'attempt');
    expect(durationStates(fixture)).toHaveLength(count);
    expect(durationToggle(fixture)).toBeUndefined();
    fixture.destroy();
  });

  it('reorders durations on SSE updates while keeping the expanded state', async () => {
    const data = snapshot(1, 10);
    data.durations = durationRows();
    const fixture = await createFixture(data, 'attempt');
    const updatedRows = data.durations.map((row, index) => index === 0 ? { ...row, p95Ms: 999999 } : row);
    const update = (revision: number, rows: Overview['durations']) => {
      const delta = aggregateDelta(revision, 0);
      stream.next(new MessageEvent('message', { data: JSON.stringify({
        ...delta, changes: { ...delta.changes, durationSnapshot: rows },
      }) }));
    };
    update(2, updatedRows);
    await fixture.whenStable();
    expect(durationStates(fixture)).toHaveLength(10);
    expect(durationStates(fixture)[0]).toBe(`PAYING → ${updatedRows[0].toState}`);

    durationToggle(fixture)?.click();
    await fixture.whenStable();
    update(3, data.durations);
    await fixture.whenStable();
    expect(durationStates(fixture)).toHaveLength(12);
    expect(durationStates(fixture)[0]).toBe(`PAYING → ${data.durations[11].toState}`);
    expect(durationToggle(fixture)?.getAttribute('aria-expanded')).toBe('true');
    fixture.destroy();
  });

  it('defaults to logical payments and separates identically named transitions without changing the chart', async () => {
    const data = snapshot(1, 10);
    data.transitions = [transition('2026-10-16T09:00:00Z', 10)];
    data.durations = [
      { ...durationRows()[0], entity: 'logical', toState: 'PAID', medianMs: 1000, p95Ms: 2000 },
      { ...durationRows()[0], entity: 'attempt', toState: 'PAID', medianMs: 3000, p95Ms: 4000 },
    ];
    const fixture = await createFixture(data);
    const chart = section(fixture).querySelector('svg')?.outerHTML;
    expect(durationTab(fixture, 'Pagamenti').getAttribute('aria-selected')).toBe('true');
    expect(durationTab(fixture, 'Tentativi').getAttribute('aria-selected')).toBe('false');
    expect(durationStates(fixture)).toEqual(['PAYING → PAID']);
    expect(section(fixture).querySelector('table')?.textContent).toContain('1 s');
    expect(section(fixture).querySelector('table')?.textContent).not.toContain('3 s');

    await selectDurationTab(fixture, 'Tentativi');
    expect(durationTab(fixture, 'Tentativi').getAttribute('aria-selected')).toBe('true');
    expect(durationTab(fixture, 'Pagamenti').getAttribute('aria-selected')).toBe('false');
    expect(durationStates(fixture)).toEqual(['PAYING → PAID']);
    expect(section(fixture).querySelector('table')?.textContent).toContain('3 s');
    expect(section(fixture).querySelector('table')?.textContent).not.toContain('1 s');
    expect(section(fixture).querySelector('svg')?.outerHTML).toBe(chart);
    const panel = section(fixture).querySelector('[role="tabpanel"]');
    expect(durationTab(fixture, 'Tentativi').getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(durationTab(fixture, 'Tentativi').id);
    fixture.destroy();
  });

  it('limits the selected entity independently and resets expansion on each tab switch', async () => {
    const data = snapshot(1, 10);
    data.durations = [
      ...durationRows(),
      { ...durationRows()[0], entity: 'logical', toState: 'PAID' },
    ];
    const fixture = await createFixture(data);
    expect(durationStates(fixture)).toEqual(['PAYING → PAID']);
    expect(durationToggle(fixture)).toBeUndefined();

    await selectDurationTab(fixture, 'Tentativi');
    expect(durationStates(fixture)).toHaveLength(10);
    expect(durationToggle(fixture)?.getAttribute('aria-expanded')).toBe('false');
    durationToggle(fixture)?.click();
    await fixture.whenStable();
    expect(durationStates(fixture)).toHaveLength(12);

    await selectDurationTab(fixture, 'Pagamenti');
    expect(durationStates(fixture)).toHaveLength(1);
    expect(durationToggle(fixture)).toBeUndefined();
    await selectDurationTab(fixture, 'Tentativi');
    expect(durationStates(fixture)).toHaveLength(10);
    expect(durationToggle(fixture)?.getAttribute('aria-expanded')).toBe('false');
    fixture.destroy();
  });

  it('shows an entity-specific empty state while the other tab still has durations', async () => {
    const data = snapshot(1, 10);
    data.durations = durationRows();
    const fixture = await createFixture(data);
    expect(section(fixture).querySelector('table')).toBeNull();
    expect(section(fixture).textContent).toContain('Nessuna durata calcolabile per i pagamenti logici');
    await selectDurationTab(fixture, 'Tentativi');
    expect(durationStates(fixture)).toHaveLength(10);
    fixture.componentInstance.overview.set({ ...data, durations: [] });
    await fixture.whenStable();
    expect(section(fixture).textContent).toContain('Nessuna durata calcolabile per i tentativi');
    expect(durationToggle(fixture)).toBeUndefined();
    fixture.destroy();
  });

  it('supports keyboard focus between the duration tabs', async () => {
    const fixture = await createFixture(snapshot(1, 0));
    const logical = durationTab(fixture, 'Pagamenti');
    const attempt = durationTab(fixture, 'Tentativi');
    logical.focus();
    logical.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(attempt);
    attempt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await fixture.whenStable();
    expect(attempt.getAttribute('aria-selected')).toBe('true');
    fixture.destroy();
  });

  it.each([
    [0, '0 s'], [1, '0,001 s'], [40, '0,04 s'], [60000, '1 min'],
    [59999, '1 min'], [363000, '6 min 3 s'],
  ])('formats %i milliseconds as %s without losing subsecond durations', async (milliseconds, expected) => {
    const fixture = await createFixture(snapshot(1, 0));
    expect(fixture.componentInstance.formatDuration(milliseconds)).toBe(expected);
    fixture.destroy();
  });
});

describe('OverviewComponent unresolved matrix', () => {
  const createFixture = async (data: Overview, stream?: Subject<MessageEvent<string>>) => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          queryParamMap: of(convertToParamMap({ window: '7d', serviceIdentifier: 'NODO_V2' })),
        } },
        { provide: ObservabilityApi, useValue: {
          nodeServices: () => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] }),
          connect: () => stream ?? of(new MessageEvent('message', { data: JSON.stringify({ type: 'ready' }) })),
          overview: () => of(data),
          catalogWithServiceIdentifiers: () => of({ serviceIdentifiers: ['NODO_V2'] }),
        } },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
        { provide: TimezoneService, useValue: { zone: () => 'Europe/Rome' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OverviewComponent);
    await fixture.whenStable();
    if (stream) {
      stream.next(new MessageEvent('message', { data: JSON.stringify({ type: 'ready', projectionRevision: data.projectionRevision }) }));
      await fixture.whenStable();
    }
    return fixture;
  };
  const section = (fixture: ComponentFixture<OverviewComponent>): HTMLElement => {
    const element = [...(fixture.nativeElement as HTMLElement).querySelectorAll('section')]
      .find(item => item.querySelector('h2')?.textContent === 'Dove si concentrano i casi non risolti');
    if (!element) throw new Error('Unresolved matrix section not found');
    return element;
  };
  const button = (element: HTMLElement, name: string) =>
    [...element.querySelectorAll('button')].find(item => item.textContent?.trim() === name);
  const expansionButton = (element: HTMLElement, name: string) =>
    [...element.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === name);
  const cells = (row: Element) => [...row.querySelectorAll('td')].map(cell => cell.textContent?.trim());

  it('shows a compact PSP summary with exact unresolved-state headers and totals', async () => {
    const data = snapshot(1, 100);
    data.matrices.psp = [{ value: 'ABI03069', states: [
      { state: 'PAYMENT_UNKNOWN', count: 2 },
      { state: 'PAYMENT_SEND_ERROR', count: 3 },
      { state: 'PAYMENT_RESERVED', count: 43 },
      { state: 'CANCELLED', count: 1 },
    ] }];
    const fixture = await createFixture(data);
    const element = section(fixture);
    const headers = [...element.querySelectorAll('th')].map(cell => cell.textContent?.trim());
    const row = element.querySelector('tbody tr');
    if (!row) throw new Error('Expected the PSP matrix row to render');
    const values = cells(row);
    const columnValue = (header: string) => values[headers.indexOf(header)];

    expect(headers.filter(header => header && header !== 'Dettaglio')).toEqual([
      'PSP', 'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR', 'Non risolti', 'Totale tentativi',
    ]);
    expect(columnValue('PAYMENT_UNKNOWN')).toBe('2');
    expect(columnValue('PAYMENT_SEND_ERROR')).toBe('3');
    expect(columnValue('Non risolti')).toBe('5');
    expect(columnValue('Totale tentativi')).toBe('49');
    expect(row?.querySelector('a[href*="psp=ABI03069"], button')).not.toBeNull();
    fixture.destroy();
  });

  it('counts omitted and explicitly zero states as zero in the total attempts', async () => {
    const data = snapshot(1, 100);
    data.matrices.psp = [
      { value: 'omitted-state', states: [{ state: 'PAYMENT_RESERVED', count: 4 }] },
      { value: 'explicit-zero', states: [{ state: 'PAYMENT_RESERVED', count: 0 }] },
    ];
    const fixture = await createFixture(data);
    const element = section(fixture);
    const headers = [...element.querySelectorAll('th')].map(cell => cell.textContent?.trim());
    const totalIndex = headers.indexOf('Totale tentativi');
    const rows = [...element.querySelectorAll('tbody tr')];

    expect(headers).toContain('Totale tentativi');
    expect(rows.map(row => cells(row)[0])).toEqual(['omitted-state', 'explicit-zero']);
    expect(rows.map(row => cells(row)[totalIndex])).toEqual(['4', '0']);
    fixture.destroy();
  });

  it.each(['psp', 'canale'] as const)('orders %s rows by unresolved count, total, then binary value with null last', async dimension => {
    const data = snapshot(1, 100);
    data.matrices[dimension] = [
      { value: 'a', states: [{ state: 'PAYMENT_UNKNOWN', count: 1 }, { state: 'PAYING', count: 3 }] },
      { value: null, states: [{ state: 'PAYMENT_UNKNOWN', count: 9 }] },
      { value: 'zero-unresolved', states: [{ state: 'PAYMENT_RESERVED', count: 50 }] },
      { value: 'high-total', states: [{ state: 'PAYMENT_UNKNOWN', count: 1 }, { state: 'PAYMENT_RESERVED', count: 10 }] },
      { value: 'high-unresolved', states: [{ state: 'PAYMENT_UNKNOWN', count: 2 }] },
      { value: 'A', states: [{ state: 'PAYMENT_UNKNOWN', count: 1 }, { state: 'PAYING', count: 3 }] },
    ];
    const fixture = await createFixture(data);
    const element = section(fixture);
    button(element, dimension === 'psp' ? 'Per PSP' : 'Per canale')?.click();
    await fixture.whenStable();

    expect([...element.querySelectorAll('tbody tr')].map(row => cells(row)[0])).toEqual([
      'high-unresolved', 'high-total', 'A', 'a', 'zero-unresolved', 'Non disponibile',
    ]);
    fixture.destroy();
  });

  it('sorts more than ten rows before slicing and keeps that order when showing all', async () => {
    const data = snapshot(1, 100);
    const rows = Array.from({ length: 11 }, (_, index) => ({
      value: `psp-${String(index).padStart(2, '0')}`,
      states: [{ state: 'PAYMENT_UNKNOWN', count: 1 }],
    })).reverse();
    data.matrices.psp = [...rows, { value: null, states: [{ state: 'PAYMENT_UNKNOWN', count: 100 }] }];
    const fixture = await createFixture(data);
    const element = section(fixture);
    const renderedValues = () => [...element.querySelectorAll('tbody tr')].map(row => cells(row)[0]);
    const sortedValues = [
      ...Array.from({ length: 11 }, (_, index) => `psp-${String(index).padStart(2, '0')}`),
      'Non disponibile',
    ];

    expect(renderedValues()).toEqual(sortedValues.slice(0, 10));
    button(element, 'Mostra tutti')?.click();
    await fixture.whenStable();
    expect(renderedValues()).toEqual(sortedValues);
    fixture.destroy();
  });

  it.each(['psp', 'canale'] as const)('shows the top ten %s rows by all-state totals and expands and collapses the rest', async dimension => {
    const data = snapshot(1, 100);
    data.matrices[dimension] = Array.from({ length: 12 }, (_, index) => ({
      value: `${dimension}-${index}`,
      states: [
        { state: 'PAYING', count: index + 1 },
        { state: 'NOTIFIED', count: index === 0 ? 1000 : 0 },
      ],
    }));
    const originalRows = structuredClone(data.matrices[dimension]);
    const fixture = await createFixture(data);
    const element = section(fixture);
    button(element, dimension === 'psp' ? 'Per PSP' : 'Per canale')?.click();
    await fixture.whenStable();
    const renderedValues = () => [...element.querySelectorAll('tbody tr')].map(row => cells(row)[0]);

    expect(renderedValues()).toEqual([0, 11, 10, 9, 8, 7, 6, 5, 4, 3].map(index => `${dimension}-${index}`));
    expect(button(element, 'Mostra tutti')?.getAttribute('aria-expanded')).toBe('false');
    expect(button(element, 'Mostra tutti')?.getAttribute('aria-controls')).toBe('unresolved-matrix');

    button(element, 'Mostra tutti')?.click();
    await fixture.whenStable();
    expect(renderedValues()).toEqual([0, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(index => `${dimension}-${index}`));
    expect(button(element, 'Mostra solo i primi 10')?.getAttribute('aria-expanded')).toBe('true');
    expect(data.matrices[dimension]).toEqual(originalRows);

    fixture.componentInstance.overview.set({
      ...data,
      matrices: {
        ...data.matrices,
        [dimension]: data.matrices[dimension].map((row, index) =>
          index === 1 ? { ...row, states: [{ state: 'PAYING', count: 2000 }] } : row),
      },
    });
    await fixture.whenStable();
    expect(renderedValues()).toHaveLength(12);
    expect(renderedValues()[0]).toBe(`${dimension}-1`);

    button(element, 'Mostra solo i primi 10')?.click();
    await fixture.whenStable();
    expect(renderedValues()).toHaveLength(10);
    expect(renderedValues()[0]).toBe(`${dimension}-1`);
    fixture.destroy();
  });

  it('starts each dimension with ten rows and hides the expansion control for ten or fewer', async () => {
    const data = snapshot(1, 100);
    data.matrices.psp = Array.from({ length: 11 }, (_, index) => ({
      value: `psp-${index}`, states: [{ state: 'PAYING', count: index }],
    }));
    data.matrices.canale = structuredClone(data.matrices.psp);
    const fixture = await createFixture(data);
    const element = section(fixture);
    button(element, 'Mostra tutti')?.click();
    await fixture.whenStable();
    expect(element.querySelectorAll('tbody tr')).toHaveLength(11);

    button(element, 'Per canale')?.click();
    await fixture.whenStable();
    expect(element.querySelectorAll('tbody tr')).toHaveLength(10);
    fixture.componentInstance.overview.set({
      ...data, matrices: { ...data.matrices, canale: data.matrices.canale.slice(0, 10) },
    });
    await fixture.whenStable();
    expect(element.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(button(element, 'Mostra tutti')).toBeUndefined();
    expect(button(element, 'Mostra solo i primi 10')).toBeUndefined();
    fixture.destroy();
  });

  it('highlights only positive UNKNOWN and SEND_ERROR cells and clears them when resolved', async () => {
    const data = snapshot(1, 100);
    data.matrices.psp = [{ value: 'psp-1', states: [
      { state: 'PAYING', count: 5 },
      { state: 'PAYMENT_UNKNOWN', count: 2 },
      { state: 'PAYMENT_SEND_ERROR', count: 3 },
    ] }];
    const fixture = await createFixture(data);
    const element = section(fixture);
    const highlightedStates = () => {
      const headers = [...element.querySelectorAll('th')];
      return [...element.querySelectorAll('tbody td')]
        .flatMap((cell, index) => cell.classList.contains('warn-cell') ? [headers[index].title] : []);
    };

    expect(highlightedStates()).toEqual(['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR']);
    fixture.componentInstance.overview.set({
      ...data, matrices: { ...data.matrices, psp: [{ value: 'psp-1', states: [
        { state: 'PAYING', count: 5 }, { state: 'PAYMENT_UNKNOWN', count: 0 },
      ] }] },
    });
    await fixture.whenStable();
    expect(highlightedStates()).toEqual([]);
    fixture.destroy();
  });

  it('renders one PSP matrix with the exact mockup columns, one row per PSP and unresolved totals', async () => {
    const data = snapshot(1, 100);
    data.matrices.psp = [
      { value: 'ABI03069', states: [
        { state: 'PAYMENT_SEND_ERROR', count: 38 }, { state: 'PAYING', count: 820 },
        { state: 'PAYMENT_UNKNOWN', count: 121 }, { state: 'PAYMENT_RESERVED', count: 99 },
        { state: 'PAID', count: 22140 },
      ] },
      { value: null, states: [{ state: 'PAYMENT_UNKNOWN', count: 9 }] },
    ];
    data.matrices.canale = [{ value: 'channel-1', states: [{ state: 'PAYING', count: 7 }] }];
    const fixture = await createFixture(data);
    const element = section(fixture);

    expect(element.querySelectorAll('table')).toHaveLength(1);
    expect([...element.querySelectorAll('th')].map(cell => cell.textContent?.trim())).toEqual([
      'PSP', 'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR', 'Non risolti', 'Totale tentativi', 'Dettaglio',
    ]);
    const rows = element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(cells(rows[0])).toEqual(['ABI03069', '121', '38', '159', '23,218', '']);
    expect(cells(rows[1])).toEqual(['Non disponibile', '9', '0', '9', '9', '']);
    expect(element.textContent).toContain('Tentativi per stato ripartiti per PSP o canale; destinatari ricevuta per');
    expect(element.textContent).not.toContain('channel-1');
    expect(button(element, 'Per PSP')?.getAttribute('aria-pressed')).toBe('true');
    expect(button(element, 'Per canale')?.getAttribute('aria-pressed')).toBe('false');
    const links = [...element.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    expect(Object.fromEntries(new URL(links[0].href).searchParams)).toEqual({
      window: '7d', serviceIdentifier: 'NODO_V2', view: 'attempts', psp: 'ABI03069',
    });
    expect(new URL(links[1].href).searchParams.get('psp')).toBe('~unknown');
    fixture.destroy();
  });

  it('switches to channels and refreshes counts without resetting the selected dimension', async () => {
    const data = snapshot(1, 100);
    data.matrices.psp = [{ value: 'ABI03069', states: [{ state: 'PAYING', count: 820 }] }];
    data.matrices.canale = [{ value: '97735020584_05', states: [{ state: 'PAYMENT_UNKNOWN', count: 150 }] }];
    const fixture = await createFixture(data);
    const element = section(fixture);

    button(element, 'Per canale')?.click();
    await fixture.whenStable();
    expect(element.querySelector('th')?.textContent).toBe('Canale');
    expect(button(element, 'Per canale')?.getAttribute('aria-pressed')).toBe('true');
    expect(element.textContent).not.toContain('ABI03069');
    expect(cells(element.querySelector('tbody tr')!)[3]).toBe('150');
    const link = element.querySelector('a');
    expect(link).not.toBeNull();
    expect(Object.fromEntries(new URL(link!.href).searchParams)).toEqual({
      window: '7d', serviceIdentifier: 'NODO_V2', view: 'attempts', canale: '97735020584_05',
    });

    fixture.componentInstance.overview.set({
      ...data,
      matrices: { ...data.matrices, canale: [
        { value: '97735020584_05', states: [{ state: 'PAYMENT_SEND_ERROR', count: 44 }] },
      ] },
    });
    await fixture.whenStable();
    expect(cells(element.querySelector('tbody tr')!)).toEqual([
      '97735020584_05', '0', '44', '44', '44', '',
    ]);
    button(element, 'Per PSP')?.click();
    await fixture.whenStable();
    expect(element.querySelector('th')?.textContent).toBe('PSP');
    fixture.destroy();
  });

  it('shows an explicit empty state for a dimension without rows', async () => {
    const fixture = await createFixture(snapshot(1, 0));
    const element = section(fixture);
    expect(element.textContent).toContain('Nessun dato disponibile per PSP.');
    button(element, 'Per canale')?.click();
    await fixture.whenStable();
    expect(element.textContent).toContain('Nessun dato disponibile per Canale.');
    fixture.destroy();
  });

  it('expands accessible PSP and channel rows independently with all attempt codes and counts', async () => {
    const data = snapshot(1, 100);
    data.matrices.psp = [
      { value: 'ABI00001', states: [{ state: 'PAYING', count: 6 }, { state: 'PAYMENT_UNKNOWN', count: 2 }] },
      { value: 'ABI00002', states: [{ state: 'PAID', count: 3 }] },
    ];
    data.matrices.canale = [{ value: 'channel-1', states: [{ state: 'PAYMENT_SEND_ERROR', count: 4 }] }];
    const fixture = await createFixture(data);
    const element = section(fixture);
    const first = expansionButton(element, 'Mostra stati per PSP ABI00001');
    const second = expansionButton(element, 'Mostra stati per PSP ABI00002');

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.getAttribute('aria-expanded')).toBe('false');
    expect(second?.getAttribute('aria-expanded')).toBe('false');
    expect(first?.getAttribute('aria-controls')).toBeNull();
    expect(second?.getAttribute('aria-controls')).toBeNull();
    first?.click();
    second?.click();
    await fixture.whenStable();

    const expandedButtons = [first, second];
    const detailIds = expandedButtons.map(item => item?.getAttribute('aria-controls'));
    expect(new Set(detailIds).size).toBe(2);
    for (const [index, control] of expandedButtons.entries()) {
      expect(control?.getAttribute('aria-expanded')).toBe('true');
      const detail = element.querySelector<HTMLElement>(`#${CSS.escape(detailIds[index] ?? '')}`);
      expect(detail).not.toBeNull();
      expect(detail?.hidden).toBe(false);
      expect([...detail!.querySelectorAll('[data-attempt-state]')].map(item => item.getAttribute('data-attempt-state')))
        .toEqual(ATTEMPT_STATES);
    }
    const firstDetail = element.querySelector<HTMLElement>(`#${CSS.escape(detailIds[0] ?? '')}`);
    expect(firstDetail?.textContent).toContain('PAYING');
    expect(firstDetail?.textContent).toContain('PAYMENT_UNKNOWN');
    expect(firstDetail?.textContent).toContain('2');
    expect(firstDetail?.textContent).toContain('PAYMENT_SEND_ERROR');
    expect([...firstDetail!.querySelectorAll('tr')].map(row => [
      row.querySelector('[data-attempt-state]')?.getAttribute('data-attempt-state'),
      row.querySelector('td')?.textContent?.trim(),
    ])).toEqual(ATTEMPT_STATES.map(state => [
      state,
      (state === 'PAYING' ? 6 : state === 'PAYMENT_UNKNOWN' ? 2 : 0).toLocaleString('it-IT'),
    ]));
    first?.click();
    await fixture.whenStable();
    expect(first?.getAttribute('aria-expanded')).toBe('false');
    expect(first?.getAttribute('aria-controls')).toBeNull();
    expect(element.querySelector(`#${CSS.escape(detailIds[0] ?? '')}`)).toBeNull();
    expect(second?.getAttribute('aria-expanded')).toBe('true');

    button(element, 'Per canale')?.click();
    await fixture.whenStable();
    const channelToggle = expansionButton(element, 'Mostra stati per Canale channel-1');
    expect(channelToggle).toBeDefined();
    channelToggle?.click();
    await fixture.whenStable();
    expect(channelToggle?.getAttribute('aria-expanded')).toBe('true');
    button(element, 'Per PSP')?.click();
    await fixture.whenStable();
    expect([...element.querySelectorAll('button')]
      .find(item => item.getAttribute('aria-label')?.endsWith('PSP ABI00002'))?.getAttribute('aria-expanded')).toBe('true');
    button(element, 'Per canale')?.click();
    await fixture.whenStable();
    expect([...element.querySelectorAll('button')]
      .find(item => item.getAttribute('aria-label')?.endsWith('Canale channel-1'))?.getAttribute('aria-expanded')).toBe('true');
    fixture.destroy();
  });

  it('degrades the freshness indicators when the stream drops after the snapshot was loaded', async () => {
    const stream = new Subject<MessageEvent<string>>();
    const fixture = await createFixture(snapshot(1, 100), stream);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Dati aggiornati alle');
    expect(root.textContent).not.toContain('NON AGGIORNATO');

    stream.next(new MessageEvent('connection-error'));
    await fixture.whenStable();
    expect(root.textContent).toContain('Connessione interrotta');
    expect(root.textContent).toContain('NON AGGIORNATO');
    expect(root.textContent).not.toContain('Dati aggiornati alle');

    stream.next(new MessageEvent('message', { data: JSON.stringify({ type: 'ready', projectionRevision: 1 }) }));
    await fixture.whenStable();
    expect(root.textContent).toContain('Dati aggiornati alle');
    expect(root.textContent).not.toContain('NON AGGIORNATO');
    fixture.destroy();
  });

  it('keeps expansion attached to row values through SSE sorting and top-ten entry and exit', async () => {
    const stream = new Subject<MessageEvent<string>>();
    const data = snapshot(1, 100);
    data.matrices.psp = Array.from({ length: 11 }, (_, index) => ({
      value: `psp-${String(index).padStart(2, '0')}`,
      states: [{ state: 'PAYMENT_UNKNOWN', count: 11 - index }],
    }));
    data.matrices.canale = [{ value: 'channel-1', states: [{ state: 'PAYING', count: 5 }] }];
    const fixture = await createFixture(data, stream);
    const element = section(fixture);
    const emitMatrixDelta = (projectionRevision: number, psp: { value: string; state: string; count: number }[]) => {
      const delta = aggregateDelta(projectionRevision, 0);
      stream.next(new MessageEvent('message', { data: JSON.stringify({
        ...delta,
        changes: { ...delta.changes, matrices: { ...delta.changes.matrices, psp } },
      }) }));
    };
    const rowToggle = (dimension: 'psp' | 'canale', value: string) =>
      [...element.querySelectorAll('button')]
        .find(item => item.getAttribute('aria-label')?.endsWith(` ${dimension === 'psp' ? 'PSP' : 'Canale'} ${value}`));
    const visiblePspValues = () => [...element.querySelectorAll(
      'button[aria-label^="Mostra stati per PSP "], button[aria-label^="Nascondi stati per PSP "]',
    )].map(toggle => toggle.closest('tr')?.querySelector('td')?.textContent?.trim());
    const psp00 = rowToggle('psp', 'psp-00');
    const psp05 = rowToggle('psp', 'psp-05');
    const psp09 = rowToggle('psp', 'psp-09');
    expect(rowToggle('psp', 'psp-10')).toBeUndefined();
    expect(visiblePspValues()).toEqual(Array.from({ length: 10 }, (_, index) =>
      `psp-${String(index).padStart(2, '0')}`));
    psp00?.click();
    psp05?.click();
    psp09?.click();
    await fixture.whenStable();

    emitMatrixDelta(2, [
      { value: 'psp-00', state: 'PAYMENT_UNKNOWN', count: 1 },
      { value: 'psp-05', state: 'PAYMENT_UNKNOWN', count: 10 },
      { value: 'psp-10', state: 'PAYMENT_UNKNOWN', count: 2 },
    ]);
    await fixture.whenStable();
    expect(rowToggle('psp', 'psp-00')?.getAttribute('aria-expanded')).toBe('true');
    expect(rowToggle('psp', 'psp-05')?.getAttribute('aria-expanded')).toBe('true');
    expect(rowToggle('psp', 'psp-09')).toBeUndefined();
    expect(rowToggle('psp', 'psp-10')).toBeDefined();
    expect(visiblePspValues()?.slice(0, 2)).toEqual(['psp-05', 'psp-00']);
    expect(element.querySelector(`#${CSS.escape(rowToggle('psp', 'psp-00')?.getAttribute('aria-controls') ?? '')}`)
      ?.textContent).toContain('12');

    emitMatrixDelta(3, [{ value: 'psp-10', state: 'PAYMENT_UNKNOWN', count: -2 }]);
    await fixture.whenStable();
    expect(rowToggle('psp', 'psp-09')?.getAttribute('aria-expanded')).toBe('true');
    expect(rowToggle('psp', 'psp-10')).toBeUndefined();

    button(element, 'Per canale')?.click();
    await fixture.whenStable();
    const channelToggle = rowToggle('canale', 'channel-1');
    channelToggle?.click();
    await fixture.whenStable();
    expect(channelToggle?.getAttribute('aria-expanded')).toBe('true');
    button(element, 'Per PSP')?.click();
    await fixture.whenStable();
    expect(rowToggle('psp', 'psp-05')?.getAttribute('aria-expanded')).toBe('true');
    button(element, 'Per canale')?.click();
    await fixture.whenStable();
    expect(rowToggle('canale', 'channel-1')?.getAttribute('aria-expanded')).toBe('true');
    fixture.destroy();
  });

  it('shows the full recipient state identifiers without attempt summaries or expansion controls', async () => {
    const data = snapshot(1, 100);
    data.matrices.recipient = [{
      value: 'recipient-1',
      states: [
        { state: 'NOTICE_GENERATED', count: 1 }, { state: 'NOTICE_SENT', count: 2 },
        { state: 'NOTICE_PENDING', count: 3 }, { state: 'NOTIFIED', count: 4 },
      ],
    }];
    const fixture = await createFixture(data);
    const element = section(fixture);
    button(element, 'Per stazione')?.click();
    await fixture.whenStable();

    expect([...element.querySelectorAll('th')].map(item => item.textContent?.trim())).toEqual([
      'Destinatario', 'NOTICE_GENERATED', 'NOTICE_SENT', 'NOTICE_PENDING', 'NOTIFIED',
    ]);
    expect(element.textContent).not.toContain('Totale tentativi');
    expect(element.textContent).not.toContain('Non risolti');
    expect([...element.querySelectorAll('button')].some(item => item.getAttribute('aria-label')?.startsWith('Mostra stati')))
      .toBe(false);
    fixture.destroy();
  });
});

describe('OverviewComponent SSE establishment errors', () => {
  it('ends loading and exposes the complete filtered attempt-list fallback on SSE 422', async () => {
    const api = {
      nodeServices: vi.fn(() => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] })),
      connect: vi.fn(() => throwError(() => new StreamHttpError(422))),
      overview: vi.fn(() => of()),
      catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
    };
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          queryParamMap: of(convertToParamMap({
            window: '7d',
            logicalState: 'PAYING',
            attemptState: 'PAYMENT_UNKNOWN',
            serviceIdentifier: 'svc-1',
            psp: 'psp-1',
            canale: 'channel-1',
          })),
          snapshot: { queryParams: {} },
        } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
        { provide: TimezoneService, useValue: { zone: () => 'Europe/Rome' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.loading()).toBe(false);
    expect(fixture.componentInstance.error()).toContain('combinazione non è disponibile');
    expect(fixture.componentInstance.attemptListParams()).toEqual({
      view: 'attempts',
      window: '7d',
      logicalState: 'PAYING',
      attemptState: 'PAYMENT_UNKNOWN',
      serviceIdentifier: 'svc-1',
      psp: 'psp-1',
      canale: 'channel-1',
    });
    expect(fixture.componentInstance.paymentListParams({ logicalState: 'PAID' })).toMatchObject({
      window: '7d', logicalState: 'PAID', attemptState: 'PAYMENT_UNKNOWN', serviceIdentifier: 'svc-1',
      psp: 'psp-1', canale: 'channel-1',
    });
    expect(fixture.componentInstance.matrixListParams('psp', 'psp-2')).toMatchObject({
      window: '7d', psp: 'psp-2', canale: 'channel-1', view: 'attempts',
    });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Apri lista tentativi');
    expect(api.overview).not.toHaveBeenCalled();
    fixture.destroy();
  });
});

describe('OverviewComponent snapshot reconciliation', () => {
  it('buffers during snapshots, reconciles a gap without losing newer events, and skips GET on replay ready', async () => {
    const stream = new Subject<MessageEvent<string>>();
    const requests: Subject<Overview>[] = [];
    const api = {
      nodeServices: vi.fn(() => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] })),
      connect: vi.fn(() => stream),
      overview: vi.fn(() => {
        const request = new Subject<Overview>();
        requests.push(request);
        return request;
      }),
      catalogWithServiceIdentifiers: vi.fn(() => of({ serviceIdentifiers: [] })),
    };
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          queryParamMap: of(convertToParamMap({ window: '1h' })),
          snapshot: { queryParams: {} },
        } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
        { provide: TimezoneService, useValue: { zone: () => 'UTC' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();
    const emit = (value: unknown) => stream.next(new MessageEvent('message', { data: JSON.stringify(value) }));
    emit({ type: 'ready', projectionRevision: 0 });
    emit(aggregateDelta(2, 1));
    requests[0].next(snapshot(1, 10));
    expect(fixture.componentInstance.overview()?.counts.payments).toBe(11);
    expect(requests).toHaveLength(1);

    emit({ type: 'ready', projectionRevision: 2 });
    expect(requests).toHaveLength(1);
    emit(aggregateDelta(4, 4));
    expect(requests).toHaveLength(2);
    emit(aggregateDelta(5, 1));
    requests[1].next(snapshot(4, 50));

    expect(fixture.componentInstance.overview()?.projectionRevision).toBe(5);
    expect(fixture.componentInstance.overview()?.counts.payments).toBe(51);
    expect(requests).toHaveLength(2);
    fixture.destroy();
  });
});

describe('OverviewComponent service identifier catalog', () => {
  const createFixture = async (
    api: { catalogWithServiceIdentifiers: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; overview: ReturnType<typeof vi.fn> },
    queryParams: Record<string, string> = {},
  ) => {
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: ActivatedRoute, useValue: {
          queryParamMap: of(convertToParamMap(queryParams)),
          snapshot: { queryParams },
        } },
        { provide: ObservabilityApi, useValue: api },
        { provide: SessionService, useValue: { token: signal('DEMO_VIEWER') } },
        { provide: TimezoneService, useValue: { zone: () => 'UTC' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OverviewComponent);
    fixture.detectChanges();
    return fixture;
  };

  const createApi = (catalog: () => Observable<{ serviceIdentifiers: string[] }>) => ({
    nodeServices: vi.fn(() => of({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] })),
    catalogWithServiceIdentifiers: vi.fn(catalog),
    connect: vi.fn(() => new Subject<MessageEvent<string>>()),
    overview: vi.fn(() => of()),
  });

  const serviceSelect = (fixture: ComponentFixture<OverviewComponent>): HTMLSelectElement =>
    fixture.nativeElement.querySelector('select[aria-label="Identificativo del servizio"]') as HTMLSelectElement;

  it('shows the catalog options and selects the active query parameter', async () => {
    const fixture = await createFixture(createApi(() => of({ serviceIdentifiers: ['svc-1', 'svc-2'] })), {
      serviceIdentifier: 'svc-2',
    });

    expect([...serviceSelect(fixture).options].map(option => option.textContent?.trim())).toEqual(['Tutti', 'svc-1', 'svc-2']);
    expect(serviceSelect(fixture).value).toBe('svc-2');
    expect(fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]')).toBeNull();
    fixture.destroy();
  });

  it('shows only Tutti when the catalog is empty and no query filter is active', async () => {
    const fixture = await createFixture(createApi(() => of({ serviceIdentifiers: [] })));

    expect([...serviceSelect(fixture).options].map(option => option.textContent?.trim())).toEqual(['Tutti']);
    expect(serviceSelect(fixture).disabled).toBe(false);
    fixture.destroy();
  });

  it('marks an active query value absent from a populated catalog', async () => {
    const fixture = await createFixture(createApi(() => of({ serviceIdentifiers: ['svc-current'] })), {
      serviceIdentifier: 'svc-removed',
    });

    expect(serviceSelect(fixture).value).toBe('svc-removed');
    expect([...serviceSelect(fixture).options].map(option => option.textContent?.trim())).toEqual([
      'Tutti',
      'svc-removed (non presente nell’elenco)',
      'svc-current',
    ]);
    fixture.destroy();
  });

  it('retains and allows clearing an active filter missing from an empty catalog', async () => {
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

  it('shows loading and disables the select while catalog data is pending', async () => {
    const request = new Subject<{ serviceIdentifiers: string[] }>();
    const fixture = await createFixture(createApi(() => request));

    expect(serviceSelect(fixture).disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Caricamento elenco');
    expect(fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]')).toBeNull();
    fixture.destroy();
  });

  it('marks an active URL value obsolete only after a successful catalog load proves it absent', async () => {
    const initialRequest = new Subject<{ serviceIdentifiers: string[] }>();
    const retryRequest = new Subject<{ serviceIdentifiers: string[] }>();
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

  it('shows a separate catalog error and retries successfully without losing the URL filter', async () => {
    const initialRequest = new Subject<{ serviceIdentifiers: string[] }>();
    const retryRequest = new Subject<{ serviceIdentifiers: string[] }>();
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
    expect((fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]') as HTMLButtonElement).disabled).toBe(true);
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

  it('keeps the error visible and the select disabled after a failed retry', async () => {
    const initialRequest = new Subject<{ serviceIdentifiers: string[] }>();
    const retryRequest = new Subject<{ serviceIdentifiers: string[] }>();
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

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('elenco degli identificativi');
    expect(serviceSelect(fixture).disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('button[aria-label="Riprova caricamento elenco"]') as HTMLButtonElement).disabled).toBe(false);
    fixture.destroy();
  });
});
