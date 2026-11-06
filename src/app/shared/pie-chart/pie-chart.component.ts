import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

export interface PieSlice {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** Text marker (besides colour) for slices that need attention, e.g. unresolved states. */
  readonly flag?: string;
}

interface PieSegment {
  readonly slice: PieSlice;
  readonly colorClass: string;
  readonly percent: number;
  /** SVG path, or null when the slice covers the whole circle. */
  readonly path: string | null;
}

const PALETTE_SIZE = 10;
const RADIUS = 50;

function point(angle: number): string {
  return `${(RADIUS + RADIUS * Math.cos(angle)).toFixed(3)} ${(RADIUS + RADIUS * Math.sin(angle)).toFixed(3)}`;
}

@Component({
  selector: 'app-pie-chart',
  imports: [DecimalPipe],
  templateUrl: './pie-chart.component.html',
  styleUrl: './pie-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PieChartComponent {
  readonly slices = input.required<readonly PieSlice[]>();
  readonly chartLabel = input.required<string>();

  readonly total = computed(() => this.slices().reduce((sum, slice) => sum + slice.count, 0));

  /** Zero-count slices are left out of the pie and the legend; the lists below keep every state. */
  readonly segments = computed<readonly PieSegment[]>(() => {
    const total = this.total();
    if (total <= 0) return [];
    let start = -Math.PI / 2;
    return this.slices()
      .filter((slice) => slice.count > 0)
      .map((slice, index) => {
        const fraction = slice.count / total;
        const end = start + fraction * 2 * Math.PI;
        const path =
          fraction >= 1
            ? null
            : `M ${RADIUS} ${RADIUS} L ${point(start)} A ${RADIUS} ${RADIUS} 0 ${fraction > 0.5 ? 1 : 0} 1 ${point(end)} Z`;
        start = end;
        return { slice, colorClass: `c${index % PALETTE_SIZE}`, percent: fraction * 100, path };
      });
  });
}
