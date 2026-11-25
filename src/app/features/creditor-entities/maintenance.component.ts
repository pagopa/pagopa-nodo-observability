import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { formatInstant } from '../../models/domain';
import { formatMaintenanceDuration, Maintenance, maintenanceStatusOf, MaintenanceStatus, Maintenances } from '../../models/maintenance';

/** Scheduled station maintenances of the next 7 days, as cached daily by the backend. */
@Component({
  selector: 'app-maintenance',
  templateUrl: './maintenance.component.html',
  styleUrl: './maintenance.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaintenanceComponent implements OnInit {
  private readonly api = inject(ObservabilityApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly timezone = inject(TimezoneService);

  readonly data = signal<Maintenances | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly format = (value: string): string => formatInstant(value, this.timezone.zone());
  readonly duration = formatMaintenanceDuration;
  readonly visibleCreditors = 3;
  readonly statusLabels: Record<MaintenanceStatus, string> = {
    ongoing: 'In corso',
    upcoming: 'Programmata',
    past: 'Conclusa',
  };
  private readonly now = signal(Date.now());

  readonly status = (item: Maintenance): MaintenanceStatus => maintenanceStatusOf(item, this.now());

  /** `5 nov 2026, 20:15 – 22:00` on the same day, both full dates otherwise (in the selected zone). */
  readonly period = (item: Maintenance): string => {
    const zone = this.timezone.zone();
    const day = (value: string): string =>
      new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeZone: zone }).format(new Date(value));
    const time = (value: string): string =>
      new Intl.DateTimeFormat('it-IT', { timeStyle: 'short', timeZone: zone }).format(new Date(value));
    return day(item.startDateTime) === day(item.endDateTime)
      ? `${day(item.startDateTime)}, ${time(item.startDateTime)} – ${time(item.endDateTime)}`
      : `${day(item.startDateTime)}, ${time(item.startDateTime)} → ${day(item.endDateTime)}, ${time(item.endDateTime)}`;
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.now.set(Date.now());
    this.api.maintenances().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (failure: unknown) => {
        const unreachable = typeof failure === 'object' && failure !== null && 'status' in failure && failure.status === 0;
        this.error.set(unreachable
          ? 'Servizio non raggiungibile. Verifica che il backend sia attivo e riprova.'
          : 'Impossibile recuperare le manutenzioni programmate.');
        this.loading.set(false);
      },
    });
  }
}
