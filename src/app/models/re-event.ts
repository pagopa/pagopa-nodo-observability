import { Attempt } from './domain';

export const RE_FIELDS = [
  'insertedTimestamp',
  'componente',
  'categoriaEvento',
  'sottoTipoEvento',
  'idDominio',
  'iuv',
  'ccp',
  'psp',
  'tipoVersamento',
  'tipoEvento',
  'fruitore',
  'erogatore',
  'stazione',
  'canale',
  'parametriSpecificiInterfaccia',
  'esito',
  'sessionId',
  'status',
  'payload',
  'info',
  'businessProcess',
  'fruitoreDescr',
  'erogatoreDescr',
  'pspDescr',
  'noticeNumber',
  'creditorReferenceId',
  'paymentToken',
  'sessionIdOriginal',
  'standIn',
  'serviceIdentifier',
  'dataOraEvento',
  'uniqueId',
  'version',
] as const;
export type ReScalar = string | number | boolean | null;
export type PayloadStatus = 'ABSENT' | 'DECODED' | 'INVALID_BASE64' | 'INVALID_UTF8' | 'TOO_LARGE';
export type ReEvent = Record<(typeof RE_FIELDS)[number], ReScalar> & {
  payload: string | null;
  payloadDecoded: { status: PayloadStatus; text: string | null; reason: string | null };
  payloadOmitted: boolean;
  payloadSourceBytes: number | null;
};
export interface ReWindow {
  from: string;
  to: string;
}
export type ReScope = 'ATTEMPT' | 'POSITION';
export interface ReEventsRequest extends ReWindow {
  cursor?: string;
  /** POSITION drops the paymentToken key: events of the whole PA + NAV pair, token-less calls included. */
  scope?: ReScope;
}
export interface ReEventsResponse {
  attemptId: string;
  source: 'RE';
  retrievedAt: string;
  window: ReWindow;
  coverage: 'WINDOW_ONLY' | 'RETENTION_CLIPPED' | 'LIMIT_REACHED';
  events: ReEvent[];
  nextCursor: string | null;
  truncated: boolean;
  warnings: string[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

export function isUtcInstant(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

export function isReWindow(value: unknown): value is ReWindow {
  return (
    record(value) &&
    isUtcInstant(value['from']) &&
    isUtcInstant(value['to']) &&
    Date.parse(value['from']) < Date.parse(value['to']) &&
    Date.parse(value['to']) - Date.parse(value['from']) <= 86_400_000
  );
}

function isReEvent(value: unknown): value is ReEvent {
  if (
    !record(value) ||
    !RE_FIELDS.every(
      (field) =>
        value[field] === null ||
        ['string', 'boolean'].includes(typeof value[field]) ||
        (typeof value[field] === 'number' && Number.isFinite(value[field])),
    )
  )
    return false;
  const decoded = value['payloadDecoded'];
  if (
    !record(decoded) ||
    !nullableString(decoded['text']) ||
    !nullableString(decoded['reason']) ||
    !nullableString(value['payload']) ||
    typeof value['payloadOmitted'] !== 'boolean' ||
    !(
      value['payloadSourceBytes'] === null ||
      (typeof value['payloadSourceBytes'] === 'number' &&
        Number.isSafeInteger(value['payloadSourceBytes']) &&
        value['payloadSourceBytes'] >= 0)
    )
  )
    return false;
  switch (decoded['status']) {
    case 'ABSENT':
      return value['payload'] === null && !value['payloadOmitted'] && decoded['text'] === null;
    case 'DECODED':
      return (
        typeof value['payload'] === 'string' &&
        !value['payloadOmitted'] &&
        typeof decoded['text'] === 'string'
      );
    case 'INVALID_BASE64':
    case 'INVALID_UTF8':
      return (
        typeof value['payload'] === 'string' && !value['payloadOmitted'] && decoded['text'] === null
      );
    case 'TOO_LARGE':
      return (
        value['payload'] === null &&
        value['payloadOmitted'] === true &&
        typeof value['payloadSourceBytes'] === 'number' &&
        decoded['text'] === null
      );
    default:
      return false;
  }
}

export function isReEventsResponse(value: unknown): value is ReEventsResponse {
  return (
    record(value) &&
    typeof value['attemptId'] === 'string' &&
    value['attemptId'].length > 0 &&
    value['source'] === 'RE' &&
    isUtcInstant(value['retrievedAt']) &&
    isReWindow(value['window']) &&
    ['WINDOW_ONLY', 'RETENTION_CLIPPED', 'LIMIT_REACHED'].includes(String(value['coverage'])) &&
    Array.isArray(value['events']) &&
    value['events'].length <= 100 &&
    value['events'].every(isReEvent) &&
    (value['nextCursor'] === null ||
      (typeof value['nextCursor'] === 'string' && value['nextCursor'].length > 0)) &&
    typeof value['truncated'] === 'boolean' &&
    (!value['truncated'] || value['nextCursor'] === null) &&
    Array.isArray(value['warnings']) &&
    value['warnings'].every((item) => typeof item === 'string')
  );
}

export function defaultReWindow(
  attempt: Pick<Attempt, 'attemptStartedAt' | 'startTimestampBasis' | 'timeline'>,
  now: number,
): (ReWindow & { segmented: boolean }) | null {
  if (!isUtcInstant(attempt.attemptStartedAt) || attempt.startTimestampBasis === 'ANOMALY')
    return null;
  const start = Date.parse(attempt.attemptStartedAt);
  if (start > now) return null;
  let last = start;
  for (const entry of attempt.timeline) {
    if (entry.timestampBasis === 'ANOMALY' || entry.transitionAt === null) continue;
    if (!isUtcInstant(entry.transitionAt)) return null;
    const at = Date.parse(entry.transitionAt);
    if (at < start || at < last || at > now) return null;
    last = at;
  }
  const from = start - 15 * 60_000;
  // Within the first day the window runs to now: an attempt stuck on a state may still receive (or
  // be missing) calls after its last transition, and that is exactly what the chronology must show.
  const end = now - from <= 86_400_000 ? now : Math.min(now, last + 15 * 60_000);
  return {
    from: new Date(from).toISOString(),
    to: new Date(Math.min(end, from + 86_400_000)).toISOString(),
    segmented: end - from > 86_400_000,
  };
}

/**
 * Window for the position-level consultation: from one hour before the earliest attempt start (token-less
 * calls such as verifyPaymentNotice precede the activation), for at most 24 hours, never beyond now.
 */
export function positionReWindow(
  attempts: readonly Pick<Attempt, 'attemptId' | 'attemptStartedAt' | 'startTimestampBasis'>[],
  now: number,
): { attemptId: string; window: ReWindow } | null {
  const starts = attempts
    .filter((attempt) => isUtcInstant(attempt.attemptStartedAt) && attempt.startTimestampBasis !== 'ANOMALY')
    .map((attempt) => ({ attemptId: attempt.attemptId, at: Date.parse(attempt.attemptStartedAt as string) }))
    .filter((attempt) => attempt.at <= now)
    .sort((a, b) => a.at - b.at);
  if (starts.length === 0) return null;
  const from = starts[0].at - 60 * 60_000;
  return {
    attemptId: starts[0].attemptId,
    window: {
      from: new Date(from).toISOString(),
      to: new Date(Math.min(now, from + 86_400_000)).toISOString(),
    },
  };
}
