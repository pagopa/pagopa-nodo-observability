import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable } from 'rxjs';
import { SessionService } from '../auth/session.service';
import {
  Catalog,
  CatalogWithServiceIdentifiers,
  Creditor,
  Freshness,
  Overview,
  Page,
  Payment,
  PaymentSummary,
  PrimitiveWarning,
  Station,
} from '../../models/domain';
import { environment } from '../../../environments/environment';
import { DbCheck, isDbCheck } from '../../models/db-check';
import { isMaintenances, Maintenances } from '../../models/maintenance';
import { NodeServicesCheck, toNodeServicesCheck } from '../../models/node-service';
import { isReEventsResponse, ReEventsRequest, ReEventsResponse } from '../../models/re-event';

export type Filters = Record<string, string | null | undefined>;
export interface TokenLookupFilters {
  paFiscalCode?: string;
  noticeNumber?: string;
}
export interface TokenLookupResult {
  paFiscalCode: string;
  noticeNumber: string;
  attemptId: string;
  projectionRevision: number;
}
export type EventScope = { scope: 'payment'; paFiscalCode: string; noticeNumber: string }
  | { scope: 'payment-list'; keys: string }
  | { scope: 'creditor-list'; keys: string }
  | ({ scope: 'overview' } & Filters)
  | ({ scope: 'creditor'; paFiscalCode: string } & Filters)
  | ({ scope: 'station'; paFiscalCode: string; stazione: string } & Filters);

export class StreamHttpError extends Error {
  constructor(readonly status: number) {
    super(`Stream SSE non disponibile (${status}).`);
    this.name = 'StreamHttpError';
  }
}

@Injectable({ providedIn: 'root' })
export class ObservabilityApi {
  private readonly http = inject(HttpClient);
  private readonly sessionService = inject(SessionService);
  /** Prefisso backend configurabile via environment (vuoto in dev → proxy). */
  private readonly base = environment.apiBaseUrl;

  payments<T extends PaymentSummary | Payment['attempts'][number]>(filters: Filters): Observable<Page<T>> {
    return this.http.get<Page<T>>(`${this.base}/api/${filters['view'] === 'attempts' ? 'attempts' : 'payments'}`, {
      params: this.params(filters),
    });
  }

  payment(paFiscalCode: string, noticeNumber: string): Observable<Payment> {
    return this.http.get<Payment>(`${this.base}/api/payments/${encodeURIComponent(paFiscalCode)}/${encodeURIComponent(noticeNumber)}`);
  }

  checkDb(attemptId: string): Observable<DbCheck> {
    return this.http.get<unknown>(`${this.base}/api/attempts/${encodeURIComponent(attemptId)}/check-db`).pipe(
      map(value => {
        if (!isDbCheck(value) || value.attemptId !== attemptId) {
          throw new Error('Risposta Check DB non valida.');
        }

        return value;
      }),
    );
  }

  reEvents(attemptId: string, window: ReEventsRequest): Observable<ReEventsResponse> {
    return this.http.post<unknown>(
      `${this.base}/api/attempts/${encodeURIComponent(attemptId)}/re-events`, window,
      { cache: 'no-store' },
    ).pipe(map(value => {
      if (!isReEventsResponse(value) || value.attemptId !== attemptId
        || Date.parse(value.window.from) < Date.parse(window.from)
        || Date.parse(value.window.to) > Date.parse(window.to)) {
        throw new Error('Risposta RE non valida.');
      }
      return value;
    }));
  }

  overview(filters: Filters): Observable<Overview> {
    return this.http.get<Overview>(`${this.base}/api/overview`, { params: this.params(filters) });
  }

  /** Station maintenances of the next 7 days, cached daily by the backend. */
  maintenances(): Observable<Maintenances> {
    return this.http.get<unknown>(`${this.base}/api/apiconfig/maintenances`).pipe(
      map(value => {
        if (!isMaintenances(value)) throw new Error('Risposta delle manutenzioni programmate non valida.');
        return value;
      }),
    );
  }

  /** Version, cache id and database status of each Nodo microservice. */
  nodeServices(): Observable<NodeServicesCheck> {
    return this.http.get<unknown>(`${this.base}/api/nodo-monitoring/cache/version`, { cache: 'no-store' }).pipe(
      map(value => {
        const check = toNodeServicesCheck(value);
        if (!check) throw new Error('Risposta delle istanze del Nodo non valida.');
        return check;
      }),
    );
  }

  primitiveWarnings(filters: Filters): Observable<Page<PrimitiveWarning>> {
    return this.http.get<Page<PrimitiveWarning>>(`${this.base}/api/overview/primitive-warnings`, {
      params: this.params(filters),
    });
  }

  catalog(): Observable<Catalog> {
    return this.http.get<Catalog>(`${this.base}/api/catalog`);
  }

  serviceIdentifiers(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/api/serviceIdentifiers`);
  }

  catalogWithServiceIdentifiers(): Observable<CatalogWithServiceIdentifiers> {
    return forkJoin({
      catalog: this.catalog(),
      serviceIdentifiers: this.serviceIdentifiers(),
    }).pipe(
      map(({ catalog, serviceIdentifiers }) => ({ ...catalog, serviceIdentifiers })),
    );
  }

  freshness(): Observable<Freshness> {
    return this.http.get<Freshness>(`${this.base}/api/freshness`);
  }

  creditors(filters: Filters): Observable<Page<Creditor>> {
    return this.http.get<Page<Creditor>>(`${this.base}/api/creditors`, { params: this.params(filters) });
  }

  creditor(paFiscalCode: string, filters: Filters): Observable<Overview> {
    return this.http.get<Overview>(`${this.base}/api/creditors/${encodeURIComponent(paFiscalCode)}`, { params: this.params(filters) });
  }

  stations(paFiscalCode: string, filters: Filters): Observable<Page<Station>> {
    return this.http.get<Page<Station>>(`${this.base}/api/creditors/${encodeURIComponent(paFiscalCode)}/stations`, {
      params: this.params(filters),
    });
  }

  reveal(attemptId: string): Observable<{ attemptId: string; paymentToken: string }> {
    return this.http.post<{ attemptId: string; paymentToken: string }>(`${this.base}/api/attempts/${encodeURIComponent(attemptId)}/reveal`, {});
  }

  lookupToken(paymentToken: string, filters: TokenLookupFilters = {}): Observable<TokenLookupResult> {
    return this.http.post<TokenLookupResult>(`${this.base}/api/token-lookup`, {
      paymentToken,
      ...filters,
    });
  }

  connect(scope: EventScope): Observable<MessageEvent<string>> {
    return new Observable<MessageEvent<string>>(subscriber => {
      let controller = new AbortController();
      let lastEventId: string | null = null;
      let replayExpired = false;
      let suspended = false;
      const getToken = () => this.sessionService.token();
      let retryDelay = 500;
      const seen = new Set<string>();
      const run = async (activeController: AbortController): Promise<void> => {
        while (!activeController.signal.aborted) {
          try {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(scope)) {
              if (typeof value === 'string' && value.length > 0) params.set(key, value);
            }
            const response = await fetch(`${this.base}/api/events?${params}`, {
              headers: {
                Authorization: `Bearer ${getToken()}`,
                ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
                'X-Correlation-ID': crypto.randomUUID(),
              },
              signal: activeController.signal,
            });
            if (response.status === 410) {
              lastEventId = null;
              replayExpired = true;
              await new Promise(resolve => setTimeout(resolve, 150));
              continue;
            }
            if (!response.ok || !response.body) {
              if (response.status >= 500) {
                subscriber.next(new MessageEvent('connection-error', { data: JSON.stringify({ status: response.status }) }));
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                retryDelay = Math.min(retryDelay * 2, 8_000);
                continue;
              }
              subscriber.error(new StreamHttpError(response.status));
              return;
            }
            retryDelay = 500;
            if (replayExpired) {
              subscriber.next(new MessageEvent('replay-expired'));
              replayExpired = false;
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let pending = '';
            let eventName = 'message';
            let eventId = '';
            let data: string[] = [];
            const dispatch = (): void => {
              if (!data.length) return;
              if (eventId) lastEventId = eventId;
              const id = eventId;
              if (!id || !seen.has(id)) {
                if (id) {
                  seen.add(id);
                  if (seen.size > 300) seen.delete(seen.values().next().value ?? '');
                }
                subscriber.next(new MessageEvent(eventName, { data: data.join('\n'), lastEventId: id }));
              }
              eventName = 'message';
              eventId = '';
              data = [];
            };
            while (!activeController.signal.aborted) {
              const { value, done } = await reader.read();
              pending += decoder.decode(value, { stream: !done });
              const lines = pending.split(/\r?\n/);
              pending = lines.pop() ?? '';
              for (const line of lines) {
                if (line === '') dispatch();
                else if (!line.startsWith(':')) {
                  const separator = line.indexOf(':');
                  const field = separator < 0 ? line : line.slice(0, separator);
                  const content = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
                  if (field === 'event') eventName = content;
                  if (field === 'id' && !content.includes('\0')) eventId = content;
                  if (field === 'data') data.push(content);
                }
              }
              if (done) break;
            }
            await reader.cancel().catch(() => undefined);
          } catch {
            if (activeController.signal.aborted) return;
            subscriber.next(new MessageEvent('connection-error'));
          }
          if (!activeController.signal.aborted) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryDelay = Math.min(retryDelay * 2, 8_000);
          }
        }
      };
      const pageTarget = typeof window === 'undefined' ? null : window;
      const suspend = (): void => {
        suspended = true;
        controller.abort();
      };
      const resume = (): void => {
        if (!suspended || subscriber.closed) return;
        suspended = false;
        controller = new AbortController();
        void run(controller);
      };
      pageTarget?.addEventListener('pagehide', suspend);
      pageTarget?.addEventListener('pageshow', resume);
      void run(controller);
      return () => {
        pageTarget?.removeEventListener('pagehide', suspend);
        pageTarget?.removeEventListener('pageshow', resume);
        controller.abort();
      };
    });
  }

  private params(filters: Filters): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (key !== 'view' && key !== 'cursorStack' && value !== null && value !== undefined && value !== '') {
        params = params.set(key, value);
      }
    }
    return params;
  }
}
