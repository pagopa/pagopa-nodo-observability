import { Attempt, Payment, Recipient, TimelineItem } from '../../models/domain';

interface AttemptChange {
  attemptId: string;
  transitions: TimelineItem[];
  warning: boolean;
  upsert?: Attempt;
  patch?: Partial<Attempt>;
  transitionCorrections?: { index: number; transition: TimelineItem }[];
}

interface RecipientChange {
  recipientId: string;
  transitions: TimelineItem[];
  upsert?: Recipient;
  patch?: Partial<Pick<Recipient, 'stazioneRecipient' | 'timelineIncomplete'>>;
  transitionCorrections?: { index: number; transition: TimelineItem }[];
}

export interface PaymentDelta {
  projectionRevision: number;
  changes: {
    logicalTransitions?: TimelineItem[];
    logicalTransitionCorrections?: { index: number; transition: TimelineItem }[];
    attemptChanges?: AttemptChange[];
    removedAttemptIds?: string[];
    recipientChanges?: RecipientChange[];
    removedRecipientIds?: string[];
    deleted?: boolean;
    timelineIncomplete?: boolean;
  };
}

export interface PaymentReduction {
  kind: 'applied' | 'duplicate' | 'gap' | 'deleted';
  payment: Payment | null;
}

const WARNING_STATES = new Set(['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR']);

export function applyPaymentDelta(payment: Payment, delta: PaymentDelta): PaymentReduction {
  if (delta.projectionRevision <= payment.projectionRevision) return { kind: 'duplicate', payment };
  if (delta.projectionRevision !== payment.projectionRevision + 1) return { kind: 'gap', payment };

  const changes = delta.changes;
  if (changes.deleted) return { kind: 'deleted', payment: null };

  let attempts = payment.attempts.filter(attempt => !changes.removedAttemptIds?.includes(attempt.attemptId));
  for (const change of changes.attemptChanges ?? []) {
    const currentIndex = attempts.findIndex(attempt => attempt.attemptId === change.attemptId);
    if (change.upsert) {
      const previousIndex = currentIndex;
      const upsert = change.upsert;
      if (previousIndex < 0) attempts = [...attempts, upsert];
      else attempts = attempts.map((attempt, index) => index === previousIndex ? upsert : attempt);
      continue;
    }
    if (currentIndex < 0) continue;
    attempts = attempts.map((attempt, index) => {
      if (index !== currentIndex) return attempt;
      const timeline = [...attempt.timeline];
      for (const correction of change.transitionCorrections ?? []) {
        if (correction.index >= 0 && correction.index < timeline.length) timeline[correction.index] = correction.transition;
      }
      timeline.push(...change.transitions);
      const patched = { ...attempt, ...change.patch, timeline };
      const state = timeline.at(-1)?.state ?? patched.state;
      return {
        ...patched,
        state,
        warning: WARNING_STATES.has(state),
        hasAnomaly: timeline.some(item => item.timestampBasis === 'ANOMALY'),
      };
    });
  }

  if (!Array.isArray(payment.recipients)) return { kind: 'gap', payment };
  let recipients = payment.recipients.filter(
    recipient => !changes.removedRecipientIds?.includes(recipient.recipientId),
  );
  for (const change of changes.recipientChanges ?? []) {
    const currentIndex = recipients.findIndex(recipient => recipient.recipientId === change.recipientId);
    if (change.upsert) {
      const upsert = change.upsert;
      if (upsert.recipientId !== change.recipientId || upsert.paFiscalCode !== payment.paFiscalCode
        || upsert.noticeNumber !== payment.noticeNumber || change.transitions.length
        || change.patch || change.transitionCorrections) return { kind: 'gap', payment };
      if (currentIndex < 0) recipients = [...recipients, upsert];
      else recipients = recipients.map((recipient, index) => (index === currentIndex ? upsert : recipient));
      continue;
    }
    if (currentIndex < 0) return { kind: 'gap', payment };
    const corrections = change.transitionCorrections ?? [];
    if (new Set(corrections.map(correction => correction.index)).size !== corrections.length
      || corrections.some(correction => !Number.isInteger(correction.index) || correction.index < 0
        || recipients[currentIndex].timeline[correction.index]?.state !== correction.transition.state)) {
      return { kind: 'gap', payment };
    }
    recipients = recipients.map((recipient, index) => {
      if (index !== currentIndex) return recipient;
      const timeline = [...recipient.timeline];
      for (const correction of change.transitionCorrections ?? []) {
        if (correction.index >= 0 && correction.index < timeline.length) timeline[correction.index] = correction.transition;
      }
      timeline.push(...change.transitions);
      const patched = { ...recipient, ...change.patch, timeline };
      return {
        ...patched,
        state: timeline.at(-1)?.state ?? patched.state,
        hasAnomaly: timeline.some(item => item.timestampBasis === 'ANOMALY'),
      };
    });
  }

  const logicalTimeline = [...payment.timeline];
  for (const correction of changes.logicalTransitionCorrections ?? []) {
    if (correction.index >= 0 && correction.index < logicalTimeline.length) logicalTimeline[correction.index] = correction.transition;
  }
  logicalTimeline.push(...(changes.logicalTransitions ?? []));
  const revision = delta.projectionRevision;
  const revisedAttempts = attempts.map(attempt => ({ ...attempt, projectionRevision: revision }));
  const revisedRecipients = recipients.map(recipient => ({ ...recipient, projectionRevision: revision }));
  const state = logicalTimeline.at(-1)?.state ?? payment.state;
  const result: Payment = {
    ...payment,
    state,
    timeline: logicalTimeline,
    attempts: revisedAttempts,
    recipients: revisedRecipients,
    projectionRevision: revision,
    ...(changes.timelineIncomplete === undefined ? {} : { timelineIncomplete: changes.timelineIncomplete }),
    attemptCount: revisedAttempts.length,
    warning: revisedAttempts.some(attempt => attempt.warning),
    hasAnomaly: logicalTimeline.some(item => item.timestampBasis === 'ANOMALY')
      || revisedAttempts.some(attempt => attempt.hasAnomaly)
      || revisedRecipients.some(recipient => recipient.hasAnomaly),
  };
  return { kind: 'applied', payment: result };
}
