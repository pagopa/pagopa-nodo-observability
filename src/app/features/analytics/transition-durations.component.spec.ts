import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ATTEMPT_STATES, Overview } from '../../models/domain';
import { TransitionDurationsComponent } from './transition-durations.component';

describe('TransitionDurationsComponent', () => {
  const snapshot = () => ({ durations: [] as Overview['durations'] });
  const section = (fixture: ComponentFixture<TransitionDurationsComponent>): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector('section')!;
  const createFixture = async (data: ReturnType<typeof snapshot>, entity: 'logical' | 'attempt' = 'logical') => {
    await TestBed.configureTestingModule({ imports: [TransitionDurationsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(TransitionDurationsComponent);
    fixture.componentRef.setInput('durations', data.durations);
    await fixture.whenStable();
    if (entity === 'attempt') await selectDurationTab(fixture, 'Tentativi');
    return fixture;
  };
  const durationTab = (fixture: ComponentFixture<TransitionDurationsComponent>, label: string): HTMLElement => {
    const tab = [...section(fixture).querySelectorAll<HTMLElement>('[role="tab"]')]
      .find(item => item.textContent?.trim() === label);
    if (!tab) throw new Error(`Duration tab ${label} not found`);
    return tab;
  };
  const selectDurationTab = async (fixture: ComponentFixture<TransitionDurationsComponent>, label: string) => {
    durationTab(fixture, label).click();
    await fixture.whenStable();
  };

  it('shows only source-event durations with original states and readable units in three columns', async () => {
    const data = snapshot();
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
    fixture.componentRef.setInput('durations', data.durations.filter(row => row.timestampBasis === 'INFERRED'));
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
  const durationToggle = (fixture: ComponentFixture<TransitionDurationsComponent>) =>
    [...section(fixture).querySelectorAll('button')]
      .find(button => button.textContent?.trim() === 'Mostra tutto'
        || button.textContent?.trim() === 'Mostra solo i primi 10');
  const durationStates = (fixture: ComponentFixture<TransitionDurationsComponent>) =>
    [...section(fixture).querySelectorAll('tbody tr')].map(row => row.querySelector('.duration-code')?.textContent?.trim());

  it('shows the ten highest p95 durations and expands and collapses all rows without mutating the snapshot', async () => {
    const data = snapshot();
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
    const data = snapshot();
    data.durations = [
      ...durationRows().slice(0, count),
      { ...durationRows()[11], timestampBasis: 'INFERRED', p95Ms: 999999 },
    ];
    const fixture = await createFixture(data, 'attempt');
    expect(durationStates(fixture)).toHaveLength(count);
    expect(durationToggle(fixture)).toBeUndefined();
    fixture.destroy();
  });

  it('reorders durations on snapshot updates while keeping the expanded state', async () => {
    const data = snapshot();
    data.durations = durationRows();
    const fixture = await createFixture(data, 'attempt');
    const updatedRows = data.durations.map((row, index) => index === 0 ? { ...row, p95Ms: 999999 } : row);
    const update = (rows: Overview['durations']) => {
      fixture.componentRef.setInput('durations', rows);
    };
    update(updatedRows);
    await fixture.whenStable();
    expect(durationStates(fixture)).toHaveLength(10);
    expect(durationStates(fixture)[0]).toBe(`PAYING → ${updatedRows[0].toState}`);

    durationToggle(fixture)?.click();
    await fixture.whenStable();
    update(data.durations);
    await fixture.whenStable();
    expect(durationStates(fixture)).toHaveLength(12);
    expect(durationStates(fixture)[0]).toBe(`PAYING → ${data.durations[11].toState}`);
    expect(durationToggle(fixture)?.getAttribute('aria-expanded')).toBe('true');
    fixture.destroy();
  });

  it('defaults to logical payments and separates identically named transitions', async () => {
    const data = snapshot();
    data.durations = [
      { ...durationRows()[0], entity: 'logical', toState: 'PAID', medianMs: 1000, p95Ms: 2000 },
      { ...durationRows()[0], entity: 'attempt', toState: 'PAID', medianMs: 3000, p95Ms: 4000 },
    ];
    const fixture = await createFixture(data);
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
    const panel = section(fixture).querySelector('[role="tabpanel"]');
    expect(durationTab(fixture, 'Tentativi').getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(durationTab(fixture, 'Tentativi').id);
    fixture.destroy();
  });

  it('limits the selected entity independently and resets expansion on each tab switch', async () => {
    const data = snapshot();
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
    const data = snapshot();
    data.durations = durationRows();
    const fixture = await createFixture(data);
    expect(section(fixture).querySelector('table')).toBeNull();
    expect(section(fixture).textContent).toContain('Nessuna durata calcolabile per i pagamenti logici');
    await selectDurationTab(fixture, 'Tentativi');
    expect(durationStates(fixture)).toHaveLength(10);
    fixture.componentRef.setInput('durations', []);
    await fixture.whenStable();
    expect(section(fixture).textContent).toContain('Nessuna durata calcolabile per i tentativi');
    expect(durationToggle(fixture)).toBeUndefined();
    fixture.destroy();
  });

  it('supports keyboard focus between the duration tabs', async () => {
    const fixture = await createFixture(snapshot());
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
    const fixture = await createFixture(snapshot());
    expect(fixture.componentInstance.formatDuration(milliseconds)).toBe(expected);
    fixture.destroy();
  });
});

