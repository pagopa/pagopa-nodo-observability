import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, signal } from '@angular/core';
import { MatTabLink, MatTabNav, MatTabNavPanel } from '@angular/material/tabs';
import { Overview } from '../../models/domain';
import { statePresentation } from '../../models/state-presentation';
import { StateBadgeComponent } from '../../shared/state-badge/state-badge.component';

@Component({
  selector: 'app-transition-durations',
  imports: [MatTabNav, MatTabLink, MatTabNavPanel, StateBadgeComponent],
  templateUrl: './transition-durations.component.html',
  styleUrl: './transition-durations.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransitionDurationsComponent {
  readonly durations = input.required<Overview['durations']>();
  readonly presentation = statePresentation;
  readonly durationEntity = signal<'logical' | 'attempt' | 'recipient'>('logical');
  readonly sourceDurations = computed(() =>
    this.durations().filter(row =>
      row.timestampBasis === 'SOURCE_EVENT' && row.entity === this.durationEntity())
      .sort((a, b) => b.p95Ms - a.p95Ms));
  readonly showAllDurations = linkedSignal({
    source: this.durationEntity,
    computation: () => false,
  });
  readonly visibleDurations = computed(() =>
    this.showAllDurations() ? this.sourceDurations() : this.sourceDurations().slice(0, 10));

  formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) {
      return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(milliseconds / 1000)} s`;
    }
    const seconds = Math.round(milliseconds / 100) / 10;
    const number = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
    if (seconds < 60) return `${number.format(seconds)} s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round((seconds - minutes * 60) * 10) / 10;
    return `${number.format(minutes)} min${remainder ? ` ${number.format(remainder)} s` : ''}`;
  }
}
