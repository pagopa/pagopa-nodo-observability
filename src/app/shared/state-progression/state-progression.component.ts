import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { StateProgression } from '../../models/state-progression';
import { StateBadgeComponent } from '../state-badge/state-badge.component';

@Component({
  selector: 'app-state-progression',
  imports: [StateBadgeComponent],
  templateUrl: './state-progression.component.html',
  styleUrl: './state-progression.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StateProgressionComponent {
  readonly progression = input.required<StateProgression>();
}
