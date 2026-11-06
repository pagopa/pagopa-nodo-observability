import { TestBed } from '@angular/core/testing';
import { PieChartComponent, PieSlice } from './pie-chart.component';

describe('PieChartComponent', () => {
  const render = (slices: readonly PieSlice[]) => {
    const fixture = TestBed.createComponent(PieChartComponent);
    fixture.componentRef.setInput('slices', slices);
    fixture.componentRef.setInput('chartLabel', 'Distribuzione di prova');
    fixture.detectChanges();
    return fixture;
  };

  it('draws one slice per non-zero state with a legend showing counts and shares', () => {
    const fixture = render([
      { key: 'PAID', label: 'PAID', count: 3 },
      { key: 'PAYING', label: 'PAYING', count: 1 },
      { key: 'FAILED', label: 'FAILED', count: 0 },
    ]);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('Distribuzione di prova');
    expect(root.querySelectorAll('svg path')).toHaveLength(2);
    const cells = (selector: string) =>
      [...root.querySelectorAll(`li ${selector}`)].map((cell) => cell.textContent?.trim());
    expect(cells('.name')).toEqual(['PAID', 'PAYING']);
    expect(cells('b')).toEqual(['3', '1']);
    expect(cells('.pct')).toEqual(['75%', '25%']);
    fixture.destroy();
  });

  it('draws a full circle for a single state and labels flagged slices in text', () => {
    const fixture = render([
      { key: 'PAYMENT_UNKNOWN', label: 'PAYMENT_UNKNOWN', count: 5, flag: 'non risolto' },
    ]);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('svg circle')).toHaveLength(1);
    expect(root.querySelector('li')?.textContent).toContain('non risolto');
    fixture.destroy();
  });

  it('shows an empty message when there is nothing to represent', () => {
    const fixture = render([{ key: 'PAID', label: 'PAID', count: 0 }]);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('svg')).toBeNull();
    expect(root.textContent).toContain('Nessun dato');
    fixture.destroy();
  });
});
