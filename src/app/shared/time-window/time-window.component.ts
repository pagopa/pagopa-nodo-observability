import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PRESET_WINDOWS, resolveTimeWindow, TimeWindowSelection } from '../../models/time-window';

@Component({
  selector: 'app-time-window',
  styleUrl: './time-window.component.scss',
  templateUrl: './time-window.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimeWindowComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly selection = input.required<TimeWindowSelection>();
  readonly presets = PRESET_WINDOWS;
  readonly draftRange = linkedSignal(() => this.selection().range);
  readonly draftFrom = linkedSignal(() => this.selection().from.replace(/Z$/, ''));
  readonly draftTo = linkedSignal(() => this.selection().to.replace(/Z$/, ''));
  readonly validation = computed(() =>
    resolveTimeWindow({
      range: 'custom',
      from: this.utcInstant(this.draftFrom()),
      to: this.utcInstant(this.draftTo()),
    }),
  );

  choose(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.value === 'custom') {
      const current = resolveTimeWindow(this.selection());
      if (current.bounds) {
        this.draftFrom.set(current.bounds.from.slice(0, -1));
        this.draftTo.set(current.bounds.to.slice(0, -1));
      }
      this.draftRange.set('custom');
      return;
    }
    const preset = this.presets.find((preset) => preset.value === target.value);
    if (preset) {
      this.draftRange.set(preset.value);
      this.navigate({ window: preset.value, from: null, to: null });
    }
  }

  edit(field: 'from' | 'to', event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    (field === 'from' ? this.draftFrom : this.draftTo).set(target.value);
  }

  apply(): void {
    const { bounds } = this.validation();
    if (bounds) this.navigate({ window: 'custom', ...bounds });
  }

  private navigate(queryParams: Record<string, string | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private utcInstant(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value)) return '';
    const canonical =
      value.length === 16
        ? `${value}:00.000Z`
        : value.length === 19
          ? `${value}.000Z`
          : `${value.padEnd(23, '0')}Z`;
    const date = new Date(canonical);
    return Number.isFinite(date.getTime()) && date.toISOString() === canonical ? canonical : '';
  }
}
