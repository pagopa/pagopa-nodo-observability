import { Payment } from '../../models/domain';
import { buildStateProgression } from '../../models/state-progression';

export function paymentDetailPresentation(
  payment: Payment,
  selectedAttemptId: string,
  timeZone: string,
) {
  const recipientsAvailable = Array.isArray(payment.recipients);
  const explanations: string[] = [];
  if (
    payment.state === 'NOTIFIED' &&
    payment.attempts.some((attempt) => attempt.state === 'NOTICE_SENT')
  ) {
    explanations.push(
      'La posizione può essere NOTIFIED sulla risposta intelligibile della PA intestataria mentre un tentativo resta NOTICE_SENT: il tentativo attende le risposte di tutti i destinatari previsti, secondo le condizioni del servizio. Non si deduce la completezza dai destinatari visibili.',
    );
  }
  if (
    payment.state === 'NOTICE_STORED' &&
    payment.attempts.some((attempt) => attempt.state === 'NOTIFIED')
  ) {
    explanations.push('La posizione resta archiviata anche dopo la consegna');
  }
  return {
    logical: buildStateProgression('logical', payment.state, payment.timeline, timeZone),
    attempts: payment.attempts.map((attempt) => ({
      id: attempt.attemptId,
      incomplete: attempt.timelineIncomplete,
      progression: buildStateProgression('attempt', attempt.state, attempt.timeline, timeZone),
    })),
    recipients: recipientsAvailable
      ? payment.recipients.map((recipient) => ({
          id: recipient.recipientId,
          progression: buildStateProgression(
            'recipient',
            recipient.state,
            recipient.timeline,
            timeZone,
          ),
        }))
      : null,
    recipientError: recipientsAvailable
      ? null
      : 'Destinatari non disponibili: contratto del servizio assente o non valido. Impossibile determinare la storia di consegna.',
    selectedAttemptUnavailable:
      Boolean(selectedAttemptId) &&
      !payment.attempts.some((attempt) => attempt.attemptId === selectedAttemptId),
    explanations,
  };
}
