import { TestBed } from '@angular/core/testing';
import { InfoTipComponent } from './info-tip.component';

describe('InfoTipComponent', () => {
  const create = () => {
    const fixture = TestBed.createComponent(InfoTipComponent);
    fixture.componentRef.setInput('label', 'Che cos’è?');
    fixture.componentRef.setInput('text', 'Spiegazione.');
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const button = host.querySelector('button');
    const tip = host.querySelector('[role="tooltip"]');
    if (!button || !tip) throw new Error('info tip not rendered');
    return { fixture, host, button, tip };
  };

  it('describes the button with the tooltip text', () => {
    const { button, tip } = create();

    expect(button.getAttribute('aria-label')).toBe('Che cos’è?');
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);
    expect(tip.textContent?.trim()).toBe('Spiegazione.');
  });

  it('opens on keyboard focus or click and closes with Escape or when focus leaves', () => {
    const { fixture, button, tip } = create();

    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(tip.classList).toContain('open');

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(tip.classList).not.toContain('open');

    button.click();
    fixture.detectChanges();
    expect(tip.classList).toContain('open');
    button.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    fixture.detectChanges();
    expect(tip.classList).not.toContain('open');
  });

  it('opens on hover', () => {
    const { fixture, host, tip } = create();

    host.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(tip.classList).toContain('open');
    host.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(tip.classList).not.toContain('open');
  });
});
