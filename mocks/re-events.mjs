import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DAY = 86_400_000;
const FIELDS = [
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
];
const iso = (at) => new Date(at).toISOString();
const fail = (status, code, message) => {
  throw Object.assign(new Error(message), { status, code });
};
const valid = (condition, message = 'Intervallo o cursore RE non valido.') => {
  if (!condition) fail(400, 'INVALID_REQUEST', message);
};
const utc = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  iso(Date.parse(value)).slice(0, 19) === value.slice(0, 19);

export function syntheticPayload(payload) {
  const result = {
    payload,
    payloadOmitted: false,
    payloadSourceBytes: payload === null ? null : Buffer.byteLength(payload),
  };
  const decoded = (status, text = null, reason = null) => ({
    ...result,
    payloadDecoded: { status, text, reason },
  });
  if (payload === null) return decoded('ABSENT');
  if (payload.length > 4 * Math.ceil((256 * 1024) / 3)) {
    return {
      ...decoded('TOO_LARGE', null, 'Limite 256 KiB decodificati.'),
      payload: null,
      payloadOmitted: true,
    };
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload))
    return decoded('INVALID_BASE64', null, 'Base64 non valido.');
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.toString('base64') !== payload)
    return decoded('INVALID_BASE64', null, 'Base64 non canonico.');
  if (bytes.length > 256 * 1024)
    return {
      ...decoded('TOO_LARGE', null, 'Limite 256 KiB decodificati.'),
      payload: null,
      payloadOmitted: true,
    };
  try {
    return decoded('DECODED', new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return decoded('INVALID_UTF8', null, 'UTF-8 non valido.');
  }
}

// Calls that carry no paymentToken (verifyPaymentNotice): they belong to the position, so they are
// returned only by the POSITION scope. One response is a KO (faultCode) to exercise the outcome column.
const POSITION_ONLY = [
  { sottoTipoEvento: 'REQ', tipoEvento: 'verifyPaymentNotice', payload: Buffer.from('<verifyPaymentNoticeReq/>').toString('base64') },
  { sottoTipoEvento: 'REQ', tipoEvento: 'paVerifyPaymentNotice', payload: Buffer.from('<paVerifyPaymentNoticeReq/>').toString('base64') },
  {
    sottoTipoEvento: 'RESP', tipoEvento: 'paVerifyPaymentNotice',
    payload: Buffer.from('<paVerifyPaymentNoticeRes><fault><faultCode>PAA_PAGAMENTO_SCADUTO</faultCode></fault></paVerifyPaymentNoticeRes>').toString('base64'),
  },
  {
    sottoTipoEvento: 'RESP', tipoEvento: 'verifyPaymentNotice',
    payload: Buffer.from('<verifyPaymentNoticeRes><fault><faultCode>PPT_PAGAMENTO_SCADUTO</faultCode></fault></verifyPaymentNoticeRes>').toString('base64'),
  },
];

function fixture(payment, attempt, scenario, start, position = false) {
  if (scenario === 'empty') return [];
  if (!Number.isFinite(start)) return [];
  const definitions = [
    {
      categoriaEvento: 'INTERFACCIA',
      sottoTipoEvento: 'REQ',
      status: null,
      tipoEvento: 'paSendRT',
      businessProcess: 'sendPaymentOutcome',
      esito: 'INVIATA',
      payload: Buffer.from(
        '<request>Pagamento sintetico è <script>not executed</script></request>',
      ).toString('base64'),
    },
    {
      categoriaEvento: 'INTERFACCIA',
      sottoTipoEvento: 'RESP',
      status: null,
      tipoEvento: 'paSendRT',
      businessProcess: 'sendPaymentOutcome',
      esito: 'RICEVUTA',
      payload: Buffer.from('{"synthetic":true}').toString('base64'),
    },
    {
      categoriaEvento: 'INTERNO',
      sottoTipoEvento: 'INTERN',
      status: 'payment_PAYING',
      tipoEvento: 'syntheticDiagnostic',
      businessProcess: 'syntheticDiagnostic',
      esito: 'CAMBIO_STATO',
      payload: null,
    },
    {
      categoriaEvento: 'INTERNO',
      sottoTipoEvento: 'INTERN',
      status: 'position_PAYING',
      tipoEvento: 'syntheticDiagnostic',
      businessProcess: 'syntheticDiagnostic',
      esito: 'CAMBIO_STATO',
      payload: '<base64>',
    },
    {
      categoriaEvento: 'INTERNO',
      sottoTipoEvento: 'INTERN',
      status: 'receipt_recipient_NOTICE_SENT',
      tipoEvento: 'syntheticDiagnostic',
      businessProcess: 'syntheticDiagnostic',
      esito: 'CAMBIO_STATO',
      payload: '/w==',
    },
    {
      categoriaEvento: 'SCONOSCIUTA',
      sottoTipoEvento: 'FUTURO',
      status: 'unknown_ORIGINAL',
      tipoEvento: 'syntheticDiagnostic',
      businessProcess: 'syntheticDiagnostic',
      esito: 'ORIGINALE',
      payload: 'A'.repeat(350000),
    },
  ];
  const extras = position && scenario !== 'limit' ? POSITION_ONLY : [];
  return Array.from({ length: extras.length + (scenario === 'limit' ? 1100 : definitions.length) }, (_, sequence) => {
    const extra = extras[sequence];
    const definition = extra
      ? { categoriaEvento: 'INTERFACCIA', status: null, businessProcess: 'verifyPaymentNotice', esito: null, paymentToken: null, ...extra }
      : definitions[(sequence - extras.length) % definitions.length];
    // Token-less calls precede the activation, so they sit before the first attempt event.
    const at = extra ? start - 300_000 + sequence : start + sequence - extras.length;
    const event = {
      ...Object.fromEntries(FIELDS.map((field) => [field, null])),
      insertedTimestamp: `${iso(at).slice(0, -1)}0000`,
      dataOraEvento: iso(at).slice(0, -1),
      idDominio: payment.paFiscalCode,
      noticeNumber: payment.noticeNumber,
      paymentToken: attempt.paymentToken,
      componente: 'SYNTHETIC',
      version: 1,
      standIn: false,
      uniqueId: `SYNTHETIC-RE-${attempt.attemptId}-${sequence}`,
      ...definition,
      ...syntheticPayload(definition.payload),
    };
    return { sequence, at, event };
  });
}

export function createReDiagnostics(clock) {
  const secret = randomBytes(32);
  const signature = (text) => createHmac('sha256', secret).update(text).digest('base64url');
  const sign = (value) => {
    const data = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${data}.${signature(data)}`;
  };
  const read = (cursor) => {
    valid(typeof cursor === 'string' && cursor.length <= 3000);
    const [data, mac, extra] = cursor.split('.');
    valid(data && mac && !extra);
    const expected = Buffer.from(signature(data));
    const actual = Buffer.from(mac);
    valid(expected.length === actual.length && timingSafeEqual(expected, actual));
    let value;
    try {
      value = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    } catch {
      fail(400, 'INVALID_REQUEST', 'Cursore RE non valido.');
    }
    valid(value.expires > clock());
    return value;
  };
  return (payment, attempt, body, scenario, actorId) => {
    valid(Object.keys(body).every((k) => ['from', 'to', 'cursor', 'scope'].includes(k)));
    valid(body.scope === undefined || ['ATTEMPT', 'POSITION'].includes(body.scope));
    const position = body.scope === 'POSITION';
    valid(utc(body.from) && utc(body.to));
    const from = Date.parse(body.from),
      to = Date.parse(body.to);
    valid(from < to && to - from <= DAY);
    const errors = {
      error: [502, 'RE_SOURCE_ERROR'],
      unconfigured: [503, 'RE_UNCONFIGURED'],
      timeout: [504, 'RE_TIMEOUT'],
      throttled: [429, 'RE_THROTTLED'],
    };
    if (errors[scenario])
      fail(...errors[scenario], 'Errore RE sintetico; nessuna interrogazione reale.');
    const cursor = body.cursor === undefined ? null : read(body.cursor);
    if (cursor)
      valid(
        cursor.attemptId === attempt.attemptId &&
          cursor.actorId === actorId &&
          cursor.from === body.from &&
          cursor.to === body.to &&
          cursor.position === position,
      );
    const watermark = cursor?.watermark ?? clock();
    const actualFrom = Math.max(from, watermark - 30 * DAY),
      actualTo = Math.min(to, watermark);
    if (actualFrom >= actualTo) {
      return {
        attemptId: attempt.attemptId,
        source: 'RE',
        retrievedAt: iso(clock()),
        window: { from: body.from, to: body.to },
        coverage: 'WINDOW_ONLY',
        events: [],
        nextCursor: null,
        truncated: false,
        warnings: [
          'Simulazione: dati esclusivamente sintetici; nessuna chiamata ADX.',
          to <= watermark - 30 * DAY ? 'OUTSIDE_RETENTION' : 'OUTSIDE_AVAILABLE_WINDOW',
        ],
      };
    }
    const seed =
      cursor?.seed ??
      Date.parse(
        attempt.attemptStartedAt ?? attempt.timeline.find((e) => e.transitionAt)?.transitionAt,
      );
    const rows = fixture(payment, attempt, cursor?.scenario ?? scenario, seed, position).filter(
      (row) => row.at >= actualFrom && row.at < actualTo && row.at <= watermark,
    );
    const eligible = rows.filter((row) => row.sequence > (cursor?.last ?? -1));
    const count = cursor?.count ?? 0;
    const page = eligible.slice(0, Math.min(100, 1000 - count));
    const total = count + page.length;
    const truncated = total === 1000 && eligible.length > page.length;
    const nextCursor =
      !truncated && eligible.length > page.length
        ? sign({
            attemptId: attempt.attemptId,
            actorId,
            from: body.from,
            to: body.to,
            watermark,
            scenario: cursor?.scenario ?? scenario,
            seed,
            position,
            count: total,
            last: page.at(-1).sequence,
            expires: cursor?.expires ?? clock() + 5 * 60000,
          })
        : null;
    const clipped = actualFrom !== from || actualTo !== to;
    return {
      attemptId: attempt.attemptId,
      source: 'RE',
      retrievedAt: iso(clock()),
      window: { from: iso(actualFrom), to: iso(actualTo) },
      coverage: truncated ? 'LIMIT_REACHED' : clipped ? 'RETENTION_CLIPPED' : 'WINDOW_ONLY',
      events: page.map((row) => row.event),
      nextCursor,
      truncated,
      warnings: [
        'Simulazione: dati esclusivamente sintetici; nessuna chiamata ADX.',
        ...(position ? ['POSITION_SCOPE'] : ['Solo PA + NAV + paymentToken; eventi senza una delle chiavi non recuperati.']),
        ...(clipped
          ? ['Intervallo limitato alla retention RE simulata e all’ora del recupero.']
          : []),
        ...(truncated ? ['Limite 1.000 eventi raggiunto.'] : []),
      ],
    };
  };
}
