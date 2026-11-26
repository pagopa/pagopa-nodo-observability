import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TimezoneService } from '../../core/timezone.service';
import { TransitionTrendComponent } from './transition-trend.component';

describe('TransitionTrendComponent', () => {
  const zone = signal('Europe/Rome');
  const transition = (bucketStart: string, count: number, timestampBasis = 'SOURCE_EVENT') =>
    ({ bucketStart, count, timestampBasis, entity: 'attempt', state: 'PAYING' });
  const snapshot = () => ({ transitions: [] as ReturnType<typeof transition>[] });
  const createFixture = async (data: ReturnType<typeof snapshot>) => {
    zone.set('Europe/Rome');
    await TestBed.configureTestingModule({
      imports: [TransitionTrendComponent],
      providers: [{ provide: TimezoneService, useValue: { zone } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(TransitionTrendComponent);
    fixture.componentRef.setInput('transitions', data.transitions);
    await fixture.whenStable();
    return fixture;
  };
  const section = (fixture: ComponentFixture<TransitionTrendComponent>): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector('section')!;

  it.each([0, 1])('explains transition timestamps and provenance with %i chart buckets', async count => {
    const data = snapshot();
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
    const data = snapshot();
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

  it('reformats the time axis when the selected timezone changes', async () => {
    const data = snapshot();
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
    const data = snapshot();
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
    const data = snapshot();
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
    const data = snapshot();
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
    const data = snapshot();
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
    const data = snapshot();
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
    const data = snapshot();
    data.transitions = [transition('2026-10-16T09:00:00Z', 0)];
    const fixture = await createFixture(data);
    expect(section(fixture).querySelector('svg')).not.toBeNull();
    expect(section(fixture).innerHTML).not.toMatch(/NaN|Infinity/);
    fixture.componentRef.setInput('transitions', []);
    await fixture.whenStable();
    expect(section(fixture).querySelector('svg')).toBeNull();
    expect(section(fixture).textContent).toContain('Nessun passaggio di stato registrato');
    fixture.destroy();
  });

});
