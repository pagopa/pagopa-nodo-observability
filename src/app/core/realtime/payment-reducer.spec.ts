import { applyPaymentDelta } from './payment-reducer';
import { Payment, TimelineItem } from '../../models/domain';

const transition = (state: string): TimelineItem => ({
  state,
  transitionAt: '2026-10-16T10:00:00.000Z',
  timestampBasis: 'SOURCE_EVENT',
});

const attempt = (attemptId: string, state: string) => ({
  attemptId,
  paFiscalCode: '00000000001',
  noticeNumber: '300000000000000001',
  tokenDisplay: '••••••••',
  state,
  warning: state === 'PAYMENT_UNKNOWN',
  hasAnomaly: false,
  serviceIdentifier: null,
  psp: null,
  stazione: null,
  canale: null,
  attemptStartedAt: null,
  startTimestampBasis: 'ANOMALY' as const,
  timelineIncomplete: false,
  timeline: [transition(state)],
  projectionRevision: 1,
});

const payment: Payment = {
  paFiscalCode: '00000000001',
  noticeNumber: '300000000000000001',
  state: 'PAYING',
  projectionRevision: 1,
  timelineIncomplete: false,
  hasAnomaly: false,
  warning: true,
  attemptCount: 1,
  timeline: [transition('PAYING')],
  attempts: [attempt('att_001_1', 'PAYMENT_UNKNOWN')],
  recipients: [],
};

describe('payment SSE delta reducer', () => {
  it('applies a contiguous delta and derives status without merging FSMs', () => {
    const result = applyPaymentDelta(payment, {
      projectionRevision: 2,
      changes: {
        logicalTransitions: [transition('PAID')],
        attemptChanges: [{ attemptId: 'att_001_1', transitions: [transition('PAID')], warning: false }],
        removedAttemptIds: [],
        deleted: false,
      },
    });
    expect(result.kind).toBe('applied');
    expect(result.payment?.state).toBe('PAID');
    expect(result.payment?.attempts[0].state).toBe('PAID');
    expect(result.payment?.warning).toBe(false);
  });

  it('deduplicates old revisions and requests one targeted resync on a gap', () => {
    const duplicate = applyPaymentDelta(payment, { projectionRevision: 1, changes: {} });
    const gap = applyPaymentDelta(payment, { projectionRevision: 3, changes: {} });
    expect(duplicate.kind).toBe('duplicate');
    expect(gap.kind).toBe('gap');
    expect(gap.payment).toBe(payment);
  });

  it('upserts a receipt recipient from a delta as a third entity', () => {
    const result = applyPaymentDelta(payment, {
      projectionRevision: 2,
      changes: {
        recipientChanges: [{
          recipientId: 'rcp_abc',
          transitions: [],
          upsert: {
            recipientId: 'rcp_abc',
            stazioneRecipient: 'STAZ-1',
            paFiscalCode: '00000000001',
            noticeNumber: '300000000000000001',
            state: 'NOTICE_GENERATED',
            timelineIncomplete: false,
            hasAnomaly: false,
            timeline: [transition('NOTICE_GENERATED')],
            projectionRevision: 2,
          },
        }],
      },
    });
    expect(result.kind).toBe('applied');
    expect(result.payment?.recipients.length).toBe(1);
    expect(result.payment?.recipients[0].state).toBe('NOTICE_GENERATED');
    expect(result.payment?.recipients[0].stazioneRecipient).toBe('STAZ-1');
  });

  it('appends recipient transitions and derives recipient state and anomaly', () => {
    const base = applyPaymentDelta(payment, {
      projectionRevision: 2,
      changes: {
        recipientChanges: [{
          recipientId: 'rcp_abc', transitions: [],
          upsert: {
            recipientId: 'rcp_abc', stazioneRecipient: 'STAZ-1',
            paFiscalCode: '00000000001', noticeNumber: '300000000000000001',
            state: 'NOTICE_GENERATED', timelineIncomplete: false, hasAnomaly: false,
            timeline: [transition('NOTICE_GENERATED')], projectionRevision: 2,
          },
        }],
      },
    }).payment as Payment;

    const result = applyPaymentDelta(base, {
      projectionRevision: 3,
      changes: {
        recipientChanges: [{
          recipientId: 'rcp_abc',
          transitions: [{ state: 'NOTICE_SENT', transitionAt: null, timestampBasis: 'ANOMALY' }],
        }],
      },
    });
    expect(result.kind).toBe('applied');
    expect(result.payment?.recipients[0].state).toBe('NOTICE_SENT');
    expect(result.payment?.recipients[0].hasAnomaly).toBe(true);
    expect(result.payment?.hasAnomaly).toBe(true);
  });

  it('removes a recipient on removedRecipientIds', () => {
    const base = applyPaymentDelta(payment, {
      projectionRevision: 2,
      changes: {
        recipientChanges: [{
          recipientId: 'rcp_abc', transitions: [],
          upsert: {
            recipientId: 'rcp_abc', stazioneRecipient: 'STAZ-1',
            paFiscalCode: '00000000001', noticeNumber: '300000000000000001',
            state: 'NOTICE_GENERATED', timelineIncomplete: false, hasAnomaly: false,
            timeline: [transition('NOTICE_GENERATED')], projectionRevision: 2,
          },
        }],
      },
    }).payment as Payment;

    const result = applyPaymentDelta(base, {
      projectionRevision: 3,
      changes: { removedRecipientIds: ['rcp_abc'] },
    });
    expect(result.kind).toBe('applied');
    expect(result.payment?.recipients.length).toBe(0);
  });

  it('requests resync instead of silently dropping a recipient update without its full identity', () => {
    const result = applyPaymentDelta(payment, {
      projectionRevision: 2,
      changes: { recipientChanges: [{ recipientId: 'missing', transitions: [transition('NOTICE_SENT')] }] },
    });
    expect(result.kind).toBe('gap');
    expect(result.payment).toBe(payment);
  });

  it('rejects recipient upserts belonging to another position', () => {
    const result = applyPaymentDelta(payment, {
      projectionRevision: 2,
      changes: { recipientChanges: [{
        recipientId: 'rcp_abc', transitions: [], upsert: {
          recipientId: 'rcp_abc', stazioneRecipient: 'STAZ-1',
          paFiscalCode: '00000000002', noticeNumber: payment.noticeNumber,
          state: 'NOTICE_SENT', timelineIncomplete: false, hasAnomaly: false,
          timeline: [transition('NOTICE_SENT')], projectionRevision: 2,
        },
      }] },
    });
    expect(result.kind).toBe('gap');
    expect(result.payment).toBe(payment);
  });

  it('preserves recipient retry occurrences, server order and independent archived position through corrections', () => {
    const base: Payment = {
      ...payment, state: 'NOTICE_STORED', timeline: [transition('NOTICE_STORED')],
      recipients: [{
        recipientId: 'rcp_abc', stazioneRecipient: 'STAZ-1',
        paFiscalCode: payment.paFiscalCode, noticeNumber: payment.noticeNumber,
        state: 'NOTICE_PENDING', timelineIncomplete: true, hasAnomaly: true, projectionRevision: 1,
        timeline: [transition('NOTICE_SENT'), { state: 'NOTICE_PENDING', transitionAt: null, timestampBasis: 'ANOMALY' }],
      }],
    };
    const result = applyPaymentDelta(base, {
      projectionRevision: 2, changes: { recipientChanges: [{
        recipientId: 'rcp_abc',
        patch: { timelineIncomplete: false },
        transitionCorrections: [{ index: 1, transition: transition('NOTICE_PENDING') }],
        transitions: [{ ...transition('NOTICE_SENT'), transitionAt: '2026-10-15T10:00:00.000Z' }, transition('NOTIFIED')],
      }] },
    });
    expect(result.kind).toBe('applied');
    expect(result.payment?.state).toBe('NOTICE_STORED');
    expect(result.payment?.recipients[0].timeline.map(t => t.state))
      .toEqual(['NOTICE_SENT', 'NOTICE_PENDING', 'NOTICE_SENT', 'NOTIFIED']);
    expect(result.payment?.recipients[0].hasAnomaly).toBe(false);
    expect(result.payment?.recipients[0].timelineIncomplete).toBe(false);
    expect(result.payment?.recipients[0].projectionRevision).toBe(2);
    expect(base.recipients[0].timeline[1].transitionAt).toBeNull();
    for (const correction of [
      { index: 99, transition: transition('NOTICE_PENDING') },
      { index: 1, transition: transition('NOTIFIED') },
    ]) {
      expect(applyPaymentDelta(base, {
        projectionRevision: 2, changes: { recipientChanges: [{
          recipientId: 'rcp_abc', transitions: [], transitionCorrections: [correction],
        }] },
      }).kind).toBe('gap');
    }
  });
});
