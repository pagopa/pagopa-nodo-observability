import { ATTEMPT_STATES, LOGICAL_STATES, RECIPIENT_STATES } from './domain';
import {
  ATTEMPT_PRESENTATIONS,
  LOGICAL_PRESENTATIONS,
  RECIPIENT_PRESENTATIONS,
  statePresentation,
  stateFilterGroups,
  positiveStateCounts,
} from './state-presentation';

describe('entity-specific state catalog', () => {
  it('covers all original codes without changing enum order', () => {
    for (const [states, catalog] of [
      [LOGICAL_STATES, LOGICAL_PRESENTATIONS],
      [ATTEMPT_STATES, ATTEMPT_PRESENTATIONS],
      [RECIPIENT_STATES, RECIPIENT_PRESENTATIONS],
    ] as const) {
      expect(Object.keys(catalog).sort()).toEqual([...states].sort());
      for (const code of states) {
        const value = statePresentation(
          catalog === LOGICAL_PRESENTATIONS
            ? 'logical'
            : catalog === ATTEMPT_PRESENTATIONS
              ? 'attempt'
              : 'recipient',
          code,
        );
        expect(value.code).toBe(code);
        expect(value.description.length).toBeGreaterThan(15);
      }
    }
  });

  it('does not confuse PSP acceptance, archive, delivery or failed outcomes', () => {
    expect(statePresentation('attempt', 'PAYMENT_ACCEPTED').description).toBe(
      'Accettato dal PSP, in attesa dell’esito del pagamento',
    );
    expect(statePresentation('attempt', 'PAYMENT_ACCEPTED').treatment).toBe('info');
    expect(statePresentation('logical', 'NOTICE_STORED').label).toBe('Ricevuta archiviata');
    expect(statePresentation('logical', 'NOTIFIED').description).toContain('PA intestataria');
    expect(statePresentation('attempt', 'NOTIFIED').description).toContain(
      'tutti i destinatari previsti',
    );
    expect(statePresentation('recipient', 'NOTIFIED').description).toContain('OK o KO');
    expect(statePresentation('attempt', 'FAILED').description).not.toContain('annullato');
  });

  it('preserves unknown codes with neutral entity-specific explanations', () => {
    expect(statePresentation('recipient', 'FUTURE_STATE')).toMatchObject({
      code: 'FUTURE_STATE',
      label: 'FUTURE_STATE',
      treatment: 'mute',
      phase: 'unknown',
    });
    expect(statePresentation('recipient', 'FUTURE_STATE').description).toContain(
      'non riconosciuto',
    );
  });

  it('groups filters by presentation phase while preserving original API values', () => {
    const groups = stateFilterGroups('attempt', ['PAID', 'PAYMENT_ACCEPTED', 'PAYING', 'NEW']);
    expect(groups.map((group) => group.phase)).toEqual(['activation', 'psp', 'outcome', 'unknown']);
    expect(groups.flatMap((group) => group.states.map((state) => state.code))).toEqual([
      'PAYING',
      'PAYMENT_ACCEPTED',
      'PAID',
      'NEW',
    ]);
  });

  it('prepares positive state counts without mutating the source or hiding a genuine empty result', () => {
    const rows = [
      { state: 'PAYMENT_ACCEPTED', count: 2 },
      { state: 'PAID', count: 0 },
    ];
    expect(positiveStateCounts('attempt', rows)).toEqual([
      { presentation: statePresentation('attempt', 'PAYMENT_ACCEPTED'), count: 2 },
    ]);
    expect(positiveStateCounts('logical', [{ state: 'PAYING', count: 0 }])).toEqual([]);
    expect(rows).toHaveLength(2);
  });
});
