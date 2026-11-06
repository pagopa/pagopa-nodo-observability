import { paymentDetailPresentation } from './payment-detail-presentation';
import { Payment } from '../../models/domain';

const payment = {
  state: 'NOTICE_STORED',
  timeline: [],
  attempts: [
    { attemptId: 'available-id', state: 'NOTIFIED', timeline: [], timelineIncomplete: true },
  ],
  recipients: [],
  timelineIncomplete: false,
} as unknown as Payment;

describe('payment detail presentation', () => {
  it('uses only available attempt ids, no absolute historic numbering or causal attribution', () => {
    const model = paymentDetailPresentation(payment, 'expired-id', 'UTC');
    expect(model.attempts[0].id).toBe('available-id');
    expect(model.selectedAttemptUnavailable).toBe(true);
    expect(model.explanations).toContain('La posizione resta archiviata anche dopo la consegna');
    expect(model.attempts[0].incomplete).toBe(true);
    expect(model.recipientError).toBeNull();
  });

  it('explains distinct primary PA and all expected recipients conditions without x/y counts', () => {
    const model = paymentDetailPresentation(
      {
        ...payment,
        state: 'NOTIFIED',
        attempts: [{ ...payment.attempts[0], state: 'NOTICE_SENT' }],
      },
      '',
      'UTC',
    );
    expect(model.explanations.join(' ')).toContain('PA intestataria');
    expect(model.explanations.join(' ')).toContain('tutti i destinatari previsti');
    expect(model.explanations.join(' ')).toContain('servizio');
    expect(model.selectedAttemptUnavailable).toBe(false);
  });

  it('does not disguise an absent recipient contract as a valid empty collection', () => {
    const model = paymentDetailPresentation(
      { ...payment, recipients: undefined } as unknown as Payment,
      '',
      'UTC',
    );
    expect(model.recipientError).toContain('Destinatari non disponibili');
    expect(model.recipients).toBeNull();
  });
});
