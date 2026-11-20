import { EMPTY, expand, map, Observable, reduce } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { ReEvent, ReEventsResponse, ReScope, ReWindow } from '../../models/re-event';

/** Pages fetched per consultation: the source caps a consultation at 1.000 events (10 pages). */
const MAX_PAGES = 10;

export interface ReChronology {
  readonly events: readonly ReEvent[];
  readonly window: ReWindow;
  readonly retrievedAt: string;
  readonly truncated: boolean;
  readonly pageLimited: boolean;
  readonly warnings: readonly string[];
}

/**
 * Walks every page of a consultation. `accept` validates each page against the caller's context and
 * throws when it does not belong to it. The window is narrowed to `from`/`to`: the strict API rejects
 * UI-only fields carried by the suggested window.
 */
export function loadReChronology(
  api: ObservabilityApi,
  attemptId: string,
  window: ReWindow,
  scope: ReScope,
  accept: (page: ReEventsResponse) => void,
): Observable<ReChronology> {
  const request = { from: window.from, to: window.to, ...(scope === 'POSITION' ? { scope } : {}) };
  let pages = 0;
  return api.reEvents(attemptId, request).pipe(
    expand((page) =>
      page.nextCursor && ++pages < MAX_PAGES
        ? api.reEvents(attemptId, { ...request, cursor: page.nextCursor })
        : EMPTY,
    ),
    map((page) => {
      accept(page);
      return page;
    }),
    reduce<ReEventsResponse, ReChronology | null>(
      (all, page) => ({
        events: [...(all?.events ?? []), ...page.events],
        window: { from: all?.window.from ?? page.window.from, to: page.window.to },
        retrievedAt: page.retrievedAt,
        truncated: page.truncated,
        // The last page still carrying a cursor means the page cap stopped the walk.
        pageLimited: page.nextCursor !== null,
        warnings: [...new Set([...(all?.warnings ?? []), ...page.warnings])],
      }),
      null,
    ),
    map((all) => all as ReChronology),
  );
}
