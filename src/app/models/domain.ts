import { statePresentation } from './state-presentation';

export const LOGICAL_STATES = ['INSERTED', 'PAYING', 'PAID', 'NOTICE_STORED', 'NOTIFIED'] as const;
export const ATTEMPT_STATES = [
  'PAYING', 'PAYING_RPT', 'PAID_NORPT', 'PAID', 'FAILED_NORPT', 'FAILED', 'CANCELLED',
  'CANCELLED_NORPT', 'NOTICE_GENERATED', 'NOTICE_STORED', 'NOTICE_SENT', 'NOTIFIED',
  'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_ACCEPTED', 'PAYMENT_REFUSED',
  'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR',
] as const;

export const RECIPIENT_STATES = ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTICE_PENDING', 'NOTIFIED'] as const;

export type LogicalState = (typeof LOGICAL_STATES)[number];
export type AttemptState = (typeof ATTEMPT_STATES)[number];
export type RecipientState = (typeof RECIPIENT_STATES)[number];
export type WarningState = 'PAYMENT_UNKNOWN' | 'PAYMENT_SEND_ERROR';
export type AggregateFilterPolicy = 'ONE_ATTEMPT_DIMENSION;STATION_REQUIRES_PA';
export type TimestampBasis = 'SOURCE_EVENT' | 'INFERRED' | 'ANOMALY';
export type ProgressionStatus = 'reached' | 'current' | 'unreached' | 'not-in-branch';

export interface Catalog {
  logicalStates: LogicalState[];
  attemptStates: AttemptState[];
  warningStates: WarningState[];
  unknownFilterValue: '~unknown';
  serviceIdentifiers: (string | null)[];
  psps: (string | null)[];
  canali: (string | null)[];
  stazioni: (string | null)[];
  aggregateFilterPolicy: AggregateFilterPolicy;
}

export type CatalogWithServiceIdentifiers = Omit<Catalog, 'serviceIdentifiers'> & {
  serviceIdentifiers: string[];
};

export interface TimelineItem {
  state: string;
  transitionAt: string | null;
  timestampBasis: TimestampBasis;
  trigger?: string | null;
}

export interface Attempt {
  attemptId: string;
  paFiscalCode: string;
  noticeNumber: string;
  tokenDisplay: string;
  state: string;
  warning: boolean;
  hasAnomaly: boolean;
  serviceIdentifier: string | null;
  psp: string | null;
  stazione: string | null;
  canale: string | null;
  attemptStartedAt: string | null;
  startTimestampBasis: TimestampBasis;
  timelineIncomplete: boolean;
  timeline: TimelineItem[];
  projectionRevision: number;
}

export interface Recipient {
  recipientId: string;
  stazioneRecipient: string | null;
  paFiscalCode: string;
  noticeNumber: string;
  state: string;
  timelineIncomplete: boolean;
  hasAnomaly: boolean;
  timeline: TimelineItem[];
  projectionRevision: number;
}

export interface PaymentSummary {
  paFiscalCode: string;
  noticeNumber: string;
  state: string;
  projectionRevision: number;
  timelineIncomplete: boolean;
  hasAnomaly: boolean;
  warning: boolean;
  attemptCount: number;
}

export interface Payment extends PaymentSummary {
  timeline: TimelineItem[];
  attempts: Attempt[];
  recipients: Recipient[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  snapshotRevision: number;
}

export interface CountRow {
  state: string;
  count: number;
}

export interface DurationRow {
  entity: 'logical' | 'attempt' | 'recipient';
  fromState: string;
  toState: string;
  timestampBasis: 'SOURCE_EVENT' | 'INFERRED';
  samples: number;
  averageMs: number;
  medianMs: number;
  p95Ms: number;
}

/** Direction of a primitive call relative to the Nodo, as computed by the backend from the RE parties. */
export type PrimitiveDirection = 'INBOUND' | 'OUTBOUND' | 'UNKNOWN';

export const PRIMITIVE_DIRECTIONS: readonly { direction: PrimitiveDirection; label: string; hint: string }[] = [
  { direction: 'INBOUND', label: 'In ingresso', hint: 'Chiamate ricevute dal Nodo' },
  { direction: 'OUTBOUND', label: 'In uscita', hint: 'Chiamate inviate dal Nodo a PA e PSP' },
  { direction: 'UNKNOWN', label: 'Non determinata', hint: 'Direzione non ricavabile dall\'evento' },
];

/** Primitive requests/responses of one serviceIdentifier, primitive and direction; `warnings` counts requests unanswered after 10 s. */
export interface PrimitiveCount {
  serviceIdentifier: string | null;
  /** Original primitive name (`tipoEvento`), never normalized. */
  primitive: string;
  direction: PrimitiveDirection;
  requests: number;
  responses: number;
  warnings: number;
}

export const PRIMITIVE_RESPONSE_BUDGET_SECONDS = 10;

/** One primitive call left unanswered for more than {@link PRIMITIVE_RESPONSE_BUDGET_SECONDS} s; no payload. */
export interface PrimitiveWarning {
  /** UTC instant of the request. */
  calledAt: string;
  psp: string | null;
  canale: string | null;
  paFiscalCode: string | null;
  stazione: string | null;
}

export interface Overview {
  snapshotAt: string;
  projectionRevision: number;
  window: { from: string; to: string };
  counts: { payments: number; attempts: number };
  logicalStates: CountRow[];
  attemptStates: CountRow[];
  recipientStates: CountRow[];
  /** Absent on creditor snapshots, which do not aggregate primitives. */
  primitives?: PrimitiveCount[];
  unresolved: { payments: number; attempts: number };
  matrices: Record<'psp' | 'canale' | 'recipient', { value: string | null; states: CountRow[] }[]>;
  traffic: { bucketStart: string; startedAttempts: number; estimatedStarts: number }[];
  transitions: { bucketStart: string; entity: string; state: string; timestampBasis: string; count: number }[];
  durations: DurationRow[];
  anomalies: { transitions: number; payments: number };
  freshness: Freshness;
}

export interface Freshness {
  status: 'CURRENT' | 'DELAYED' | 'GAP';
  lagSeconds: number;
  gapsDetected: boolean;
  observedAt: string;
  lastProcessedAt: string;
  lastPublishedAt: string;
}

export interface Session {
  id: string;
  authentication: 'LOCAL_DEMO_ONLY';
}

export interface Creditor {
  paFiscalCode: string;
  startedAttempts: number;
  counts: { payments: number; attempts: number };
  logicalStates: CountRow[];
  unresolved: { payments: number; attempts: number };
}

export interface Station {
  stazione: string | null;
  traffic: Overview['traffic'];
  startedAttempts: number;
  logicalStates: CountRow[];
  attemptStates: CountRow[];
  unresolved: { payments: number; attempts: number };
}

export function stateLabel(state: string): string {
  return statePresentation(state === 'INSERTED' ? 'logical' : state === 'NOTICE_PENDING' ? 'recipient' : 'attempt', state).label;
}

export type StateCategory = 'info' | 'ok' | 'warn' | 'mute';

const UNRESOLVED_STATES: ReadonlySet<string> = new Set(['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR']);

export function stateCategory(state: string): StateCategory {
  return statePresentation(state === 'INSERTED' ? 'logical' : state === 'NOTICE_PENDING' ? 'recipient' : 'attempt', state).treatment;
}

export function isUnresolvedState(state: string): boolean {
  return UNRESOLVED_STATES.has(state);
}

export function formatInstant(value: string | null, timeZone: string): string {
  if (!value) return 'Data-ora non disponibile';
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone,
  }).format(new Date(value));
}

export { rangeStart } from './time-window';

export function timelineState(state: string, history: readonly TimelineItem[]): 'reached' | 'current' | 'future' {
  const index = history.map(item => item.state).lastIndexOf(state);
  if (index < 0) return 'future';
  return index === history.length - 1 ? 'current' : 'reached';
}

const LOGICAL_FSM_ARCS: Readonly<Record<string, readonly string[]>> = {
  INSERTED: ['PAYING'],
  PAYING: ['INSERTED', 'PAID'],
  PAID: ['NOTICE_STORED', 'NOTIFIED'],
  NOTICE_STORED: [],
  NOTIFIED: [],
};

const ATTEMPT_FSM_ARCS: Readonly<Record<string, readonly string[]>> = {
  PAYING: ['CANCELLED', 'PAYMENT_RESERVED', 'PAID', 'PAID_NORPT', 'FAILED', 'FAILED_NORPT'],
  PAYING_RPT: ['CANCELLED', 'PAYMENT_RESERVED', 'PAID', 'PAID_NORPT', 'FAILED', 'FAILED_NORPT'],
  CANCELLED_NORPT: ['PAID', 'PAID_NORPT', 'FAILED', 'FAILED_NORPT', 'CANCELLED'],
  PAYMENT_RESERVED: ['PAYMENT_SENT'],
  PAYMENT_SENT: ['PAYMENT_ACCEPTED', 'PAYMENT_REFUSED', 'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'],
  PAYMENT_ACCEPTED: ['PAID'],
  PAYMENT_REFUSED: ['CANCELLED'],
  PAYMENT_UNKNOWN: ['PAID', 'CANCELLED'],
  PAYMENT_SEND_ERROR: ['CANCELLED'],
  PAID_NORPT: ['PAID', 'NOTICE_GENERATED', 'NOTICE_STORED'],
  FAILED_NORPT: ['FAILED'],
  PAID: ['NOTICE_GENERATED'],
  NOTICE_GENERATED: ['NOTICE_SENT', 'NOTICE_STORED'],
  NOTICE_SENT: ['NOTIFIED'],
};

const RECIPIENT_FSM_ARCS: Readonly<Record<string, readonly string[]>> = {
  NOTICE_GENERATED: ['NOTICE_SENT'],
  NOTICE_SENT: ['NOTIFIED', 'NOTICE_PENDING'],
  NOTICE_PENDING: ['NOTICE_SENT'],
  NOTIFIED: [],
};

export function progressionStates(
  entity: 'logical' | 'attempt' | 'recipient',
  currentState: string,
  history: readonly TimelineItem[],
): { state: string; status: ProgressionStatus }[] {
  const states: readonly string[] =
    entity === 'logical' ? LOGICAL_STATES : entity === 'recipient' ? RECIPIENT_STATES : ATTEMPT_STATES;
  const arcs =
    entity === 'logical' ? LOGICAL_FSM_ARCS : entity === 'recipient' ? RECIPIENT_FSM_ARCS : ATTEMPT_FSM_ARCS;
  const reached = new Set(history.map(item => item.state));
  const reachable = new Set<string>();
  const pending = [...(arcs[currentState] ?? [])];
  while (pending.length) {
    const state = pending.pop();
    if (!state || reachable.has(state)) continue;
    reachable.add(state);
    pending.push(...(arcs[state] ?? []));
  }
  return states.map(state => ({
    state,
    status: state === currentState ? 'current'
      : reached.has(state) ? 'reached'
        : reachable.has(state) ? 'unreached'
          : 'not-in-branch',
  }));
}
