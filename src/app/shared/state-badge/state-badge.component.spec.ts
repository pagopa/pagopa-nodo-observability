import { TestBed } from '@angular/core/testing';
import { StateBadgeComponent } from './state-badge.component';
import { statePresentation } from '../../models/state-presentation';

describe('StateBadgeComponent', () => {
  it('shows original code and a native keyboard-accessible description', () => {
    const fixture = TestBed.createComponent(StateBadgeComponent);
    fixture.componentRef.setInput('presentation', statePresentation('attempt', 'PAYMENT_ACCEPTED'));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('summary')?.textContent).toContain('PAYMENT_ACCEPTED');
    expect(root.querySelector('details')?.textContent).toContain(
      'in attesa dell’esito del pagamento',
    );
    expect(root.querySelector('summary')?.getAttribute('title')).toBeNull();
    fixture.destroy();
  });
});
