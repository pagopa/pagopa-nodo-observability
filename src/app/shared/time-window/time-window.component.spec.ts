import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { TimeWindowComponent } from './time-window.component';

describe('TimeWindowComponent', () => {
  const setup = async (selection = { range: '1h', from: '', to: '' }) => {
    await TestBed.configureTestingModule({
      imports: [TimeWindowComponent],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: {} }],
    }).compileComponents();
    const fixture = TestBed.createComponent(TimeWindowComponent);
    fixture.componentRef.setInput('selection', selection);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const select = element.querySelector('select') as HTMLSelectElement;
    const choose = async (value: string) => {
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const fill = async (name: string, value: string) => {
      const input = [...element.querySelectorAll('input')].find(
        (item) => item.getAttribute('aria-label') === name,
      );
      if (!input) throw new Error(`Missing input ${name}`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    return { fixture, element, select, choose, fill, navigate };
  };

  it('offers minute presets alongside all existing intervals and custom mode', async () => {
    const { select, choose, navigate } = await setup();
    expect([...select.options].map((option) => option.value)).toEqual([
      '5m',
      '15m',
      '30m',
      '1h',
      '24h',
      '7d',
      '60d',
      'custom',
    ]);
    await choose('15m');
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { window: '15m', from: null, to: null },
        queryParamsHandling: 'merge',
      }),
    );
  });

  it('shows the active interval as selected even when it is not the first option', async () => {
    for (const range of ['60d', '24h', '15m']) {
      const { select, fixture } = await setup({ range, from: '', to: '' });
      expect(select.value).toBe(range);
      fixture.destroy();
      TestBed.resetTestingModule();
    }
    const { select } = await setup({
      range: 'custom', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z',
    });
    expect(select.value).toBe('custom');
  });

  it('keeps draft bounds out of the URL until Apply and converts explicit UTC fields', async () => {
    const { choose, fill, navigate, element } = await setup();
    await choose('custom');
    await fill('Da (UTC)', '2026-10-20T12:00');
    await fill('A (UTC)', '2026-10-20T12:30');
    expect(navigate).not.toHaveBeenCalled();
    element.querySelector('button')?.click();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: {
          window: 'custom',
          from: '2026-10-20T12:00:00.000Z',
          to: '2026-10-20T12:30:00.000Z',
        },
        queryParamsHandling: 'merge',
      }),
    );
  });

  it('shows an accessible error and prevents applying reversed dates', async () => {
    const { choose, fill, navigate, element, fixture } = await setup();
    await choose('custom');
    await fill('Da (UTC)', '2026-10-20T13:00');
    await fill('A (UTC)', '2026-10-20T12:30');
    element.querySelector('button')?.click();
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('precedere');
  });

  it('restores custom bounds from the URL and updates when navigation changes', async () => {
    const { fixture, element, select } = await setup({
      range: 'custom',
      from: '2026-10-20T12:00:00.000Z',
      to: '2026-10-20T12:30:00.000Z',
    });
    expect(select.value).toBe('custom');
    expect(element.querySelector('input')?.value).toContain('2026-10-20T12:00');
    fixture.componentRef.setInput('selection', { range: '5m', from: '', to: '' });
    await fixture.whenStable();
    expect(select.value).toBe('5m');
    expect(element.querySelector('input')).toBeNull();
  });

  it('can cancel a custom draft by choosing the already active preset', async () => {
    const { choose, element, select } = await setup();
    await choose('custom');
    expect(element.querySelector('input')).not.toBeNull();
    await choose('1h');
    expect(select.value).toBe('1h');
    expect(element.querySelector('input')).toBeNull();
  });

  it('does not silently normalize an impossible date restored from the URL', async () => {
    const { element } = await setup({
      range: 'custom',
      from: '2026-02-30T12:00:00.000Z',
      to: '2026-03-02T13:00:00.000Z',
    });
    expect(element.querySelector('button')?.disabled).toBe(true);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('valide');
  });
});
