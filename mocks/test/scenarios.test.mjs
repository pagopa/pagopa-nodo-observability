import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, contract, PA1, PA2, notice, NOW, DAY } from './harness.mjs';
import { fixtures, LOGICAL_STATES, ATTEMPT_STATES } from '../model.mjs';
import { SCENARIOS } from '../scenarios.mjs';
import { createAjv } from '../validate-contract.mjs';

const T = { timeout: 30_000 };
const paymentPath = n => `/api/payments/${n < 5 ? PA1 : PA2}/${notice(n)}`;
const scope = n => ({ scope: 'payment', paFiscalCode: n < 5 ? PA1 : PA2, noticeNumber: notice(n) });
const run = (h, attemptId, scenario) => h.control({ action: 'scenario', attemptId, scenario });

function apply(detail, event) {
  const p = structuredClone(detail), c = event.changes;
  assert.equal(event.projectionRevision, p.projectionRevision + 1);
  p.timeline.push(...c.logicalTransitions);
  for (const change of c.attemptChanges) {
    const a = p.attempts.find(a => a.attemptId === change.attemptId);
    a.timeline.push(...change.transitions);
  }
  for (const a of p.attempts) {
    a.state = a.timeline.at(-1).state;
    a.warning = ['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'].includes(a.state);
    a.projectionRevision = event.projectionRevision;
  }
  for (const change of c.recipientChanges ?? []) {
    const index = p.recipients.findIndex(r => r.recipientId === change.recipientId);
    if (change.upsert) {
      if (index < 0) p.recipients.push(structuredClone(change.upsert));
      else p.recipients[index] = structuredClone(change.upsert);
    } else {
      assert.ok(index >= 0);
      p.recipients[index].timeline.push(...change.transitions);
    }
  }
  p.recipients = p.recipients.filter(r => !c.removedRecipientIds?.includes(r.recipientId));
  for (const r of p.recipients) {
    r.state = r.timeline.at(-1).state;
    r.projectionRevision = event.projectionRevision;
  }
  p.state = p.timeline.at(-1).state;
  p.warning = p.attempts.some(a => a.warning);
  p.projectionRevision = event.projectionRevision;
  return p;
}

test('fixtures carry explicit source provenance for receipt and legacy completion', () => {
  const payments = fixtures(NOW);
  assert.equal(payments.length, 8);
  const legacy = payments[4].attempts[0].timeline;
  assert.deepEqual(legacy.map(t => [t.state, t.trigger]), [
    ['PAYING', 'activatePaymentNotice'],
    ['PAID_NORPT', 'sendPaymentOutcome'],
    ['PAID', 'NodoInviaRPT'],
    ['NOTICE_GENERATED', 'NodoInviaRPT'],
    ['NOTICE_STORED', 'NodoInviaRPT']
  ]);
  const receipt = payments[5];
  assert.equal(receipt.attempts[0].timeline.find(t => t.state === 'NOTICE_GENERATED').trigger, 'sendPaymentOutcomeV2');
  assert.equal(receipt.attempts[0].timeline.at(-1).trigger, 'sendPaymentOutcomeV2');
  assert.equal(receipt.timeline.at(-1).trigger, 'sendPaymentOutcomeV2');
  assert.equal(payments[3].attempts[0].timeline.at(-1).trigger, 'pspNotifyPaymentV2');
  for (const payment of payments) {
    for (const entity of [payment, ...payment.attempts]) {
      assert.ok(entity.timeline.every(t => typeof t.trigger === 'string' && t.trigger.length > 0));
    }
  }
});

test('scenario catalog and strict OpenAPI request schema cover the same confirmed entity states', () => {
  const schema = contract.components.schemas.ScenarioAction;
  assert.deepEqual(Object.keys(SCENARIOS), schema.properties.scenario.enum);
  const validate = createAjv().compile(schema);
  for (const [scenario, step] of Object.entries(SCENARIOS)) {
    assert.ok(validate({ action: 'scenario', attemptId: 'att_003_2', scenario }));
    assert.ok(step.from.every(state => ATTEMPT_STATES.includes(state)));
    assert.ok(step.logicalFrom.every(state => LOGICAL_STATES.includes(state)));
    if (step.state) assert.ok(ATTEMPT_STATES.includes(step.state));
    if (step.logical) assert.ok(LOGICAL_STATES.includes(step.logical));
    if (step.state || step.logical) assert.ok(step.trigger);
  }
  for (const invalid of [
    { action: 'scenario', attemptId: 'att_003_2', scenario: 'position_CANCELLED' },
    { action: 'scenario', attemptId: 'att_003_2', scenario: 'nm3OutcomeOk', trigger: 'invented' },
    { action: 'scenario', attemptId: 'att_003_2' }
  ]) assert.equal(validate(invalid), false);
});

for (const [scenario, state, logical] of [
  ['nm3OutcomeOk', 'PAID', 'PAID'],
  ['nm3OutcomeKo', 'FAILED', 'INSERTED'],
  ['closeKo', 'CANCELLED', 'INSERTED'],
  ['closeInvalid', 'CANCELLED', 'INSERTED']
]) test(`${scenario} publishes a direct FSM transition without inventing the PSP branch`, T, () => withServer({}, async h => {
  await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(3) });
  const { stream } = await h.ready(scope(3));
  const before = (await h.get(paymentPath(3))).json;
  const result = await run(h, 'att_003_2', scenario);
  assert.equal(result.status, 200);
  const event = (await stream.next()).data;
  const after = (await h.get(paymentPath(3))).json;
  assert.deepEqual(apply(before, event), after);
  assert.equal(after.state, logical);
  assert.deepEqual(after.attempts[1].timeline.map(t => t.state), ['PAYING', state]);
  assert.equal(after.attempts[1].timeline.at(-1).trigger,
    scenario.startsWith('nm3') ? 'sendPaymentOutcomeV2' : 'closePayment-v2');
  assert.equal(after.attempts[0].state, 'CANCELLED');
  assert.ok(event.changes.logicalTransitions.every(t => t.trigger));
}));

test('receipt scenarios separate generation, primary response and all responses, preserving source trigger', T, () => withServer({}, async h => {
  const { stream } = await h.ready(scope(1));
  let detail = (await h.get(paymentPath(1))).json;
  for (const [scenario, attempt, logical] of [
    ['outcomeOk', 'PAID', 'PAID'],
    ['generateReceipt', 'NOTICE_GENERATED', 'PAID'],
    ['sendReceipt', 'NOTICE_SENT', 'PAID'],
    ['primaryResponse', 'NOTICE_SENT', 'NOTIFIED'],
    ['completeReceipt', 'NOTIFIED', 'NOTIFIED']
  ]) {
    assert.equal((await run(h, 'att_001_1', scenario)).status, 200);
    const event = (await stream.next()).data;
    detail = apply(detail, event);
    assert.deepEqual(detail, (await h.get(paymentPath(1))).json);
    assert.equal(detail.state, logical);
    assert.equal(detail.attempts[0].state, attempt);
    assert.ok([...event.changes.logicalTransitions, ...event.changes.attemptChanges.flatMap(a => a.transitions)]
      .every(t => t.trigger === 'sendPaymentOutcomeV2'));
    assert.doesNotMatch(JSON.stringify(event), /paymentToken|firstSeenAt|expiresAt/);
  }
  assert.equal(detail.timeline.filter(t => t.state === 'NOTIFIED').length, 1);
  const revision = detail.projectionRevision;
  assert.equal((await run(h, 'att_001_1', 'completeReceipt')).status, 400);
  assert.equal((await h.get(paymentPath(1))).json.projectionRevision, revision);
  await stream.expectNone();
}));

test('close and PSP scenarios update warning and aggregate state counts consistently with REST', T, () => withServer({}, async h => {
  await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(3) });
  const window = { from: new Date(NOW - 59 * DAY).toISOString(), to: new Date(NOW + 1).toISOString() };
  const { stream } = await h.ready({ scope: 'overview', ...window });
  const url = `/api/overview?${new URLSearchParams(window)}`;
  let before = (await h.get(url)).json;
  for (const [scenario, state, warning] of [
    ['closeOk', 'PAYMENT_RESERVED', false],
    ['pspSend', 'PAYMENT_SENT', false],
    ['pspUnknown', 'PAYMENT_UNKNOWN', true],
    ['expireUnknown', 'CANCELLED', false]
  ]) {
    assert.equal((await run(h, 'att_003_2', scenario)).status, 200);
    const event = (await stream.next()).data;
    const after = (await h.get(url)).json;
    for (const field of ['logicalStates', 'attemptStates']) {
      for (const row of before[field]) {
        assert.equal(row.count + (event.changes[field].find(r => r.state === row.state)?.count ?? 0),
          after[field].find(r => r.state === row.state).count);
      }
    }
    assert.equal(before.unresolved.attempts + event.changes.counts.unresolvedAttempts, after.unresolved.attempts);
    const attempt = (await h.get(paymentPath(3))).json.attempts[1];
    assert.equal(attempt.state, state);
    assert.equal(attempt.warning, warning);
    assert.equal(attempt.attemptStartedAt, new Date(NOW).toISOString());
    before = after;
  }
}));

for (const pspScenario of ['pspRefused', 'pspSendError', 'pspAccepted']) {
  test(`${pspScenario} resolves only through its permitted result or outcome`, T, () => withServer({}, async h => {
    await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(3) });
    for (const scenario of ['closeOk', 'pspSend', pspScenario]) {
      assert.equal((await run(h, 'att_003_2', scenario)).status, 200);
    }
    const accepted = pspScenario === 'pspAccepted';
    assert.equal((await run(h, 'att_003_2', accepted ? 'resultKo' : 'outcomeOk')).status, 400);
    assert.equal((await run(h, 'att_003_2', accepted ? 'outcomeOk' : 'resultKo')).status, 200);
    const detail = (await h.get(paymentPath(3))).json;
    assert.equal(detail.state, accepted ? 'PAID' : 'INSERTED');
    assert.equal(detail.attempts[1].timeline.at(-1).trigger,
      accepted ? 'sendPaymentOutcomeV2' : 'sendPaymentResult-v2');
  }));
}

test('legacy receipt scenario completes PAID_NORPT with NodoInviaRPT rather than another outcome', T, () => withServer({}, async h => {
  await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(3) });
  const { stream } = await h.ready(scope(3));
  let detail = (await h.get(paymentPath(3))).json;
  for (const scenario of ['legacyOutcomeOkNoRpt', 'legacyPaidComplete', 'legacyGenerateReceipt', 'legacyStoreReceipt']) {
    assert.equal((await run(h, 'att_003_2', scenario)).status, 200);
    detail = apply(detail, (await stream.next()).data);
    assert.deepEqual(detail, (await h.get(paymentPath(3))).json);
  }
  assert.equal(detail.state, 'NOTICE_STORED');
  assert.equal(detail.attempts[1].state, 'NOTICE_STORED');
  assert.deepEqual(detail.attempts[1].timeline.slice(-3).map(t => t.trigger),
    ['NodoInviaRPT', 'NodoInviaRPT', 'NodoInviaRPT']);
}));

test('receipt timeout/retry change only recipients while result retry remains a technical no-op', T, () => withServer({}, async h => {
  for (const scenario of ['outcomeOk', 'generateReceipt', 'sendReceipt']) {
    assert.equal((await run(h, 'att_001_1', scenario)).status, 200);
  }
  const payment = await h.ready(scope(1));
  const result = await h.ready(scope(3));
  let before = (await h.get(paymentPath(1))).json;
  for (const scenario of ['receiptTimeout', 'retryReceipt']) {
    assert.equal((await run(h, 'att_001_1', scenario)).status, 200);
    before = apply(before, (await payment.stream.next()).data);
    assert.deepEqual((await h.get(paymentPath(1))).json, before);
    assert.equal(before.attempts[0].state, 'NOTICE_SENT');
    assert.equal(before.state, 'PAID');
  }
  assert.deepEqual(before.recipients[0].timeline.map(t => t.state),
    ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTICE_PENDING', 'NOTICE_SENT']);
  assert.equal((await run(h, 'att_003_1', 'retryResult')).status, 200);
  await payment.stream.expectNone();
  await result.stream.expectNone();
  assert.equal((await run(h, 'att_001_1', 'completeReceipt')).status, 200);
}));

test('recipient snapshots, aggregate dimensions and retry deltas are explicit and contract-valid', T, () => withServer({}, async h => {
  const detail = (await h.get(paymentPath(6))).json;
  assert.ok(Array.isArray(detail.recipients), 'recipients must be present, not silently omitted');
  assert.equal(detail.recipients.length, 2);
  assert.ok(detail.recipients.every(r => r.state === 'NOTIFIED'));
  assert.ok(detail.recipients.every(r => !Object.hasOwn(r, 'attemptId') && !Object.hasOwn(r, 'paymentToken')));
  const query = new URLSearchParams({ from: new Date(NOW - 59 * DAY).toISOString(), to: new Date(NOW + 1).toISOString() });
  for (const url of ['/api/overview', `/api/creditors/${PA2}`]) {
    const overview = (await h.get(`${url}?${query}`)).json;
    assert.ok(overview.recipientStates.some(r => r.state === 'NOTIFIED' && r.count >= 2));
    assert.ok(overview.matrices.recipient.length > 0);
    assert.ok(overview.durations.some(r => r.entity === 'recipient'));
  }
}));

test('archiving during outcome with RPT differs from late RPT and does not enable an unconfirmed send edge', T, () => withServer({}, async h => {
  const { stream } = await h.ready(scope(1));
  let detail = (await h.get(paymentPath(1))).json;
  assert.equal((await run(h, 'att_001_1', 'outcomeStoreReceipt')).status, 200);
  detail = apply(detail, (await stream.next()).data);
  assert.deepEqual(detail, (await h.get(paymentPath(1))).json);
  assert.deepEqual(detail.attempts[0].timeline.slice(-3).map(t => t.state), ['PAID', 'NOTICE_GENERATED', 'NOTICE_STORED']);
  assert.ok(detail.attempts[0].timeline.slice(-3).every(t => t.trigger === 'sendPaymentOutcomeV2'));
  assert.equal(detail.state, 'NOTICE_STORED');
  assert.equal((await run(h, 'att_001_1', 'sendReceipt')).status, 400);
}));

test('scenario inputs, terminal transitions and entity guards reject atomically without deltas', T, () => withServer({}, async h => {
  const { stream } = await h.ready(scope(3));
  const before = (await h.get(paymentPath(3))).json;
  for (const body of [
    { action: 'scenario', attemptId: 'att_003_1' },
    { action: 'scenario', scenario: 'nm3OutcomeOk' },
    { action: 'scenario', attemptId: 'att_003_1', scenario: 'position_CANCELLED' },
    { action: 'scenario', attemptId: 'att_003_1', scenario: 'nm3OutcomeOk', state: 'PAID' },
    { action: 'scenario', attemptId: 'att_003_1', scenario: 'nm3OutcomeOk', trigger: 'invented' },
    { action: 'scenario', attemptId: 'att_003_1', scenario: 'nm3OutcomeOk' },
    { action: 'scenario', attemptId: 'att_003_1', scenario: 'expireUnknown' },
    { action: 'scenario', attemptId: 'att_003_1', scenario: '__proto__' }
  ]) assert.equal((await h.control(body)).status, 400);
  assert.equal((await run(h, 'unknown', 'nm3OutcomeOk')).status, 404);
  assert.equal((await h.control({ action: 'scenario', attemptId: 'att_003_1', scenario: 'nm3OutcomeOk' }, 'DEMO_OPERATOR')).status, 403);
  assert.deepEqual((await h.get(paymentPath(3))).json, before);
  await stream.expectNone();
  assert.equal((await run(h, 'att_001_1', 'nm3OutcomeKo')).status, 400);
  assert.equal((await run(h, 'att_006_1', 'closeKo')).status, 400);
}));

test('legacy resolve and gap controls preserve explicit provenance on logical and attempt timelines', T, () => withServer({}, async h => {
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  await h.control({ action: 'gap', attemptId: 'att_004_1' });
  const paid = (await h.get(paymentPath(1))).json;
  assert.equal(paid.timeline.at(-1).trigger, 'sendPaymentOutcome');
  assert.equal(paid.attempts[0].timeline.at(-1).trigger, 'sendPaymentOutcome');
  const cancelled = (await h.get(paymentPath(4))).json;
  assert.equal(cancelled.timeline.at(-1).trigger, 'sendPaymentResult-v2');
  assert.equal(cancelled.attempts[0].timeline.at(-1).trigger, 'sendPaymentResult-v2');
}));
