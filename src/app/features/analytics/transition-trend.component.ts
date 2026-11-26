import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TimezoneService } from '../../core/timezone.service';
import { formatInstant, Overview } from '../../models/domain';

@Component({
  selector: 'app-transition-trend',
  imports: [DecimalPipe],
  templateUrl: './transition-trend.component.html',
  styleUrl: './transition-trend.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransitionTrendComponent {
  readonly transitions = input.required<Overview['transitions']>();
  readonly timezone = inject(TimezoneService);
  readonly transitionTrend = computed(() => {
    const buckets = new Map<number, { source: number; inferred: number }>();
    for (const row of this.transitions()) {
      if (row.timestampBasis !== 'SOURCE_EVENT' && row.timestampBasis !== 'INFERRED') continue;
      const instant = Date.parse(row.bucketStart);
      const bucket = buckets.get(instant) ?? { source: 0, inferred: 0 };
      if (row.timestampBasis === 'SOURCE_EVENT') bucket.source += row.count;
      else bucket.inferred += row.count;
      buckets.set(instant, bucket);
    }
    const rows = [...buckets].sort(([a], [b]) => a - b);
    const peak = Math.max(1, ...rows.map(([, row]) => row.source + row.inferred));
    const magnitude = 10 ** Math.floor(Math.log10(peak));
    const maximum = Math.ceil(peak / magnitude) * magnitude;
    const slotWidth = 844 / Math.max(1, rows.length);
    const daily = rows.length > 1 && rows.every(([instant], index) =>
      index === 0 || instant - rows[index - 1][0] >= 86_400_000);
    const timeZone = this.timezone.zone();
    const dayFormat = new Intl.DateTimeFormat('it-IT', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const spansDays = new Set(rows.map(([instant]) => dayFormat.format(instant))).size > 1;
    const axisOptions: Intl.DateTimeFormatOptions = {
      timeZone,
      ...(daily || spansDays ? { day: '2-digit', month: '2-digit' } : {}),
      ...(!daily ? { hour: '2-digit', minute: '2-digit' } : {}),
      ...(!daily && rows.some(([instant]) => instant % 60_000 !== 0) ? { second: '2-digit' } : {}),
    };
    let axisFormat = new Intl.DateTimeFormat('it-IT', axisOptions);
    const labels = rows.map(([instant]) => axisFormat.format(instant));
    if (new Set(labels).size < labels.length) {
      axisFormat = new Intl.DateTimeFormat('it-IT', { ...axisOptions, timeZoneName: 'shortOffset' });
    }
    const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
    return {
      ticks: [0, 0.5, 1].map(fraction => ({ value: maximum * fraction, y: 184 - 174 * fraction })),
      bars: rows.map(([instant, row], index) => ({
        instant,
        ...row,
        x: 48 + slotWidth * (index + 0.14),
        width: slotWidth * 0.72,
        sourceHeight: row.source / maximum * 174,
        inferredHeight: row.inferred / maximum * 174,
        sourceY: 184 - row.source / maximum * 174,
        inferredY: 184 - (row.source + row.inferred) / maximum * 174,
        labelX: 48 + slotWidth * (index + 0.5),
        label: index % labelEvery === 0 ? axisFormat.format(instant) : '',
        title: formatInstant(new Date(instant).toISOString(), timeZone),
      })),
    };
  });
}
