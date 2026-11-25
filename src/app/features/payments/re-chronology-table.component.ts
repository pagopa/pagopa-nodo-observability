import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TimezoneService } from '../../core/timezone.service';
import { ChronologyRow, formatEventTime } from '../../models/re-chronology';
import { ReEvent } from '../../models/re-event';

@Component({
  selector: 'app-re-chronology-table',
  templateUrl: './re-chronology-table.component.html',
  styleUrl: './re-chronology-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReChronologyTableComponent {
  readonly rows = input.required<readonly ChronologyRow[]>();
  readonly caption = input.required<string>();
  /** Position consultation: events of several tokens, plus calls without any token. */
  readonly showToken = input(false);
  private readonly timezone = inject(TimezoneService);
  readonly columns = computed(() => (this.showToken() ? 6 : 5));

  displayTime(event: ReEvent): string {
    return formatEventTime(event, this.timezone.zone());
  }
}
