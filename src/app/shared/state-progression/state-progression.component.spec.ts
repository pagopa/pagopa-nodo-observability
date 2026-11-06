import { TestBed } from '@angular/core/testing';
import { buildStateProgression } from '../../models/state-progression';
import { StateProgressionComponent } from './state-progression.component';

describe('StateProgressionComponent', () => {
  it('renders repeated visits and separates observed history from an expandable possible schema', () => {
    const fixture = TestBed.createComponent(StateProgressionComponent);
    fixture.componentRef.setInput(
      'progression',
      buildStateProgression(
        'recipient',
        'NOTICE_SENT',
        [
          { state: 'NOTICE_SENT', transitionAt: null, timestampBasis: 'SOURCE_EVENT' },
          { state: 'NOTICE_PENDING', transitionAt: null, timestampBasis: 'INFERRED' },
          {
            state: 'NOTICE_SENT',
            transitionAt: null,
            timestampBasis: 'SOURCE_EVENT',
            trigger: 'retry',
          },
        ],
        'UTC',
      ),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const observed = root.querySelector('ol');
    expect(observed?.children).toHaveLength(3);
    expect(root.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(root.textContent).toContain('Inferito');
    expect(root.textContent).toContain('Trigger non disponibile');
    expect(root.querySelector('details.schema')?.hasAttribute('open')).toBe(false);
    expect(root.textContent).toContain('Percorsi possibili, non eventi osservati');
    expect(root.textContent).toContain('NOTICE_PENDING → NOTICE_SENT');
    fixture.destroy();
  });
});
