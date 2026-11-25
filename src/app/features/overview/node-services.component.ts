import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { formatInstant } from '../../models/domain';
import { cacheAlignment, cacheTimestampInstant, isDbUp, isOutcomeOk, NodeServicesCheck } from '../../models/node-service';

/**
 * Nodo microservices with their version, cache id and database status, plus the Api Config cache that is
 * the source of truth of the configuration, read when the overview opens
 * and again on demand. A failed sync keeps the last successful check on screen.
 */
@Component({
  selector: 'app-node-services',
  templateUrl: './node-services.component.html',
  styleUrl: './node-services.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeServicesComponent implements OnInit {
  private readonly api = inject(ObservabilityApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly timezone = inject(TimezoneService);

  readonly check = signal<NodeServicesCheck | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly dbUp = isDbUp;
  readonly outcomeOk = isOutcomeOk;
  readonly aligned = cacheAlignment;
  readonly format = (value: string): string => formatInstant(value, this.timezone.zone());
  /** Cache timestamp in the selected zone, or its raw value when it cannot be parsed. */
  readonly formatCacheTimestamp = (value: string): string => {
    const instant = cacheTimestampInstant(value);
    return instant ? this.format(instant) : value;
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.nodeServices().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: check => {
        this.check.set(check);
        this.loading.set(false);
      },
      error: (failure: unknown) => {
        const unreachable = typeof failure === 'object' && failure !== null && 'status' in failure && failure.status === 0;
        this.error.set(unreachable
          ? 'Servizio di monitoraggio del Nodo non raggiungibile.'
          : 'Impossibile recuperare lo stato delle istanze del Nodo.');
        this.loading.set(false);
      },
    });
  }
}
