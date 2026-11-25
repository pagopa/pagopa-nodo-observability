import { Freshness } from './domain';

export interface ActivationsOutcomes {
  window: { from: string; to: string | null };
  live: boolean;
  activatePaymentNoticeOk: { total: number; activatePaymentNotice: number; activatePaymentNoticeV2: number };
  sendPaymentOutcome: { total: number; sendPaymentOutcome: number; sendPaymentOutcomeV2: number };
  /** Raw balance of requests: sendPaymentOutcome.total - activatePaymentNoticeOk.total (a V2 request may cover several tokens). */
  difference: number;
  /** Same tokens as `activatePaymentNoticeOk`, split by observed outcome; null when coverage is UNAVAILABLE. */
  tokens: TokenBreakdown | null;
  coverage: Coverage;
  freshness: Freshness;
  generatedAt: string;
}

/** Known coverage reasons; unknown values are still shown verbatim. */
export const COVERAGE_REASONS = ['NO_INGESTION_WATERMARK', 'RETENTION'] as const;

/**
 * UNKNOWN: counts reflect the observed events, but ingestion coverage cannot be verified.
 * UNAVAILABLE: no counts at all (e.g. window before the projection retention).
 */
export interface Coverage {
  status: 'UNKNOWN' | 'UNAVAILABLE';
  reasons: string[];
  lastObservedEventAt: string | null;
}

/** The five categories partition `total`, which equals `activatePaymentNoticeOk.total`. */
export interface TokenBreakdown {
  total: number;
  acceptedOutcome: { total: number; sendPaymentOutcome: number; sendPaymentOutcomeV2: number };
  cancelledByMod3Cancel: { total: number; mod3Cancel: number; mod3CancelV2: number };
  otherCancelled: { total: number; byCause: { cause: string | null; count: number }[] };
  nonTerminal: { total: number; byState: { state: string; count: number }[] };
  otherTerminal: { total: number; byState: { state: string; cause: string | null; count: number }[] };
}

const FRESHNESS_STATUSES: readonly Freshness['status'][] = ['CURRENT', 'DELAYED', 'GAP'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Counters must add up: a breakdown that does not match its total is rejected rather than shown. */
function isCounter(value: unknown, parts: readonly [string, string]): boolean {
  return isRecord(value) && isCount(value['total']) && parts.every(part => isCount(value[part]))
    && value['total'] === (value[parts[0]] as number) + (value[parts[1]] as number);
}

const isCause = (value: unknown): boolean => value === null || typeof value === 'string';

/** A detail list whose counts add up to its category total. */
function isDetailed(value: unknown, list: string, isItem: (item: Record<string, unknown>) => boolean): boolean {
  if (!isRecord(value) || !isCount(value['total']) || !Array.isArray(value[list])) return false;
  const items = value[list] as unknown[];
  return items.every(item => isRecord(item) && isCount(item['count']) && isItem(item))
    && items.reduce<number>((sum, item) => sum + ((item as { count: number }).count), 0) === value['total'];
}

function isTokenBreakdown(value: unknown, activations: number): boolean {
  if (!isRecord(value) || !isCount(value['total']) || value['total'] !== activations) return false;
  const categories = ['acceptedOutcome', 'cancelledByMod3Cancel', 'otherCancelled', 'nonTerminal', 'otherTerminal'];
  return isCounter(value['acceptedOutcome'], ['sendPaymentOutcome', 'sendPaymentOutcomeV2'])
    && isCounter(value['cancelledByMod3Cancel'], ['mod3Cancel', 'mod3CancelV2'])
    && isDetailed(value['otherCancelled'], 'byCause', item => isCause(item['cause']))
    && isDetailed(value['nonTerminal'], 'byState', item => typeof item['state'] === 'string')
    && isDetailed(value['otherTerminal'], 'byState', item => typeof item['state'] === 'string' && isCause(item['cause']))
    && categories.reduce((sum, key) => sum + ((value[key] as { total: number }).total), 0) === value['total'];
}

function isCoverage(value: unknown): value is Coverage {
  return isRecord(value) && (value['status'] === 'UNKNOWN' || value['status'] === 'UNAVAILABLE')
    && Array.isArray(value['reasons']) && value['reasons'].every(reason => typeof reason === 'string')
    && (value['lastObservedEventAt'] === null || isInstant(value['lastObservedEventAt']));
}

/** Tokens are null exactly when coverage is UNAVAILABLE. */
function isTokensWithCoverage(tokens: unknown, coverage: unknown, activations: number): boolean {
  if (!isCoverage(coverage)) return false;
  return coverage.status === 'UNAVAILABLE' ? tokens === null : isTokenBreakdown(tokens, activations);
}

export function isActivationsOutcomes(value: unknown): value is ActivationsOutcomes {
  if (!isRecord(value) || !isRecord(value['window']) || !isRecord(value['freshness'])) return false;
  const window = value['window'];
  const freshness = value['freshness'];
  const activations = value['activatePaymentNoticeOk'];
  const outcomes = value['sendPaymentOutcome'];
  return typeof value['live'] === 'boolean'
    && isInstant(window['from'])
    && (value['live'] ? window['to'] === null : isInstant(window['to']))
    && isCounter(activations, ['activatePaymentNotice', 'activatePaymentNoticeV2'])
    && isCounter(outcomes, ['sendPaymentOutcome', 'sendPaymentOutcomeV2'])
    && Number.isSafeInteger(value['difference'])
    && value['difference'] === (outcomes as { total: number }).total - (activations as { total: number }).total
    && isTokensWithCoverage(value['tokens'], value['coverage'], (activations as { total: number }).total)
    && FRESHNESS_STATUSES.some(status => status === freshness['status'])
    && typeof freshness['lagSeconds'] === 'number'
    && isInstant(value['generatedAt']);
}
