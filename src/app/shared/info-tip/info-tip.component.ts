import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

let nextId = 0;

/**
 * Info button with a short explanation, shown on hover, keyboard focus or click and dismissed with Escape
 * (WCAG 1.4.13). The text is linked to the button through `aria-describedby`, so screen readers read it too.
 */
@Component({
  selector: 'app-info-tip',
  templateUrl: './info-tip.component.html',
  styleUrl: './info-tip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusin)': 'show()',
    '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class InfoTipComponent {
  /** Accessible name of the button, e.g. the question the text answers. */
  readonly label = input.required<string>();
  readonly text = input.required<string>();
  readonly tooltipId = `info-tip-${nextId++}`;
  readonly open = signal(false);

  show(): void {
    this.open.set(true);
  }

  hide(): void {
    this.open.set(false);
  }
}
