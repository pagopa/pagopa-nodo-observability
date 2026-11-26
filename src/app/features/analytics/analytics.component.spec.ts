import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { Filters, ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { ActivationsOutcomes } from '../../models/analytics';
import { AnalyticsComponent } from './analytics.component';

const result = (extra: Partial<ActivationsOutcomes> = {}): ActivationsOutcomes => ({
  window: { from: '2026-11-24T09:00:00.000Z', to: '2026-11-24T10:00:00.000Z' }, live: false,
  activatePaymentNoticeOk: { total: 1250, activatePaymentNotice: 250, activatePaymentNoticeV2: 1000 },
  sendPaymentOutcome: { total: 1247, sendPaymentOutcome: 247, sendPaymentOutcomeV2: 1000 }, difference: -3,
  tokens: {
    total: 1250,
    acceptedOutcome: { total: 1200, sendPaymentOutcome: 240, sendPaymentOutcomeV2: 960 },
    cancelledByMod3Cancel: { total: 25, mod3Cancel: 5, mod3CancelV2: 20 },
    otherCancelled: { total: 10, byCause: [{ cause: 'closePayment-v2', count: 9 }, { cause: null, count: 1 }] },
    nonTerminal: { total: 10, byState: [{ state: 'PAYING', count: 10 }] },
    otherTerminal: { total: 5, byState: [{ state: 'FAILED', cause: 'nodoInviaRPT', count: 5 }] },
  },
  coverage: { status: 'UNKNOWN', reasons: ['NO_INGESTION_WATERMARK'], lastObservedEventAt: '2026-11-24T09:59:00.000Z' },
  freshness: { status: 'CURRENT', lagSeconds: 2, gapsDetected: false, observedAt: '2026-11-24T10:00:00.000Z',
    lastProcessedAt: '2026-11-24T10:00:00.000Z', lastPublishedAt: '2026-11-24T10:00:00.000Z' },
  generatedAt: '2026-11-24T10:00:05.000Z', ...extra,
});

registerLocaleData(localeIt);

describe('AnalyticsComponent', () => {
  const activationsOutcomes = vi.fn<(filters: Filters) => Observable<ActivationsOutcomes>>();
  const overview = vi.fn();
  const catalogWithServiceIdentifiers = vi.fn();
  const navigate = vi.fn();
  let params: BehaviorSubject<ParamMap>;

  const create = async (query: Record<string, string> = {}): Promise<ComponentFixture<AnalyticsComponent>> => {
    params = new BehaviorSubject(convertToParamMap(query));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AnalyticsComponent],
      providers: [
        { provide: ObservabilityApi, useValue: { activationsOutcomes, catalogWithServiceIdentifiers, overview } },
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: Router, useValue: { navigate } },
        { provide: TimezoneService, useValue: { zone: () => 'UTC' } },
        { provide: LOCALE_ID, useValue: 'it-IT' },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AnalyticsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  };
  const text = (fixture: ComponentFixture<AnalyticsComponent>): string =>
    (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
  const kpis = (fixture: ComponentFixture<AnalyticsComponent>): string[] =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('.kpi')]
      .map(kpi => [...kpi.querySelectorAll('h3, .v')].map(item => item.textContent?.trim()).join(' '));
  const stacks = (fixture: ComponentFixture<AnalyticsComponent>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('.kpi .version-breakdown')].map(stack => ({
      legend: [...stack.querySelectorAll('li')].map(item => item.textContent?.replace(/\s+/g, ' ').trim()),
      segments: [...stack.querySelectorAll('rect')].map(rect => [Number(rect.getAttribute('x')), Number(rect.getAttribute('width'))].map(n => Math.round(n * 100) / 100)),
      hidden: stack.querySelector('svg')?.getAttribute('aria-hidden'),
    }));
  const tokenSection = (fixture: ComponentFixture<AnalyticsComponent>): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('section[aria-labelledby="analytics-tokens"]');
  const tokenRows = (fixture: ComponentFixture<AnalyticsComponent>): string[][] =>
    [...(tokenSection(fixture)?.querySelectorAll('table tr') ?? [])]
      .map(row => [...row.querySelectorAll('th, td')].map(cell => {
        const copy = cell.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('[aria-hidden="true"]').forEach(item => item.remove());
        return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      }));
  const httpError = (status: number) => throwError(() => new HttpErrorResponse({ status }));

  beforeEach(() => {
    activationsOutcomes.mockReset();
    navigate.mockReset();
    catalogWithServiceIdentifiers.mockReset().mockReturnValue(of({ serviceIdentifiers: ['NDP001DEV'] }));
    overview.mockReset().mockReturnValue(of({ transitions: [
      { bucketStart: '2026-11-24T09:00:00Z', timestampBasis: 'SOURCE_EVENT', count: 10 },
      { bucketStart: '2026-11-24T09:00:00Z', timestampBasis: 'INFERRED', count: 3 },
    ], durations: [
      { entity: 'logical', fromState: 'PAYING', toState: 'PAID', timestampBasis: 'SOURCE_EVENT',
        samples: 10, averageMs: 41000, medianMs: 41000, p95Ms: 252000 },
    ] }));
  });

  it('shows transition trends and durations in Performance with the selected time window', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create({ window: 'custom', from: '2026-11-24T09:00:00.000Z', to: '2026-11-24T10:00:00.000Z', psp: 'PSP', canale: 'CANALE' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).not.toContain('Andamento dei passaggi di stato');
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain('Andamento dei passaggi di stato');
    expect(root.textContent).toContain('Durata mediana tra passaggi');
    expect(root.querySelector('#transition-durations')?.textContent).toContain('41 s');
    expect(root.querySelector('#transition-durations')?.textContent).toContain('4 min 12 s');
    expect(root.textContent).toContain('Da evento (sorgente)');
    expect(root.textContent).toContain('Inferito (ora stimata)');
    expect(root.querySelector('svg[aria-describedby="transition-chart-description"]')).not.toBeNull();
    expect(overview).toHaveBeenCalledWith({ from: '2026-11-24T09:00:00.000Z', to: '2026-11-24T10:00:00.000Z' });
    fixture.destroy();
  });

  it('shows trend errors with a retry, independently of the volumes data', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    overview.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    [...root.querySelectorAll<HTMLElement>('[role="tab"]')][1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('HTTP 503');
    root.querySelector<HTMLButtonElement>('[role="alert"] button')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).toContain('Andamento dei passaggi di stato');
    expect(activationsOutcomes).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('refreshes the trend when the selected time window changes', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    [...root.querySelectorAll<HTMLElement>('[role="tab"]')][1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    params.next(convertToParamMap({
      window: 'custom', from: '2026-11-24T08:00:00.000Z', to: '2026-11-24T09:00:00.000Z',
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(overview).toHaveBeenLastCalledWith({ from: '2026-11-24T08:00:00.000Z', to: '2026-11-24T09:00:00.000Z' });
    fixture.destroy();
  });

  it('switches between volumes, performance, and the work in progress panel', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map(tab => tab.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Volumi & Esiti', 'Performance & Latenze', 'Errori & Anomalie',
    ]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tokenSection(fixture)).not.toBeNull();
    for (const index of [1, 2]) {
      tabs[index].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(tabs[index].getAttribute('aria-selected')).toBe('true');
      const panel = root.querySelector(`[role="tabpanel"][id="${tabs[index].getAttribute('aria-controls')}"]`);
      expect(panel?.textContent).toContain(index === 1 ? 'Andamento dei passaggi di stato' : 'Work in progress');
      expect(root.querySelector('#analytics-tokens')).toBeNull();
    }
    tabs[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(tokenSection(fixture)).not.toBeNull();
    expect(activationsOutcomes).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('supports keyboard navigation and selection of the analytics tabs', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const tabs = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    const panel = (fixture.nativeElement as HTMLElement).querySelector(`[role="tabpanel"][id="${tabs[1].getAttribute('aria-controls')}"]`);
    expect(panel?.textContent).toContain('Andamento dei passaggi di stato');
    fixture.destroy();
  });

  it('keeps performance usable while volumes are loading', async () => {
    activationsOutcomes.mockReturnValue(new Subject<ActivationsOutcomes>());
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const panel = root.querySelector(`[role="tabpanel"][id="${tabs[1].getAttribute('aria-controls')}"]`);
    expect(panel?.textContent).toContain('Andamento dei passaggi di stato');
    expect(text(fixture)).not.toContain('Caricamento dei contatori');
    tabs[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(fixture)).toContain('Caricamento dei contatori');
    fixture.destroy();
  });

  it('shows a loading state, not zeros, until the counters arrive', async () => {
    const response = new Subject<ActivationsOutcomes>();
    activationsOutcomes.mockReturnValue(response);
    const fixture = await create();
    expect(text(fixture)).toContain('Caricamento dei contatori');
    expect(text(fixture)).not.toContain('Differenza');
    response.next(result());
    response.complete();
    fixture.detectChanges();
    expect(text(fixture)).not.toContain('Caricamento dei contatori');
    fixture.destroy();
  });

  it('places the dashboard-style window chip alongside the volume heading', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const globalStyle = document.createElement('style');
    globalStyle.textContent = '.chip { font-weight: 600; }';
    document.head.append(globalStyle);
    try {
      const fixture = await create();
      const heading = (fixture.nativeElement as HTMLElement).querySelector('#analytics-counters');
      const chip = (fixture.nativeElement as HTMLElement).querySelector('.window-badge.chip');
      const chipText = chip?.querySelector('span');
      expect(heading?.closest('.analytics-heading')).toBe(chip?.parentElement);
      expect(chip?.parentElement && getComputedStyle(chip.parentElement).width).toBe('100%');
      expect(chip && getComputedStyle(chip).marginLeft).toBe('auto');
      expect(chip?.parentElement && getComputedStyle(chip.parentElement).justifyContent).toBe('space-between');
      expect(chip?.parentElement && getComputedStyle(chip.parentElement).flexWrap).toBe('nowrap');
      expect(chipText && getComputedStyle(chipText).textOverflow).toBe('ellipsis');
      expect(chip?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Finestra dal 24 nov 2026, 09:00:00 al 24 nov 2026, 10:00:00 · calcolata alle 24 nov 2026, 10:00:05');
      expect(chip?.getAttribute('title')).toBe('Finestra dal 24 nov 2026, 09:00:00 al 24 nov 2026, 10:00:00 · calcolata alle 24 nov 2026, 10:00:05');
      expect(chip?.getAttribute('aria-label')).toBe(chip?.getAttribute('title'));
      expect(chip && getComputedStyle(chip).fontWeight).toBe('400');
      expect([...chip?.querySelectorAll('strong') ?? []].map(timestamp => getComputedStyle(timestamp).fontWeight))
        .toEqual(['700', '700', '700']);
      fixture.destroy();
    } finally {
      globalStyle.remove();
    }
  });

  it('renders each token category and its indented detail rows with visual markers and shares', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const groups = [...(tokenSection(fixture)?.querySelectorAll('tbody') ?? [])];
    expect(groups).toHaveLength(5);
    for (const group of groups) {
      expect(group.querySelector('.tokens-category .category-marker[aria-hidden="true"]')).not.toBeNull();
      expect(group.querySelector('.tokens-category .share-bar[aria-hidden="true"] rect')).not.toBeNull();
      for (const row of group.querySelectorAll('.tokens-detail')) {
        expect(row.querySelector('.detail-marker[aria-hidden="true"]')?.textContent?.trim()).toBe('↳');
        expect(row.querySelector('.detail-label')).not.toBeNull();
        expect(row.querySelector('td [aria-hidden="true"]')?.textContent?.trim()).toBe('—');
      }
    }
    const firstDetail = groups[0].querySelector('.tokens-detail');
    expect(firstDetail?.querySelector('code')?.textContent).toBe('sendPaymentOutcome');
    expect(firstDetail?.querySelectorAll('td')[1].textContent?.trim()).toBe('240');
    expect(firstDetail?.querySelectorAll('td')[2].textContent?.trim()).toBe('19,2 %');
    fixture.destroy();
  });

  it('presents the activation count and version breakdown in a responsive card', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const card = (fixture.nativeElement as HTMLElement).querySelector('.activation-card');
    expect(card?.querySelector('h3')?.textContent?.trim()).toBe('activatePaymentNotice positive');
    expect(card?.querySelector('.metric-tag')?.textContent?.trim()).toBe('paymentToken');
    expect(card?.querySelector('.v')?.textContent?.trim()).toBe('1.250');
    const legend = card?.querySelector('.version-legend');
    expect([...legend?.querySelectorAll('li') ?? []].map(row => ({
      name: row.querySelector('code')?.textContent,
      count: row.querySelector('b')?.textContent,
      swatch: row.querySelector('.swatch[aria-hidden="true"]') !== null,
    }))).toEqual([
      { name: 'activatePaymentNotice', count: '250', swatch: true },
      { name: 'activatePaymentNoticeV2', count: '1.000', swatch: true },
    ]);
    expect(legend?.textContent).toContain('20 %');
    expect(legend?.textContent).toContain('80 %');
    fixture.destroy();
  });

  it('uses the same card and legend structure for both primitive breakdowns', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    const cards = [...root.querySelectorAll('.analytics-kpis > .metric-card')];
    expect(cards.map(card => card.querySelector('h3')?.textContent?.trim())).toEqual([
      'activatePaymentNotice positive', 'sendPaymentOutcome', 'Differenza',
    ]);
    expect(cards.slice(0, 2).map(card =>
      [...card.querySelectorAll('.version-legend code')].map(code => code.textContent?.trim())
    )).toEqual([
      ['activatePaymentNotice', 'activatePaymentNoticeV2'],
      ['sendPaymentOutcome', 'sendPaymentOutcomeV2'],
    ]);
    fixture.destroy();
  });

  it('places each primitive and its numeric values in separate parts of the same legend row', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.version-legend li')];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const name = row.querySelector('.legend-name');
      const values = row.querySelector('.legend-value');
      expect(name?.parentElement).toBe(row);
      expect(values?.parentElement).toBe(row);
      expect(name?.querySelector('.swatch[aria-hidden="true"]')).not.toBeNull();
      expect(name?.querySelector('code')?.textContent).toBeTruthy();
      expect(values?.querySelector('b')?.textContent).toBeTruthy();
      expect(values?.textContent).toContain('%');
    }
    fixture.destroy();
  });

  it('renders both totals, small stacked V1/V2 bars with a legend under each total, the signed difference and the edge-of-window caveat', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const page = text(fixture);
    expect(kpis(fixture)).toEqual([
      'activatePaymentNotice positive 1.250',
      'sendPaymentOutcome 1.247',
      'Differenza −3',
    ]);
    expect(page).not.toMatch(/\bV1 \d/);
    const [activation, outcome] = stacks(fixture);
    expect(stacks(fixture)).toHaveLength(2);
    expect(page).toContain('Una richiesta sendPaymentOutcomeV2 può riguardare più token');
    expect(page).not.toContain('Provvisorio');
    expect(activation.legend).toEqual(['activatePaymentNotice 250 (20 %)', 'activatePaymentNoticeV2 1.000 (80 %)']);
    expect(outcome.legend).toEqual(['sendPaymentOutcome 247 (19,8 %)', 'sendPaymentOutcomeV2 1.000 (80,2 %)']);
    expect(activation.segments).toEqual([[0, 20], [20, 80]]);
    expect(outcome.segments).toEqual([[0, 19.81], [19.81, 80.19]]);
    expect(page).toContain('Token');
    expect(page).toContain('Richieste');
    expect(page).toContain('Saldo grezzo');
    expect([activation.hidden, outcome.hidden]).toEqual(['true', 'true']);
    // The global `.stack` class is an 8px clipped flex bar: nesting the legend in it hides it.
    expect((fixture.nativeElement as HTMLElement).querySelector('.stack-legend')?.closest('.stack')).toBeNull();
    expect(page).toContain('sendPaymentOutcome - activatePaymentNotice positive');
    expect(page).toContain('3 sendPaymentOutcome in meno rispetto alle activatePaymentNotice positive nella finestra.');
    expect(page).toContain('pagamenti a cavallo dei bordi del periodo');
    expect(page).not.toMatch(/anomalia rilevata/i);
    expect(page).toContain('CURRENT');
    fixture.destroy();
  });

  it('keeps request volumes and the per-token outcome in separate sections, with categories and details that add up', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const volumes = (fixture.nativeElement as HTMLElement).querySelector('section[aria-labelledby="analytics-counters"]');
    expect(volumes?.querySelector('h2')?.textContent?.trim()).toBe('activatePaymentNotice vs sendPaymentOutcome');
    expect(volumes?.querySelector('.analytics-kpis')?.textContent).not.toContain('mod3Cancel');
    const section = tokenSection(fixture) as HTMLElement;
    expect(section.querySelector('#analytics-tokens')?.textContent?.trim()).toBe('PaymentToken attivati nel periodo: esito osservato');
    expect(section.querySelector('.kpi')).toBeNull();
    expect(tokenRows(fixture)).toEqual([
      ['Categoria', 'Cosa significa', 'Token', 'Quota'],
      ['Esito sendPaymentOutcome accettato osservato', expect.stringContaining('sendPaymentOutcome accettata'), '1.200', '96 %'],
      ['sendPaymentOutcome', 'Dettaglio di Esito sendPaymentOutcome accettato osservato', '240', '19,2 %'],
      ['sendPaymentOutcomeV2', 'Dettaglio di Esito sendPaymentOutcome accettato osservato', '960', '76,8 %'],
      ['Annullati dal cron mod3Cancel', expect.stringContaining('anche dopo la fine del periodo'), '25', '2 %'],
      ['mod3Cancel', 'Dettaglio di Annullati dal cron mod3Cancel', '5', '0,4 %'],
      ['mod3CancelV2', 'Dettaglio di Annullati dal cron mod3Cancel', '20', '1,6 %'],
      ['Altri annullamenti', expect.stringContaining('diversa dal cron'), '10', '0,8 %'],
      ['closePayment-v2', 'Dettaglio di Altri annullamenti', '9', '0,7 %'],
      ['Causa non registrata', 'Dettaglio di Altri annullamenti', '1', '0,1 %'],
      ['Altri stati finali', expect.stringContaining('diverso da CANCELLED'), '5', '0,4 %'],
      ['FAILED · nodoInviaRPT', 'Dettaglio di Altri stati finali', '5', '0,4 %'],
      ['Stato finale non osservato', expect.stringContaining('non essere stati acquisiti'), '10', '0,8 %'],
      ['PAYING', 'Dettaglio di Stato finale non osservato', '10', '0,8 %'],
      ['Totale token attivati nel periodo', '1.250', '100 %'],
    ]);
    expect([...section.querySelectorAll('.tokens-category svg rect')]
      .map(rect => Number(rect.getAttribute('width')))).toEqual([96, 2, 0.8, 0.4, 0.8]);
    const sectionText = section.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(sectionText).toContain('1.250 paymentToken attivati nel periodo Copertura non verificabile');
    expect(sectionText).toContain('Gli stessi paymentToken conteggiati in «activatePaymentNotice positive»');
    expect(sectionText).toContain('Esito accettato non equivale a richiesta ricevuta');
    expect(sectionText).toContain('la differenza non misura token mancanti');
    expect(sectionText).toContain('i valori possono essere incompleti');
    expect(sectionText).not.toMatch(/In corso/);
    const limits = [...section.querySelectorAll('[aria-label="Limiti del conteggio"] li')].map(li => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(limits).toEqual([
      expect.stringContaining('la copertura dell’ingestione non è verificabile'),
      '⚠ Ultimo evento osservato: 24 nov 2026, 09:59:00. Non garantisce che gli eventi precedenti siano stati tutti acquisiti.',
    ]);
    fixture.destroy();
  });

  it('sends the rolling window as live with the dimension filters from the URL, without PA or state filters', async () => {
    activationsOutcomes.mockReturnValue(of(result({ live: true, window: { from: '2026-11-24T09:00:00.000Z', to: null } })));
    const fixture = await create({ window: '15m', psp: 'ABI00001', stazione: '~unknown', paFiscalCode: '00000000001', logicalState: 'PAID' });
    const filters = activationsOutcomes.mock.calls[0][0];
    expect(filters).toMatchObject({ live: 'true', psp: 'ABI00001', stazione: '~unknown', serviceIdentifier: '', canale: '' });
    expect(Date.parse(filters['to'] ?? '') - Date.parse(filters['from'] ?? '')).toBe(900_000);
    expect(Object.keys(filters)).not.toContain('paFiscalCode');
    expect(Object.keys(filters)).not.toContain('logicalState');
    expect(text(fixture)).toContain('a ora');
    expect((fixture.nativeElement as HTMLElement).querySelector('.window-badge')?.getAttribute('title'))
      .toContain('ad ora (aggiornata alla richiesta)');
    fixture.destroy();
  });

  it('writes a changed filter to the query params', async () => {
    activationsOutcomes.mockReturnValue(of(result()));
    const fixture = await create();
    const input = [...(fixture.nativeElement as HTMLElement).querySelectorAll('label')]
      .find(label => label.textContent?.includes('Canale'))?.querySelector('input');
    if (!input) throw new Error('missing Canale input');
    input.value = ' CHANNEL_A ';
    input.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { canale: 'CHANNEL_A' }, queryParamsHandling: 'merge' }));
    fixture.destroy();
  });

  it.each([
    [400, 'Filtri non supportati'],
    [403, 'visibilità ristretta a un ente creditore'],
    [0, 'Servizio non raggiungibile'],
    [500, 'HTTP 500'],
  ])('explains an HTTP %s failure without showing counters and retries on demand', async (status, message) => {
    activationsOutcomes.mockReturnValueOnce(httpError(status)).mockReturnValueOnce(of(result()));
    const fixture = await create();
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(message);
    expect(text(fixture)).not.toContain('Differenza');
    const retry = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(item => item.textContent?.includes('Riprova'));
    retry?.click();
    fixture.detectChanges();
    expect(activationsOutcomes).toHaveBeenCalledTimes(2);
    expect(kpis(fixture)[2]).toBe('Differenza −3');
    fixture.destroy();
  });

  it('shows the per-token outcome as unavailable, not zero, outside the projection retention', async () => {
    activationsOutcomes.mockReturnValue(of(result({ tokens: null,
      coverage: { status: 'UNAVAILABLE', reasons: ['RETENTION', 'FUTURE_REASON'], lastObservedEventAt: null } })));
    const fixture = await create();
    const section = tokenSection(fixture) as HTMLElement;
    expect(section.textContent?.replace(/\s+/g, ' ')).toContain('n.d. Dato non disponibile per questo periodo.');
    expect(section.querySelector('table')).toBeNull();
    expect(section.textContent).not.toContain('Copertura non verificabile');
    const limits = [...section.querySelectorAll('[aria-label="Limiti del conteggio"] li')].map(li => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(limits).toEqual([expect.stringContaining('precedente alla retention della proiezione'), '⚠ Limite segnalato: FUTURE_REASON.']);
    expect(stacks(fixture)).toHaveLength(2);
    fixture.destroy();
  });

  it('says when the window has no activity at all', async () => {
    activationsOutcomes.mockReturnValue(of(result({
      activatePaymentNoticeOk: { total: 0, activatePaymentNotice: 0, activatePaymentNoticeV2: 0 },
      sendPaymentOutcome: { total: 0, sendPaymentOutcome: 0, sendPaymentOutcomeV2: 0 }, difference: 0,
      tokens: { total: 0, acceptedOutcome: { total: 0, sendPaymentOutcome: 0, sendPaymentOutcomeV2: 0 },
        cancelledByMod3Cancel: { total: 0, mod3Cancel: 0, mod3CancelV2: 0 }, otherCancelled: { total: 0, byCause: [] },
        nonTerminal: { total: 0, byState: [] }, otherTerminal: { total: 0, byState: [] } },
    })));
    const fixture = await create();
    expect(text(fixture)).toContain('Nessuna activatePaymentNotice positiva né sendPaymentOutcome');
    expect(stacks(fixture).map(stack => stack.segments.flat())).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(stacks(fixture).map(stack => stack.legend)).toEqual([
      ['activatePaymentNotice 0 (—)', 'activatePaymentNoticeV2 0 (—)'],
      ['sendPaymentOutcome 0 (—)', 'sendPaymentOutcomeV2 0 (—)'],
    ]);
    expect(tokenRows(fixture).map(row => row.slice(-2))).toEqual([['Token', 'Quota'], ['0', '—'], ['0', '—'], ['0', '—'],
      ['0', '—'], ['0', '—'], ['0', '—'], ['0', '—'], ['0', '—'], ['0', '—'], ['0', '—']]);
    expect(kpis(fixture)[2]).toBe('Differenza 0');
    expect(text(fixture)).toContain('Stesso numero di sendPaymentOutcome e activatePaymentNotice positive');
    fixture.destroy();
  });

  it('shows a surplus of outcomes with a plus sign and thousands separators', async () => {
    activationsOutcomes.mockReturnValue(of(result({
      activatePaymentNoticeOk: { total: 10, activatePaymentNotice: 0, activatePaymentNoticeV2: 10 },
      sendPaymentOutcome: { total: 1210, sendPaymentOutcome: 0, sendPaymentOutcomeV2: 1210 }, difference: 1200,
    })));
    const fixture = await create();
    expect(kpis(fixture)[2]).toBe('Differenza +1.200');
    expect(text(fixture)).toContain('1.200 sendPaymentOutcome in più rispetto alle activatePaymentNotice positive');
    expect(stacks(fixture).map(stack => stack.legend)).toEqual([
      ['activatePaymentNotice 0 (0 %)', 'activatePaymentNoticeV2 10 (100 %)'],
      ['sendPaymentOutcome 0 (0 %)', 'sendPaymentOutcomeV2 1.210 (100 %)'],
    ]);
    fixture.destroy();
  });

  it('does not call the API for an invalid custom window', async () => {
    const fixture = await create({ window: 'custom', from: 'x', to: 'y' });
    expect(activationsOutcomes).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Inserisci entrambe le date');
    fixture.destroy();
  });
});
