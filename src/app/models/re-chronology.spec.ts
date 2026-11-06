import { buildChronology, eventKind, responseOutcome, stateEntity } from './re-chronology';
import { RE_FIELDS, ReEvent } from './re-event';

const event = (patch: Partial<ReEvent>): ReEvent =>
  ({
    ...Object.fromEntries(RE_FIELDS.map((field) => [field, null])),
    payload: null,
    payloadDecoded: { status: 'ABSENT', text: null, reason: null },
    payloadOmitted: false,
    payloadSourceBytes: null,
    categoriaEvento: 'INTERFACCIA',
    ...patch,
  }) as unknown as ReEvent;

describe('RE chronology', () => {
  it('classifies events without relying on the esito column, which the source does not expose', () => {
    expect(eventKind(event({ sottoTipoEvento: 'REQ' }))).toBe('request');
    expect(eventKind(event({ sottoTipoEvento: 'RESP' }))).toBe('response');
    expect(eventKind(event({ categoriaEvento: 'INTERNO', status: 'payment_PAYING' }))).toBe('state-change');
    expect(eventKind(event({ categoriaEvento: 'INTERNO', sottoTipoEvento: 'INTERN' }))).toBe('other');
  });

  it('names the entity of a state change and keeps the original status', () => {
    expect(stateEntity('payment_PAYING')).toBe('Tentativo');
    expect(stateEntity('position_PAID')).toBe('Posizione');
    expect(stateEntity('receipt_recipient_NOTIFIED')).toBe('Destinatario');
    expect(stateEntity('unknown_FUTURE')).toBeNull();
    const [row] = buildChronology([event({ status: 'payment_UNKNOWN_FUTURE', tipoEvento: 'x' })]);
    expect(row.status).toBe('payment_UNKNOWN_FUTURE');
  });

  it('flags only the unmatched requests of the same primitive and session', () => {
    const rows = buildChronology([
      event({ sottoTipoEvento: 'REQ', tipoEvento: 'pspNotifyPayment', sessionId: 'a' }),
      event({ sottoTipoEvento: 'RESP', tipoEvento: 'pspNotifyPayment', sessionId: 'a' }),
      event({ sottoTipoEvento: 'REQ', tipoEvento: 'pspNotifyPayment', sessionId: 'a' }),
      event({ sottoTipoEvento: 'REQ', tipoEvento: 'pspNotifyPayment', sessionId: 'b' }),
      event({ sottoTipoEvento: 'RESP', tipoEvento: 'paGetPayment', sessionId: 'b' }),
    ]);
    expect(rows.map((row) => row.unanswered)).toEqual([false, false, true, true, false]);
  });

  describe('outcome from the decoded payload', () => {
    const response = (text: string | null, status: 'DECODED' | 'ABSENT' | 'TOO_LARGE' = 'DECODED') =>
      event({
        sottoTipoEvento: 'RESP',
        payload: text === null ? null : 'Zm9v',
        payloadDecoded: { status, text, reason: null },
      });

    it('is KO when the SOAP response carries a faultCode, with its value', () => {
      expect(
        responseOutcome(
          response('<soapenv:Envelope><faultBean><faultCode>PPT_PAGAMENTO_IN_CORSO</faultCode></faultBean></soapenv:Envelope>'),
        ),
      ).toMatchObject({ outcome: 'KO', outcomeReason: 'FAULT_CODE', faultCode: 'PPT_PAGAMENTO_IN_CORSO' });
      expect(responseOutcome(response('<ns:faultCode>PPT_X</ns:faultCode>'))).toMatchObject({
        outcome: 'KO',
        faultCode: 'PPT_X',
      });
      expect(responseOutcome(response('{"faultCode":"PPT_JSON"}'))).toMatchObject({
        outcome: 'KO',
        faultCode: 'PPT_JSON',
      });
    });

    it('is KO even when the fault value cannot be read', () => {
      expect(responseOutcome(response('<faultCode/>'))).toMatchObject({
        outcome: 'KO',
        outcomeReason: 'FAULT_CODE',
        faultCode: null,
      });
    });

    it('is KO when the response is not a SOAP/JSON envelope, as an HTTP error text from the PA', () => {
      const mocker =
        'No valid mock resource is registered as: HTTP Method [post] - URL [/org/node-for-pa/] - Special Headers [soapaction:pasendrtv2]';
      expect(responseOutcome(response(mocker))).toEqual({
        outcome: 'KO',
        outcomeReason: 'NOT_SOAP',
        faultCode: null,
        description: null,
      });
      expect(responseOutcome(response('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>'))).toMatchObject({
        outcome: 'KO',
        outcomeReason: 'NOT_SOAP',
      });
      expect(responseOutcome(response('<html><body>Service Unavailable</body></html>')).outcome).toBe('KO');
      expect(responseOutcome(response('   ')).outcome).toBe('KO');
    });

    it('is KO when a REST body declares outcome KO, with its description as the reason (closePayment 4xx)', () => {
      expect(
        responseOutcome(response('{"outcome": "KO", "description": "Unacceptable outcome when token has expired"}')),
      ).toMatchObject({
        outcome: 'KO',
        outcomeReason: 'OUTCOME_KO',
        description: 'Unacceptable outcome when token has expired',
        faultCode: null,
      });
      expect(responseOutcome(response('{"outcome":"ko"}'))).toMatchObject({
        outcome: 'KO',
        outcomeReason: 'OUTCOME_KO',
        description: null,
      });
      expect(
        responseOutcome(response('<res><outcome>KO</outcome><description>Token scaduto</description></res>')),
      ).toMatchObject({ outcome: 'KO', outcomeReason: 'OUTCOME_KO', description: 'Token scaduto' });
    });

    it('keeps OK for outcome OK and gives the fault code precedence over an outcome KO', () => {
      expect(responseOutcome(response('{"outcome":"OK"}')).outcome).toBe('OK');
      expect(responseOutcome(response('<res><outcome>OK</outcome></res>')).outcome).toBe('OK');
      expect(
        responseOutcome(response('<res><outcome>KO</outcome><fault><faultCode>PPT_E</faultCode></fault></res>')),
      ).toMatchObject({ outcomeReason: 'FAULT_CODE', faultCode: 'PPT_E' });
    });

    it('shortens a long description', () => {
      const { description } = responseOutcome(response(`{"outcome":"KO","description":"${'d'.repeat(400)}"}`));
      expect(description).toHaveLength(161);
    });

    it('labels an outcome KO with its description, or a generic label without one', () => {
      expect(buildChronology([response('{"outcome":"KO","description":"Token scaduto"}')])[0].koLabel).toBe('Token scaduto');
      expect(buildChronology([response('{"outcome":"KO"}')])[0].koLabel).toBe('outcome KO');
    });

    it('treats XML (with or without declaration) and JSON as envelopes', () => {
      for (const text of [
        '<?xml version="1.0"?><a/>',
        '<soapenv:Envelope xmlns:soapenv="x"><soapenv:Body/></soapenv:Envelope>',
        '  <paSendRTRes><outcome>OK</outcome></paSendRTRes>',
        '{"outcome":"OK"}',
        '[1]',
      ])
        expect(responseOutcome(response(text)).outcome, text).toBe('OK');
    });

    it('is OK when the response has no faultCode', () => {
      expect(responseOutcome(response('<soapenv:Envelope><outcome>OK</outcome></soapenv:Envelope>'))).toMatchObject({
        outcome: 'OK',
        faultCode: null,
      });
    });

    it('is never guessed without a decoded payload, nor for requests and state changes', () => {
      expect(responseOutcome(response(null, 'ABSENT')).outcome).toBeNull();
      expect(responseOutcome(response(null, 'TOO_LARGE')).outcome).toBeNull();
      expect(
        responseOutcome(
          event({
            sottoTipoEvento: 'REQ',
            payloadDecoded: { status: 'DECODED', text: '<a/>', reason: null },
          }),
        ).outcome,
      ).toBeNull();
      expect(
        responseOutcome(
          event({
            status: 'payment_PAYING',
            payloadDecoded: { status: 'DECODED', text: '<a/>', reason: null },
          }),
        ).outcome,
      ).toBeNull();
    });

    it('is carried on the chronology rows', () => {
      const [row] = buildChronology([response('<faultCode>PPT_Y</faultCode>')]);
      expect(row.outcome).toBe('KO');
      expect(row.faultCode).toBe('PPT_Y');
      expect(row.koLabel).toBe('PPT_Y');
    });

    it('labels a non-SOAP KO with the reason, not a fault code', () => {
      const [row] = buildChronology([response('Not Found')]);
      expect(row.koLabel).toBe('risposta non SOAP');
      expect(row.faultCode).toBeNull();
    });
  });
});
