import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Filters, ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { formatInstant, PRIMITIVE_RESPONSE_BUDGET_SECONDS, PrimitiveWarning } from '../../models/domain';

/**
 * Calls of one primitive that received no answer within the budget: when, towards which PSP, channel,
 * creditor entity and station. Created when its row is expanded, so every opening reads fresh data.
 */
@Component({
  selector: 'app-primitive-warnings',
  templateUrl: './primitive-warnings.component.html',
  styleUrl: './primitive-warnings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrimitiveWarningsComponent implements OnInit {
  /** Window and filters of the overview, as sent for the counts. */
  readonly filters = input.required<Filters>();
  /** `serviceIdentifier` filter value of the row (`~unknown` when the service is not available). */
  readonly serviceIdentifier = input.required<string>();
  readonly primitive = input.required<string>();
  /** Warnings counted for the row, to tell the operator when the list is shorter than the count. */
  readonly expected = input.required<number>();

  private readonly api = inject(ObservabilityApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly timezone = inject(TimezoneService);

  readonly budgetSeconds = PRIMITIVE_RESPONSE_BUDGET_SECONDS;
  readonly items = signal<PrimitiveWarning[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly summary = computed(() => this.expected() === 1
    ? '1 chiamata senza risposta.'
    : `Mostrate ${this.items().length} di ${this.expected()} chiamate senza risposta.`);
  readonly format = (value: string): string => formatInstant(value, this.timezone.zone());

  ngOnInit(): void {
    this.load(null);
  }

  loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor && !this.loading()) this.load(cursor);
  }

  retry(): void {
    this.load(this.nextCursor());
  }

  private load(cursor: string | null): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.primitiveWarnings({
      ...this.filters(),
      serviceIdentifier: this.serviceIdentifier(),
      primitive: this.primitive(),
      cursor,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: page => {
        this.items.update(current => [...current, ...page.items]);
        this.nextCursor.set(page.nextCursor);
        this.loading.set(false);
      },
      error: (failure: unknown) => {
        const expired = typeof failure === 'object' && failure !== null && 'status' in failure && failure.status === 410;
        if (expired) {
          // The cursor no longer matches the snapshot: the list restarts from the first page.
          this.items.set([]);
          this.nextCursor.set(null);
        }
        this.error.set(expired
          ? 'L’elenco è cambiato mentre lo consultavi. Riprova per ricaricarlo dall’inizio.'
          : 'Impossibile caricare le chiamate senza risposta. Riprova.');
        this.loading.set(false);
      },
    });
  }
}
