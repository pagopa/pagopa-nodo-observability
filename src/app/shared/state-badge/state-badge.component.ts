import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { StatePresentation } from '../../models/state-presentation';

@Component({
  selector: 'app-state-badge',
  templateUrl: './state-badge.component.html',
  styleUrl: './state-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StateBadgeComponent {
  readonly presentation = input.required<StatePresentation>();
}
