import { buildStateProgression, documentedSchema } from './state-progression';
import { TimelineItem } from './domain';

describe('observed progression and documented paths', () => {
  it('distinguishes request outcomes from KO responses in cancellation paths', () => {
    const logical = documentedSchema('logical');
    const attempt = documentedSchema('attempt');
    const condition = (
      schema: typeof logical,
      from: string,
      to: string,
    ): string | undefined =>
      schema.arcs.find((arc) => arc.from.code === from && arc.to.code === to)?.condition;

    expect(condition(logical, 'PAYING', 'INSERTED')).toBe(
      'Request closePayment V1/V2 (eCommerce→Nodo) con outcome=KO; annullo di validazione closePaymentV2 su PA OLD senza RPT (request ricevuta, Nodo risponde 422 KO); request sendPaymentResult V1/V2 (Nodo→eCommerce) con outcome=KO; request sendPaymentOutcome V1/V2 (PSP→Nodo) con outcome=KO (solo NM3); mod3CancelV2: scadenza NMU se tutti i token del gruppo sono ancora PAYMENT_UNKNOWN',
    );
    expect(condition(attempt, 'PAYING', 'CANCELLED')).toBe(
      'Request closePayment V1/V2 (eCommerce→Nodo) con outcome=KO; annullo di validazione closePaymentV2 su PA OLD senza RPT (Nodo response 422 KO)',
    );
    expect(condition(attempt, 'PAYMENT_REFUSED', 'CANCELLED')).toBe(
      'Request sendPaymentResult V1/V2 (Nodo→eCommerce) con outcome=KO',
    );
    expect(condition(attempt, 'PAYMENT_SEND_ERROR', 'CANCELLED')).toBe(
      'Request sendPaymentResult V1/V2 (Nodo→eCommerce) con outcome=KO',
    );
    expect(condition(attempt, 'PAYING', 'FAILED')).toBe(
      'Request sendPaymentOutcome V1/V2 (PSP→Nodo) con outcome=KO, solo NM3; non è un KO della response',
    );
    expect(condition(attempt, 'PAYING_RPT', 'CANCELLED')).toBe(
      'request closePaymentV2 (eCommerce→Nodo) con outcome=KO, percorso PA OLD',
    );
  });

  it('documents PA OLD closePaymentV2 OK with RPT without inventing entrance into PAYING_RPT', () => {
    const schema = documentedSchema('attempt');
    expect(
      schema.arcs.find(
        (arc) => arc.from.code === 'PAYING_RPT' && arc.to.code === 'PAYMENT_RESERVED',
      ),
    ).toMatchObject({
      applicability: 'documented',
      condition: 'closePaymentV2 OK su PA OLD con RPT presente',
    });
    expect(schema.arcs.filter((arc) => arc.to.code === 'PAYING_RPT')).toEqual([]);
    expect(schema.notes.join(' ')).toContain('PAYING_RPT: ingresso all’arrivo RPT da confermare');
  });

  it('preserves every repeated visit and server order despite reversed and null dates', () => {
    const history: TimelineItem[] = [
      {
        state: 'PAYING',
        transitionAt: '2026-10-23T10:00:00Z',
        timestampBasis: 'SOURCE_EVENT',
        trigger: 'activate',
      },
      { state: 'INSERTED', transitionAt: null, timestampBasis: 'ANOMALY' },
      { state: 'PAYING', transitionAt: '2026-10-22T10:00:00Z', timestampBasis: 'INFERRED' },
    ];
    const model = buildStateProgression('logical', 'PAYING', history, 'Europe/Rome');
    expect(model.visits.map((visit) => visit.presentation.code)).toEqual([
      'PAYING',
      'INSERTED',
      'PAYING',
    ]);
    expect(model.visits.map((visit) => visit.status)).toEqual([
      'Osservato',
      'Osservato',
      'Corrente',
    ]);
    expect(model.visits[2].provenance).toBe('Inferito');
    expect(model.visits[1].time).toBe('Data-ora non disponibile');
    expect(model.visits[1].trigger).toBe('Trigger non disponibile');
    expect(history).toHaveLength(3);
  });

  it('never invents an observed event for a current state absent from history', () => {
    const model = buildStateProgression('attempt', 'NOTICE_SENT', [], 'UTC');
    expect(model.current.code).toBe('NOTICE_SENT');
    expect(model.visits).toEqual([]);
  });

  it('marks a reconstructed past visit as inferred rather than observed', () => {
    const model = buildStateProgression(
      'attempt',
      'PAID',
      [
        { state: 'PAYING', transitionAt: null, timestampBasis: 'INFERRED' },
        { state: 'PAID', transitionAt: null, timestampBasis: 'SOURCE_EVENT' },
      ],
      'UTC',
    );
    expect(model.visits[0].status).toBe('Inferito');
  });

  it('documents actual branches, cycles and the gated PDF arc, not enum adjacency', () => {
    const logical = documentedSchema('logical');
    const attempt = documentedSchema('attempt');
    const recipient = documentedSchema('recipient');
    const arcs = (schema: typeof logical) =>
      schema.arcs.map((arc) => `${arc.from.code}->${arc.to.code}`);
    expect(arcs(logical)).toEqual(
      expect.arrayContaining([
        'PAYING->INSERTED',
        'INSERTED->PAYING',
        'PAID->NOTICE_STORED',
        'PAID->NOTIFIED',
      ]),
    );
    expect(arcs(logical)).not.toContain('NOTICE_STORED->NOTIFIED');
    expect(arcs(attempt)).not.toContain('PAID->FAILED');
    expect(arcs(attempt)).toEqual(expect.arrayContaining(['PAYING->PAID', 'PAYING->FAILED']));
    expect(
      attempt.arcs.find((arc) => arc.from.code === 'PAYING' && arc.to.code === 'PAID')?.condition,
    ).toContain('NM3');
    expect(attempt.arcs.filter((arc) => arc.from.code === 'PAYMENT_SENT')).toHaveLength(4);
    expect(
      attempt.arcs.find(
        (arc) => arc.from.code === 'NOTICE_STORED' && arc.to.code === 'NOTICE_SENT',
      ),
    ).toMatchObject({ applicability: 'unconfirmed' });
    expect(arcs(recipient)).toContain('NOTICE_PENDING->NOTICE_SENT');
    expect(attempt.phases.flatMap((phase) => phase.states).map((state) => state.code)).toHaveLength(
      18,
    );
    expect(attempt.notes.join(' ')).toContain('ingresso');
  });

  it('always displays an observed stored-to-sent transition even though operational reachability is gated', () => {
    const history = ['NOTICE_STORED', 'NOTICE_SENT'].map((state) => ({
      state,
      transitionAt: null,
      timestampBasis: 'SOURCE_EVENT' as const,
    }));
    expect(
      buildStateProgression('attempt', 'NOTICE_SENT', history, 'UTC').visits.map(
        (visit) => visit.presentation.code,
      ),
    ).toEqual(['NOTICE_STORED', 'NOTICE_SENT']);
  });
});
