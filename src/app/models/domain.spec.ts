import { ATTEMPT_STATES, isUnresolvedState, LOGICAL_STATES, progressionStates, stateCategory, stateLabel } from './domain';

it('keeps compatibility labels aligned with the entity catalog without treating PSP acceptance as paid', () => {
  expect(stateCategory('PAYMENT_ACCEPTED')).toBe('info');
  expect(stateLabel('NOTICE_STORED')).toBe('Ricevuta archiviata');
});

describe('domain state helpers', () => {
  it('keeps logical and attempt state catalogs distinct', () => {
    expect(LOGICAL_STATES).toHaveLength(5);
    expect(ATTEMPT_STATES).toHaveLength(18);
    expect(LOGICAL_STATES).not.toContain('PAYMENT_UNKNOWN');
    expect(ATTEMPT_STATES).toContain('PAYMENT_UNKNOWN');
  });

  it('categorizes states for badge colours and flags unresolved ones', () => {
    expect(stateCategory('PAID')).toBe('ok');
    expect(stateCategory('PAYING')).toBe('info');
    expect(stateCategory('PAYMENT_UNKNOWN')).toBe('warn');
    expect(stateCategory('CANCELLED')).toBe('mute');
    expect(stateCategory('LEGACY_NODE_STATE')).toBe('mute');
    expect(isUnresolvedState('PAYMENT_UNKNOWN')).toBe(true);
    expect(isUnresolvedState('PAYMENT_SEND_ERROR')).toBe(true);
    expect(isUnresolvedState('PAID')).toBe(false);
  });

  it('labels unknown legacy values without changing their source value', () => {
    expect(stateLabel('PAYMENT_UNKNOWN')).toBe('Pagamento non risolto');
    expect(stateLabel('LEGACY_NODE_STATE')).toBe('LEGACY_NODE_STATE');
  });

  it('provides an italian label for every documented logical and attempt state', () => {
    for (const state of [...LOGICAL_STATES, ...ATTEMPT_STATES]) {
      expect(stateLabel(state)).not.toBe(state);
    }
  });

  it('builds branch-aware progressions from documented FSM arcs without ranking states', () => {
    const logical = progressionStates('logical', 'PAID', [
      { state: 'INSERTED', transitionAt: null, timestampBasis: 'SOURCE_EVENT' },
      { state: 'PAYING', transitionAt: null, timestampBasis: 'SOURCE_EVENT' },
      { state: 'PAID', transitionAt: null, timestampBasis: 'SOURCE_EVENT' },
    ]);
    expect(logical).toHaveLength(5);
    expect(logical.find(item => item.state === 'NOTIFIED')?.status).toBe('unreached');
    expect(logical.find(item => item.state === 'NOTICE_STORED')?.status).toBe('unreached');

    const unknown = progressionStates('attempt', 'PAYMENT_UNKNOWN', []);
    expect(unknown).toHaveLength(ATTEMPT_STATES.length);
    expect(unknown.find(item => item.state === 'PAID')?.status).toBe('unreached');
    expect(unknown.find(item => item.state === 'CANCELLED')?.status).toBe('unreached');
    expect(unknown.find(item => item.state === 'PAYMENT_REFUSED')?.status).toBe('not-in-branch');

    const cancelled = progressionStates('attempt', 'CANCELLED', [
      { state: 'PAYING', transitionAt: null, timestampBasis: 'SOURCE_EVENT' },
      { state: 'CANCELLED', transitionAt: null, timestampBasis: 'SOURCE_EVENT' },
    ]);
    expect(cancelled.find(item => item.state === 'CANCELLED')?.status).toBe('current');
    expect(cancelled.find(item => item.state === 'PAID')?.status).toBe('not-in-branch');

    const legacy = progressionStates('attempt', 'PAYING_RPT', []);
    expect(legacy.find(item => item.state === 'PAID_NORPT')?.status).toBe('unreached');
    expect(legacy.find(item => item.state === 'FAILED_NORPT')?.status).toBe('unreached');
  });

  it('keeps receipt states reachable after PAID without reopening financial terminal states', () => {
    const paid = progressionStates('attempt', 'PAID', []);
    for (const state of ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTIFIED']) {
      expect(paid.find(item => item.state === state)?.status).toBe('unreached');
    }
    for (const terminal of ['FAILED', 'CANCELLED', 'NOTIFIED', 'NOTICE_STORED']) {
      const steps = progressionStates('attempt', terminal, []);
      expect(steps.some(step => step.status === 'unreached')).toBe(false);
    }
  });

  it('includes close reservation and cancellation for a legacy attempt with RPT already present', () => {
    const steps = progressionStates('attempt', 'PAYING_RPT', []);
    expect(steps.find(step => step.state === 'PAYMENT_RESERVED')?.status).toBe('unreached');
    expect(steps.find(step => step.state === 'CANCELLED')?.status).toBe('unreached');
  });
});
