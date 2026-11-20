import {
  ATTEMPT_STATES,
  formatInstant,
  LOGICAL_STATES,
  RECIPIENT_STATES,
  TimelineItem,
} from './domain';
import {
  StateEntity,
  StatePresentation,
  stateFilterGroups,
  statePresentation,
} from './state-presentation';

export interface ObservedVisit {
  readonly id: number;
  readonly presentation: StatePresentation;
  readonly status: 'Osservato' | 'Corrente' | 'Inferito';
  readonly time: string;
  readonly trigger: string;
  readonly provenance: 'Evento sorgente' | 'Inferito' | 'Anomalia';
}
export interface DocumentedArc {
  readonly from: StatePresentation;
  readonly to: StatePresentation;
  readonly condition: string;
  readonly applicability: 'documented' | 'unconfirmed';
}
export interface DocumentedSchema {
  readonly phases: ReturnType<typeof stateFilterGroups>;
  readonly arcs: readonly DocumentedArc[];
  readonly notes: readonly string[];
}
export interface StateProgression {
  readonly current: StatePresentation;
  readonly visits: readonly ObservedVisit[];
  readonly schema: DocumentedSchema;
}

type ArcDefinition = readonly [string, string, string, 'unconfirmed'?];
const LOGICAL_ARCS: readonly ArcDefinition[] = [
  ['INSERTED', 'PAYING', 'activatePaymentNotice V1/V2: nuovo tentativo'],
  [
    'PAYING',
    'INSERTED',
    'Request closePayment V1/V2 (eCommerce→Nodo) con outcome=KO; annullo di validazione closePaymentV2 su PA OLD senza RPT (request ricevuta, Nodo risponde 422 KO); request sendPaymentResult V1/V2 (Nodo→eCommerce) con outcome=KO; request sendPaymentOutcome V1/V2 (PSP→Nodo) con outcome=KO (solo NM3); mod3CancelV2: scadenza NMU se tutti i token del gruppo sono ancora PAYMENT_UNKNOWN',
  ],
  ['PAYING', 'PAID', 'sendPaymentOutcome V1/V2 positivo'],
  ['PAID', 'NOTICE_STORED', 'Percorso legacy/RPT, NodoInviaRPT: archiviazione ricevuta'],
  [
    'PAID',
    'NOTIFIED',
    'Risposta intelligibile PA intestataria (OK o KO), alle condizioni multibeneficiario previste',
  ],
];
const ATTEMPT_ARCS: readonly ArcDefinition[] = [
  [
    'PAYING',
    'CANCELLED',
    'Request closePayment V1/V2 (eCommerce→Nodo) con outcome=KO; annullo di validazione closePaymentV2 su PA OLD senza RPT (Nodo response 422 KO)',
  ],
  ['PAYING', 'PAYMENT_RESERVED', 'closePayment OK V1/V2'],
  ['PAYMENT_RESERVED', 'PAYMENT_SENT', 'Invio pspNotifyPayment V1/V2'],
  ['PAYMENT_SENT', 'PAYMENT_ACCEPTED', 'Risposta PSP OK: accettazione, non saldo'],
  ['PAYMENT_SENT', 'PAYMENT_REFUSED', 'Risposta PSP KO esplicita'],
  ['PAYMENT_SENT', 'PAYMENT_UNKNOWN', 'Timeout / risposta assente o non determinabile'],
  ['PAYMENT_SENT', 'PAYMENT_SEND_ERROR', 'Altro errore di invio'],
  ['PAYMENT_ACCEPTED', 'PAID', 'sendPaymentOutcome V1/V2 positivo'],
  ['PAYMENT_REFUSED', 'CANCELLED', 'Request sendPaymentResult V1/V2 (Nodo→eCommerce) con outcome=KO'],
  ['PAYMENT_SEND_ERROR', 'CANCELLED', 'Request sendPaymentResult V1/V2 (Nodo→eCommerce) con outcome=KO'],
  ['PAYMENT_UNKNOWN', 'PAID', 'sendPaymentOutcome V1/V2 positivo: risoluzione'],
  [
    'PAYMENT_UNKNOWN',
    'CANCELLED',
    'mod3CancelV2: scadenza e tutti i token del gruppo ancora UNKNOWN',
  ],
  ['PAYING', 'PAID', 'Outcome diretto NM3 positivo, senza prenotazione PSP'],
  [
    'PAYING',
    'FAILED',
    'Request sendPaymentOutcome V1/V2 (PSP→Nodo) con outcome=KO, solo NM3; non è un KO della response',
  ],
  ['PAID', 'NOTICE_GENERATED', 'Generazione receipt positiva'],
  ['NOTICE_GENERATED', 'NOTICE_STORED', 'Archiviazione nel percorso legacy/RPT applicabile'],
  [
    'NOTICE_GENERATED',
    'NOTICE_SENT',
    'Invio paSendRT V1/V2 alla PA intestataria, quando abilitato',
  ],
  [
    'NOTICE_SENT',
    'NOTIFIED',
    'Risposte intellegibili (OK o KO) di tutti i destinatari previsti: condizione Nodo, non deducibile dai record disponibili al client',
  ],
  [
    'NOTICE_STORED',
    'NOTICE_SENT',
    'PDF: applicabilità da confermare sul ramo/versione Nodo; non è un arco operativo di raggiungibilità',
    'unconfirmed',
  ],
  [
    'PAYING_RPT',
    'CANCELLED',
    'request closePaymentV2 (eCommerce→Nodo) con outcome=KO, percorso PA OLD',
  ],
  ['PAYING_RPT', 'PAYMENT_RESERVED', 'closePaymentV2 OK su PA OLD con RPT presente'],
  ['PAID_NORPT', 'PAID', 'NodoInviaRPT: completamento differito'],
  ['PAID_NORPT', 'NOTICE_GENERATED', 'NodoInviaRPT: generazione differita secondo percorso'],
  ['PAID_NORPT', 'NOTICE_STORED', 'NodoInviaRPT: archiviazione secondo percorso'],
  ['FAILED_NORPT', 'FAILED', 'NodoInviaRPT: completamento outcome negativo'],
  ['CANCELLED_NORPT', 'CANCELLED', 'Completamento annullo legacy'],
  ...['PAYING', 'PAYING_RPT', 'CANCELLED_NORPT'].flatMap((from) =>
    ['PAID', 'PAID_NORPT', 'FAILED', 'FAILED_NORPT'].map(
      (to) =>
        [
          from,
          to,
          `Outcome ${to.startsWith('PAID') ? 'positivo' : 'negativo'} legacy secondo versione e disponibilità RPT`,
        ] as const,
    ),
  ),
];
const RECIPIENT_ARCS: readonly ArcDefinition[] = [
  ['NOTICE_GENERATED', 'NOTICE_SENT', 'Invio paSendRT V1/V2 a questo destinatario'],
  ['NOTICE_SENT', 'NOTIFIED', 'Risposta intelligibile di questo destinatario (OK o KO)'],
  ['NOTICE_SENT', 'NOTICE_PENDING', 'Timeout / errore / PA irraggiungibile'],
  ['NOTICE_PENDING', 'NOTICE_SENT', 'Retry asincrono del Nodo'],
];

export function documentedSchema(entity: StateEntity): DocumentedSchema {
  const codes =
    entity === 'logical'
      ? LOGICAL_STATES
      : entity === 'attempt'
        ? ATTEMPT_STATES
        : RECIPIENT_STATES;
  const definitions =
    entity === 'logical' ? LOGICAL_ARCS : entity === 'attempt' ? ATTEMPT_ARCS : RECIPIENT_ARCS;
  const unique = new Map<string, ArcDefinition>();
  for (const arc of definitions) {
    const key = `${arc[0]}:${arc[1]}`;
    if (!unique.has(key)) unique.set(key, arc);
  }
  return {
    phases: stateFilterGroups(entity, codes),
    arcs: [...unique.values()].map(([from, to, condition, applicability]) => ({
      from: statePresentation(entity, from),
      to: statePresentation(entity, to),
      condition,
      applicability: applicability ?? 'documented',
    })),
    notes:
      entity === 'logical'
        ? [
            'La posizione può nascere direttamente in PAYING. Un annullo riapre INSERTED; non esiste uno stato logico CANCELLED.',
            'NOTICE_STORED e NOTIFIED sono rami distinti: nessun arco da archiviazione a notifica della posizione.',
          ]
        : entity === 'attempt'
          ? [
              'PAYING e PAYING_RPT sono raggruppati nella fase di attivazione ma restano stati distinti. PAYING_RPT: ingresso all’arrivo RPT da confermare; CANCELLED_NORPT: ingresso annullo senza RPT da confermare. Nessun arco di ingresso è dedotto.',
              'V1 PA OLD può creare direttamente PAYMENT_RESERVED: non si inventa un precedente PAYING.',
              'NOTICE_STORED resta terminale nel grafo operativo locale. Il PDF descrive un successivo invio con applicabilità da confermare: gate Nodo irrisolto. La storia osservata viene sempre mostrata integralmente.',
              'CANCELLED chiude il singolo tentativo; una nuova attivazione usa un altro token. FAILED indica outcome negativo, non annullo.',
              'Con invio stand-in disabilitato la generazione non implica invio, errore o retry.',
            ]
          : [
              'Destinatari della posizione, senza associazione al token o attribuzione della PA intestataria dal client.',
              'Ogni destinatario ha il proprio ciclo di retry. NOTIFIED non implica esito applicativo PA positivo.',
            ],
  };
}

export function buildStateProgression(
  entity: StateEntity,
  current: string,
  history: readonly TimelineItem[],
  timeZone: string,
): StateProgression {
  return {
    current: statePresentation(entity, current),
    visits: history.map((item, index) => ({
      id: index,
      presentation: statePresentation(entity, item.state),
      status:
        index === history.length - 1 && item.state === current
          ? 'Corrente'
          : item.timestampBasis === 'INFERRED'
            ? 'Inferito'
            : 'Osservato',
      time:
        item.timestampBasis === 'ANOMALY'
          ? 'Data-ora non disponibile'
          : formatInstant(item.transitionAt, timeZone),
      trigger: item.trigger || 'Trigger non disponibile',
      provenance:
        item.timestampBasis === 'SOURCE_EVENT'
          ? 'Evento sorgente'
          : item.timestampBasis === 'INFERRED'
            ? 'Inferito'
            : 'Anomalia',
    })),
    schema: documentedSchema(entity),
  };
}
