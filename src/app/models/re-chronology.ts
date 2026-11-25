import { ReEvent } from './re-event';

export type ReEventKind = 'request' | 'response' | 'state-change' | 'other';
export type StateEntityLabel = 'Tentativo' | 'Posizione' | 'Destinatario';
/** Outcome of a SOAP response, read from its decoded payload. `null` when it cannot be determined. */
export type ReOutcome = 'OK' | 'KO';
/**
 * Why a response is KO: the payload carries a faultCode, declares `outcome` KO (REST bodies such as the
 * closePayment 4xx errors), or is not a SOAP/JSON envelope at all.
 */
export type ReOutcomeReason = 'FAULT_CODE' | 'OUTCOME_KO' | 'NOT_SOAP';
export const NOT_SOAP_LABEL = 'risposta non SOAP';
export const OUTCOME_KO_LABEL = 'outcome KO';

export interface ChronologyRow {
  readonly id: number;
  readonly event: ReEvent;
  readonly kind: ReEventKind;
  readonly primitive: string;
  /** Original RE status of a state change (prefix included), never renamed. */
  readonly status: string | null;
  readonly stateEntity: StateEntityLabel | null;
  /** Responses only: KO when the decoded payload carries a faultCode, OK when it does not. */
  readonly outcome: ReOutcome | null;
  readonly outcomeReason: ReOutcomeReason | null;
  /** Value of the faultCode element/property of a KO response, when it can be read. */
  readonly faultCode: string | null;
  /** Short reason shown next to a KO: the fault code, or that the response is not SOAP. */
  readonly koLabel: string | null;
  /** Request for which the RE holds no response with the same primitive and session. */
  readonly unanswered: boolean;
}

const STATE_PREFIXES: readonly (readonly [string, StateEntityLabel])[] = [
  ['receipt_recipient_', 'Destinatario'],
  ['payment_', 'Tentativo'],
  ['position_', 'Posizione'],
];

export function eventKind(event: ReEvent): ReEventKind {
  if (typeof event.status === 'string' && event.status.length > 0) return 'state-change';
  if (event.categoriaEvento === 'INTERFACCIA') {
    if (event.sottoTipoEvento === 'REQ') return 'request';
    if (event.sottoTipoEvento === 'RESP') return 'response';
  }
  return 'other';
}

export function stateEntity(status: string | null): StateEntityLabel | null {
  if (!status) return null;
  return STATE_PREFIXES.find(([prefix]) => status.startsWith(prefix))?.[1] ?? null;
}

const FAULT_VALUE = [
  /<(?:[\w-]+:)?faultCode\b[^>]*>\s*([^<\s][^<]*?)\s*</,
  /"faultCode"\s*:\s*"([^"]*)"/,
];

export interface ResponseOutcome {
  readonly outcome: ReOutcome | null;
  readonly outcomeReason: ReOutcomeReason | null;
  readonly faultCode: string | null;
  /** Description declared by an `outcome` KO body, shortened. */
  readonly description: string | null;
}
const NO_OUTCOME: ResponseOutcome = { outcome: null, outcomeReason: null, faultCode: null, description: null };
const EXCERPT_LENGTH = 160;
const OUTCOME_KO = [/<(?:[\w-]+:)?outcome\b[^>]*>\s*KO\s*</i, /"outcome"\s*:\s*"KO"/i];
const DESCRIPTION_VALUE = [
  /<(?:[\w-]+:)?description\b[^>]*>\s*([^<\s][^<]*?)\s*</,
  /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/,
];
const shorten = (text: string): string | null => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > EXCERPT_LENGTH ? `${collapsed.slice(0, EXCERPT_LENGTH)}…` : collapsed || null;
};
const HTML_PAGE = /^<(?:!doctype\s+html|html)\b/i;

/** A SOAP/XML or JSON envelope. Plain text and HTML pages (HTTP error bodies) are not. */
function isEnvelope(text: string): boolean {
  const body = text.trim();
  if (body.startsWith('{') || body.startsWith('[')) return true;
  return /^<(?:\?xml\b|[A-Za-z_][\w.-]*(?::[\w.-]+)?[\s/>])/.test(body) && !HTML_PAGE.test(body);
}

/**
 * Outcome of a response from its decoded payload: KO when it carries a faultCode, declares `outcome` KO
 * (its description is the reason) or is not a SOAP/JSON envelope at all (e.g. an HTTP error text, which
 * the Nodo cannot read as an answer); OK otherwise. The HTTP status code is not part of the RE data, so a
 * non-200 answer is recognised through its body. Without a decoded payload (absent, invalid or too large)
 * the outcome is unknown, never assumed OK.
 */
export function responseOutcome(event: ReEvent): ResponseOutcome {
  const decoded = event.payloadDecoded;
  if (eventKind(event) !== 'response' || decoded.status !== 'DECODED' || decoded.text === null)
    return NO_OUTCOME;
  const text = decoded.text;
  if (!isEnvelope(text))
    return { ...NO_OUTCOME, outcome: 'KO', outcomeReason: 'NOT_SOAP' };
  if (text.includes('faultCode')) {
    const value = FAULT_VALUE.map((pattern) => pattern.exec(text)?.[1]).find(Boolean);
    return { ...NO_OUTCOME, outcome: 'KO', outcomeReason: 'FAULT_CODE', faultCode: value ?? null };
  }
  if (OUTCOME_KO.some((pattern) => pattern.test(text))) {
    const description = DESCRIPTION_VALUE.map((pattern) => pattern.exec(text)?.[1]).find(Boolean);
    return {
      ...NO_OUTCOME,
      outcome: 'KO',
      outcomeReason: 'OUTCOME_KO',
      description: description ? shorten(description) : null,
    };
  }
  return { ...NO_OUTCOME, outcome: 'OK' };
}

function koLabel(outcome: ResponseOutcome): string | null {
  switch (outcome.outcomeReason) {
    case 'NOT_SOAP':
      return NOT_SOAP_LABEL;
    case 'OUTCOME_KO':
      return outcome.description ?? OUTCOME_KO_LABEL;
    default:
      return outcome.faultCode;
  }
}

const primitiveOf = (event: ReEvent): string =>
  typeof event.tipoEvento === 'string' && event.tipoEvento ? event.tipoEvento : 'non disponibile';

const pairKey = (event: ReEvent): string => `${primitiveOf(event)}|${String(event.sessionId ?? '')}`;

/**
 * Chronological rows of every RE event of the attempt, in the order returned by the source.
 * A request is flagged unanswered when the requests of its primitive/session outnumber the
 * responses: the later requests are the ones left without an answer. The flag only reports what
 * the RE returned for the queried window, it never proves the call was not answered.
 */
export function buildChronology(events: readonly ReEvent[]): ChronologyRow[] {
  const answers = new Map<string, number>();
  for (const event of events) {
    if (eventKind(event) === 'response') {
      answers.set(pairKey(event), (answers.get(pairKey(event)) ?? 0) + 1);
    }
  }
  const unanswered = new Set<number>();
  const pending = new Map<string, number[]>();
  events.forEach((event, index) => {
    if (eventKind(event) !== 'request') return;
    pending.set(pairKey(event), [...(pending.get(pairKey(event)) ?? []), index]);
  });
  for (const [key, requests] of pending) {
    const missing = requests.length - (answers.get(key) ?? 0);
    for (const index of requests.slice(Math.max(requests.length - missing, 0))) unanswered.add(index);
  }
  return events.map((event, id) => {
    const kind = eventKind(event);
    const status = kind === 'state-change' ? String(event.status) : null;
    const outcome = responseOutcome(event);
    return {
      id,
      event,
      kind,
      primitive: primitiveOf(event),
      status,
      stateEntity: stateEntity(status),
      ...outcome,
      koLabel: koLabel(outcome),
      unanswered: unanswered.has(id),
    };
  });
}

/** Millisecond-precision event time in the selected zone; the RE timestamps are UTC instants. */
export function formatEventTime(event: ReEvent, timeZone: string): string {
  const value = event.insertedTimestamp;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return 'non disponibile';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
    timeZone,
  }).format(new Date(value));
}
