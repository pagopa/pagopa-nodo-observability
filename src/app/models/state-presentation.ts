import type { AttemptState, CountRow, LogicalState, RecipientState } from './domain';

export type StateEntity = 'logical' | 'attempt' | 'recipient';
export type StateTreatment = 'info' | 'ok' | 'warn' | 'mute';
export const STATE_PHASES = [
  { phase: 'activation', label: 'Attivazione' },
  { phase: 'psp', label: 'Prenotazione e notifica PSP' },
  { phase: 'outcome', label: 'Esito del pagamento' },
  { phase: 'receipt', label: 'Generazione e archiviazione ricevuta' },
  { phase: 'delivery', label: 'Consegna ricevuta' },
  { phase: 'unknown', label: 'Stati non riconosciuti' },
] as const;
export type StatePhase = (typeof STATE_PHASES)[number]['phase'];

export interface StatePresentation {
  readonly entity: StateEntity;
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly phase: StatePhase;
  readonly treatment: StateTreatment;
}

function entry(
  entity: StateEntity,
  code: string,
  label: string,
  description: string,
  phase: StatePhase,
  treatment: StateTreatment,
): StatePresentation {
  return { entity, code, label, description, phase, treatment };
}

export const LOGICAL_PRESENTATIONS = {
  INSERTED: entry(
    'logical',
    'INSERTED',
    'Inserito',
    'Posizione inserita o riaperta; il solo stato non dimostra un precedente tentativo.',
    'activation',
    'mute',
  ),
  PAYING: entry(
    'logical',
    'PAYING',
    'In pagamento',
    'Posizione in pagamento dopo l’attivazione; può nascere direttamente in questo stato.',
    'activation',
    'info',
  ),
  PAID: entry(
    'logical',
    'PAID',
    'Pagato',
    'Esito positivo del pagamento della posizione; la consegna della ricevuta è una fase distinta.',
    'outcome',
    'ok',
  ),
  NOTICE_STORED: entry(
    'logical',
    'NOTICE_STORED',
    'Ricevuta archiviata',
    'Posizione archiviata nel percorso legacy/RPT. Non prova la consegna alla PA e non passa a NOTIFIED.',
    'receipt',
    'ok',
  ),
  NOTIFIED: entry(
    'logical',
    'NOTIFIED',
    'Notificato',
    'Risposta intelligibile della PA intestataria, con le condizioni multibeneficiario previste; OK o KO, non prova un esito applicativo positivo.',
    'delivery',
    'ok',
  ),
} satisfies Record<LogicalState, StatePresentation>;

export const ATTEMPT_PRESENTATIONS = {
  PAYING: entry(
    'attempt',
    'PAYING',
    'In pagamento',
    'Tentativo attivato, in attesa del percorso di prenotazione PSP o dell’esito diretto.',
    'activation',
    'info',
  ),
  PAYING_RPT: entry(
    'attempt',
    'PAYING_RPT',
    'In pagamento (RPT)',
    'Tentativo legacy con RPT; ingresso all’arrivo della RPT da confermare. Non è un alias di PAYING.',
    'activation',
    'info',
  ),
  PAYMENT_RESERVED: entry(
    'attempt',
    'PAYMENT_RESERVED',
    'Pagamento prenotato',
    'Prenotazione con closePayment OK V1/V2; V1 PA OLD può creare direttamente il tentativo in questo stato.',
    'psp',
    'info',
  ),
  PAYMENT_SENT: entry(
    'attempt',
    'PAYMENT_SENT',
    'Inviato al PSP',
    'Richiesta di notifica pagamento inviata al PSP; attende una delle quattro alternative di risposta.',
    'psp',
    'info',
  ),
  PAYMENT_ACCEPTED: entry(
    'attempt',
    'PAYMENT_ACCEPTED',
    'Accettato dal PSP',
    'Accettato dal PSP, in attesa dell’esito del pagamento',
    'psp',
    'info',
  ),
  PAYMENT_REFUSED: entry(
    'attempt',
    'PAYMENT_REFUSED',
    'Rifiutato dal PSP',
    'Risposta PSP KO esplicita; distinta da un esito del pagamento fallito. Può seguire l’annullo.',
    'psp',
    'mute',
  ),
  PAYMENT_UNKNOWN: entry(
    'attempt',
    'PAYMENT_UNKNOWN',
    'Pagamento non risolto',
    'Esito PSP non determinabile o risposta assente: non è un KO terminale. Attende risoluzione dal Nodo.',
    'psp',
    'warn',
  ),
  PAYMENT_SEND_ERROR: entry(
    'attempt',
    'PAYMENT_SEND_ERROR',
    'Errore di invio',
    'Errore di invio della notifica PSP: stato non risolto finché non evolve, senza annullo locale.',
    'psp',
    'warn',
  ),
  PAID_NORPT: entry(
    'attempt',
    'PAID_NORPT',
    'Pagato (senza RPT)',
    'Outcome positivo nel percorso legacy senza RPT; gestione differita della ricevuta con NodoInviaRPT.',
    'outcome',
    'ok',
  ),
  PAID: entry(
    'attempt',
    'PAID',
    'Pagato',
    'Esito positivo del pagamento del tentativo; non equivale alla sola accettazione PSP né alla consegna ricevuta.',
    'outcome',
    'ok',
  ),
  FAILED_NORPT: entry(
    'attempt',
    'FAILED_NORPT',
    'Fallito (senza RPT)',
    'Outcome negativo legacy senza RPT; distinto dall’annullo, completato successivamente con NodoInviaRPT.',
    'outcome',
    'mute',
  ),
  FAILED: entry(
    'attempt',
    'FAILED',
    'Fallito',
    'Esito negativo del pagamento nel percorso diretto NM3 o legacy. È distinto da CANCELLED e dal rifiuto PSP.',
    'outcome',
    'mute',
  ),
  CANCELLED: entry(
    'attempt',
    'CANCELLED',
    'Annullato',
    'Tentativo chiuso per annullo; la posizione può riaprirsi con un nuovo token, senza riaprire questo tentativo.',
    'outcome',
    'mute',
  ),
  CANCELLED_NORPT: entry(
    'attempt',
    'CANCELLED_NORPT',
    'Annullato (senza RPT)',
    'Annullo legacy senza RPT; ingresso nel ramo da confermare. Stato distinto da CANCELLED.',
    'outcome',
    'mute',
  ),
  NOTICE_GENERATED: entry(
    'attempt',
    'NOTICE_GENERATED',
    'Ricevuta generata',
    'Ricevuta positiva generata dopo l’outcome o la gestione differita della RPT; non prova l’invio.',
    'receipt',
    'ok',
  ),
  NOTICE_STORED: entry(
    'attempt',
    'NOTICE_STORED',
    'Ricevuta archiviata',
    'Ricevuta conservata nel ramo legacy/RPT; consegna successiva descritta nel PDF con applicabilità da confermare.',
    'receipt',
    'ok',
  ),
  NOTICE_SENT: entry(
    'attempt',
    'NOTICE_SENT',
    'Ricevuta inviata',
    'Invio alla PA intestataria; il tentativo attende le risposte di tutti i destinatari previsti, non un conteggio dedotto dal client.',
    'delivery',
    'info',
  ),
  NOTIFIED: entry(
    'attempt',
    'NOTIFIED',
    'Notificato',
    'Risposte intellegibili da tutti i destinatari previsti, secondo le condizioni del servizio; OK o KO, non prova esito applicativo PA positivo.',
    'delivery',
    'ok',
  ),
} satisfies Record<AttemptState, StatePresentation>;

export const RECIPIENT_PRESENTATIONS = {
  NOTICE_GENERATED: entry(
    'recipient',
    'NOTICE_GENERATED',
    'Ricevuta generata',
    'Ricevuta generata per il destinatario della posizione; non identifica un token.',
    'receipt',
    'ok',
  ),
  NOTICE_SENT: entry(
    'recipient',
    'NOTICE_SENT',
    'Ricevuta inviata',
    'Primo invio o retry della ricevuta verso il destinatario, in attesa di risposta.',
    'delivery',
    'info',
  ),
  NOTICE_PENDING: entry(
    'recipient',
    'NOTICE_PENDING',
    'Notifica in sospeso',
    'Timeout, errore o destinatario irraggiungibile; è previsto retry verso il destinatario, non un nuovo stato del tentativo.',
    'delivery',
    'info',
  ),
  NOTIFIED: entry(
    'recipient',
    'NOTIFIED',
    'Notificato',
    'Risposta intelligibile ricevuta dal destinatario, OK o KO; non prova esito applicativo positivo.',
    'delivery',
    'ok',
  ),
} satisfies Record<RecipientState, StatePresentation>;

const CATALOGS: Record<StateEntity, Readonly<Record<string, StatePresentation>>> = {
  logical: LOGICAL_PRESENTATIONS,
  attempt: ATTEMPT_PRESENTATIONS,
  recipient: RECIPIENT_PRESENTATIONS,
};

export function statePresentation(entity: StateEntity, code: string): StatePresentation {
  return (
    CATALOGS[entity][code] ??
    entry(
      entity,
      code,
      code,
      'Codice originale non riconosciuto per questa entità; significato e percorso non disponibili.',
      'unknown',
      'mute',
    )
  );
}

export function stateFilterGroups(entity: StateEntity, codes: readonly string[]) {
  const states = codes.map((code) => statePresentation(entity, code));
  return STATE_PHASES.map((phase) => ({
    ...phase,
    states: states.filter((state) => state.phase === phase.phase),
  })).filter((group) => group.states.length > 0);
}

export function positiveStateCounts(entity: StateEntity, rows: readonly CountRow[]) {
  return rows
    .filter((row) => row.count > 0)
    .map((row) => ({
      presentation: statePresentation(entity, row.state),
      count: row.count,
    }));
}
