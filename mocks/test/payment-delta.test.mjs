import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, contract, NOW, DAY, PA1, PA2, notice } from './harness.mjs';
import { createAjv } from '../validate-contract.mjs';

const T = { timeout: 30_000 };
const scope = n => ({ scope: 'payment', paFiscalCode: n < 5 ? PA1 : PA2, noticeNumber: notice(n) });
const path = n => `/api/payments/${scope(n).paFiscalCode}/${notice(n)}`;
const iso = n => new Date(n).toISOString();
const hasAnomaly = entity => entity.timeline.some(t => t.timestampBasis === 'ANOMALY');

// Independent consumer: uses only the initial REST snapshot and SSE payloads.
function apply(local, event) {
  if (event.projectionRevision <= local.revision) return local;
  assert.equal(event.projectionRevision, local.revision + 1, 'contiguous revision required');
  const { changes: c, projectionRevision: revision } = event;
  if (c.deleted) return { revision, detail: null };
  const p = structuredClone(local.detail ?? {
    paFiscalCode: event.paFiscalCode, noticeNumber: event.noticeNumber, timeline: [], attempts: [], recipients: []
  });
  const correct = (timeline, corrections = []) => {
    assert.equal(new Set(corrections.map(c => c.index)).size, corrections.length);
    for (const { index, transition } of corrections) {
      assert.equal(timeline[index]?.state, transition.state, 'correction keeps identity and state');
      timeline[index] = structuredClone(transition);
    }
  };
  p.attempts = p.attempts.filter(a => !c.removedAttemptIds.includes(a.attemptId));
  for (const change of c.attemptChanges) {
    const index = p.attempts.findIndex(a => a.attemptId === change.attemptId);
    if (change.upsert) {
      assert.equal(change.upsert.attemptId, change.attemptId);
      assert.equal(change.upsert.paFiscalCode, p.paFiscalCode);
      assert.equal(change.upsert.noticeNumber, p.noticeNumber);
      if (index < 0) p.attempts.push(structuredClone(change.upsert));
      else p.attempts[index] = structuredClone(change.upsert);
    } else {
      assert.ok(index >= 0, 'unknown attempt requires complete upsert');
      const a = p.attempts[index];
      Object.assign(a, change.patch);
      correct(a.timeline, change.transitionCorrections);
      a.timeline.push(...structuredClone(change.transitions));
    }
  }
  p.recipients = p.recipients.filter(r => !c.removedRecipientIds?.includes(r.recipientId));
  for (const change of c.recipientChanges ?? []) {
    const index = p.recipients.findIndex(r => r.recipientId === change.recipientId);
    if (change.upsert) {
      if (index < 0) p.recipients.push(structuredClone(change.upsert));
      else p.recipients[index] = structuredClone(change.upsert);
    } else {
      assert.ok(index >= 0, 'unknown recipient requires complete upsert');
      const r = p.recipients[index];
      Object.assign(r, change.patch);
      correct(r.timeline, change.transitionCorrections);
      r.timeline.push(...structuredClone(change.transitions));
    }
  }
  for (const r of p.recipients) {
    r.state = r.timeline.at(-1).state;
    r.hasAnomaly = hasAnomaly(r);
    r.projectionRevision = revision;
  }
  correct(p.timeline, c.logicalTransitionCorrections);
  p.timeline.push(...structuredClone(c.logicalTransitions));
  if (c.timelineIncomplete !== undefined) p.timelineIncomplete = c.timelineIncomplete;
  for (const a of p.attempts) {
    a.state = a.timeline.at(-1).state;
    a.warning = ['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'].includes(a.state);
    a.hasAnomaly = hasAnomaly(a); a.projectionRevision = revision;
  }
  p.state = p.timeline.at(-1).state; p.projectionRevision = revision;
  p.attemptCount = p.attempts.length; p.warning = p.attempts.some(a => a.warning);
  p.hasAnomaly = hasAnomaly(p) || p.attempts.some(a => a.hasAnomaly) || p.recipients.some(r => r.hasAnomaly);
  return { revision, detail: p };
}

async function initial(h, n, token = 'DEMO_VIEWER') {
  const { stream, frame } = await h.ready(scope(n), { token });
  const detail = (await h.get(path(n), { token })).json;
  assert.equal(frame.data.projectionRevision, detail.projectionRevision);
  return { stream, local: { revision: detail.projectionRevision, detail } };
}

function safe(event) {
  assert.doesNotMatch(JSON.stringify(event), /paymentToken|firstSeenAt|expiresAt/);
}

test('new attempt upsert plus contiguous retention delta reproduces REST without event GETs', T, () => withServer({}, async h => {
  let { stream, local } = await initial(h, 3);
  const previous = structuredClone(local.detail.attempts[0]);
  assert.equal((await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(3) })).status, 200);
  const event = await stream.next();
  safe(event);
  const [change] = event.data.changes.attemptChanges;
  assert.deepEqual(change.transitions, []);
  assert.equal(change.upsert.attemptId, 'att_003_2');
  assert.equal(change.upsert.attemptStartedAt, iso(NOW));
  assert.match(change.upsert.tokenDisplay, /SYNTHETIC-TOKEN/);
  assert.equal(change.upsert.timeline[0].trigger, 'activatePaymentNotice');
  assert.equal(change.upsert.serviceIdentifier, 'SYNTHETIC_SERVICE_A');
  local = apply(local, event.data);
  assert.deepEqual(local.detail.attempts[0], { ...previous, projectionRevision: 2 });
  assert.equal(local.detail.state, 'PAYING');
  await h.control({ action: 'advanceClock', milliseconds: DAY });
  const removal = await stream.next();
  safe(removal);
  local = apply(local, removal.data);
  assert.deepEqual(removal.data.changes.removedAttemptIds, ['att_003_1']);
  assert.equal(local.detail.attemptCount, 1);
  // The only follow-up GET is the final test oracle, not a delta dependency.
  assert.deepEqual(local.detail, (await h.get(path(3), { token: 'DEMO_VIEWER' })).json);
}));

for (const n of [7, 8]) test(`timestamp reconciliation of fixture ${n} updates in place without regression or extra GET`, T, () => withServer({}, async h => {
  let { stream, local } = await initial(h, n, 'DEMO_OPERATOR');
  const original = structuredClone(local.detail);
  const attemptId = `att_00${n}_1`;
  if (n === 8) {
    await h.control({ action: 'completeDimensions', attemptId });
    const dimensions = await stream.next();
    safe(dimensions);
    assert.deepEqual(dimensions.data.changes.attemptChanges[0].patch, {
      psp: 'ABI00001', stazione: `${PA2}_01`, canale: 'SYNTHETIC_CHANNEL_A'
    });
    local = apply(local, dimensions.data);
    assert.equal(local.detail.attempts[0].attemptStartedAt, null);
    assert.equal(local.detail.timelineIncomplete, true);
    assert.equal(local.detail.hasAnomaly, true);
  }
  await h.control({ action: 'correctTimestamps', attemptId });
  const event = await stream.next();
  safe(event);
  const c = event.data.changes;
  assert.deepEqual(c.logicalTransitions, []);
  assert.deepEqual(c.attemptChanges[0].transitions, []);
  assert.deepEqual(c.attemptChanges[0].transitionCorrections.map(c => c.index), [0]);
  assert.deepEqual(c.logicalTransitionCorrections.map(c => c.index), [0]);
  local = apply(local, event.data);
  const source = NOW - (n === 7 ? 2 : 1) * DAY - 60_000;
  assert.equal(local.detail.attempts[0].attemptStartedAt, iso(source));
  assert.equal(local.detail.attempts[0].timeline[0].transitionAt, iso(source));
  assert.equal(local.detail.timeline[0].transitionAt, iso(source));
  assert.deepEqual(local.detail.timeline.map(t => t.state), original.timeline.map(t => t.state));
  assert.deepEqual(local.detail.attempts[0].timeline.map(t => t.state), original.attempts[0].timeline.map(t => t.state));
  assert.equal(local.detail.attempts[0].state, original.attempts[0].state);
  assert.equal(local.detail.attempts[0].timelineIncomplete, false);
  assert.equal(local.detail.timelineIncomplete, false);
  assert.equal(local.detail.hasAnomaly, false);
  const repeated = await h.control({ action: 'correctTimestamps', attemptId });
  assert.equal(repeated.status, 200);
  await stream.expectNone();
  await h.control({ action: 'duplicate' });
  const duplicate = await stream.next();
  assert.equal(duplicate.id, event.id);
  assert.deepEqual(apply(local, duplicate.data), local);
  assert.deepEqual(local.detail, (await h.get(path(n), { token: 'DEMO_OPERATOR' })).json);
}));

test('deletion and complete upsert restoration reproduce multi-attempt REST with replay isolation', T, () => withServer({}, async h => {
  let { stream, local } = await initial(h, 2);
  const ids = local.detail.attempts.map(a => a.attemptId);
  await h.control({ action: 'empty', enabled: true });
  const deletion = await stream.next();
  local = apply(local, deletion.data);
  assert.equal(local.detail, null);
  await h.control({ action: 'empty', enabled: false });
  const restoration = await stream.next();
  safe(restoration);
  local = apply(local, restoration.data);
  assert.deepEqual(local.detail.attempts.map(a => a.attemptId), ids);
  assert.deepEqual(local.detail, (await h.get(path(2))).json);
  await h.control({ action: 'empty', enabled: false });
  await stream.expectNone();
  // Later appends must not mutate a previously published full timeline.
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const replay = await h.open(scope(2), { token: 'DEMO_VIEWER', lastEventId: deletion.id });
  const replayed = await replay.next();
  assert.equal(replayed.id, restoration.id);
  assert.deepEqual(replayed.data, restoration.data);
}));

test('append-only resolution still reconstructs REST and updates all retained attempt revisions', T, () => withServer({}, async h => {
  let { stream, local } = await initial(h, 1);
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const event = await stream.next();
  safe(event);
  assert.equal(event.data.changes.attemptChanges[0].transitions[0].trigger, 'sendPaymentOutcome');
  local = apply(local, event.data);
  assert.equal(local.detail.warning, false);
  assert.equal(local.detail.attempts[0].timeline.at(-1).trigger, 'sendPaymentOutcome');
  assert.deepEqual(local.detail, (await h.get(path(1))).json);
}));

test('recipient-only retry, duplicates and full restoration reproduce REST without changing position or attempt', T, () => withServer({}, async h => {
  let { stream, local } = await initial(h, 1);
  for (const scenario of ['outcomeOk', 'generateReceipt', 'sendReceipt', 'receiptTimeout', 'retryReceipt',
    'receiptTimeout', 'retryReceipt', 'primaryResponse', 'completeReceipt']) {
    assert.equal((await h.control({ action: 'scenario', attemptId: 'att_001_1', scenario })).status, 200);
    const event = await stream.next();
    safe(event);
    if (['receiptTimeout', 'retryReceipt'].includes(scenario)) {
      assert.deepEqual(event.data.changes.logicalTransitions, []);
      assert.deepEqual(event.data.changes.attemptChanges, []);
    }
    local = apply(local, event.data);
    assert.deepEqual(local.detail, (await h.get(path(1))).json);
  }
  assert.equal(local.detail.recipients[0].timeline.filter(t => t.state === 'NOTICE_SENT').length, 3);
  await h.control({ action: 'duplicate' });
  assert.deepEqual(apply(local, (await stream.next()).data), local);
  await h.control({ action: 'empty', enabled: true });
  local = apply(local, (await stream.next()).data);
  await h.control({ action: 'empty', enabled: false });
  local = apply(local, (await stream.next()).data);
  assert.deepEqual(local.detail, (await h.get(path(1))).json);
}));

test('full known-attempt upsert replaces in place rather than merging or appending its timeline', T, () => withServer({}, async h => {
  const { local } = await initial(h, 2);
  const replacement = { ...structuredClone(local.detail.attempts[0]), psp: null, projectionRevision: 2 };
  const event = { type: 'payment.delta', scope: scope(2), paFiscalCode: PA1, noticeNumber: notice(2), projectionRevision: 2,
    changes: { logicalTransitions: [], removedAttemptIds: [], deleted: false, attemptChanges: [
      { attemptId: replacement.attemptId, transitions: [], warning: false, upsert: replacement }
    ] } };
  h.checkEvent({ event: 'payment.delta', data: event });
  const updated = apply(local, event);
  assert.deepEqual(updated.detail.attempts[0], replacement);
  assert.deepEqual(updated.detail.attempts[1], { ...local.detail.attempts[1], projectionRevision: 2 });
  assert.equal(updated.detail.attemptCount, 2);
}));

test('start-time reconciliation shortens retention instead of restarting it', T, () => withServer({}, async h => {
  let { stream, local } = await initial(h, 7);
  await h.control({ action: 'correctTimestamps', attemptId: 'att_007_1' });
  local = apply(local, (await stream.next()).data);
  await h.control({ action: 'advanceClock', milliseconds: 58 * DAY - 60_000 });
  const expiry = await stream.next();
  assert.deepEqual(expiry.data.changes.removedAttemptIds, ['att_007_1']);
  local = apply(local, expiry.data);
  assert.equal(local.detail, null);
  assert.equal((await h.get(path(7))).status, 404);
}));

test('new attempts have distinct lookup identities across payments', T, () => withServer({}, async h => {
  await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(3) });
  await h.control({ action: 'resolve', attemptId: 'att_004_1' });
  await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(4) });
  const tokens = [];
  for (const attemptId of ['att_003_2', 'att_004_2']) {
    const revealed = await h.call('POST', `/api/attempts/${attemptId}/reveal`, { body: {} });
    assert.equal(revealed.status, 200);
    tokens.push(revealed.json.paymentToken);
    const found = await h.call('POST', '/api/token-lookup', { body: { paymentToken: revealed.json.paymentToken } });
    assert.equal(found.json.attemptId, attemptId);
  }
  assert.notEqual(tokens[0], tokens[1]);
}));

test('mock reconciliation controls validate inputs, preserve known dimensions and are no-ops when complete', T, () => withServer({}, async h => {
  const { stream } = await h.ready(scope(1));
  for (const action of ['completeDimensions', 'correctTimestamps']) {
    assert.equal((await h.control({ action, attemptId: 'att_001_1' })).json.projectionRevision, 1);
    assert.equal((await h.control({ action })).status, 400);
    assert.equal((await h.control({ action, attemptId: 'unknown' })).status, 404);
    assert.equal((await h.control({ action, attemptId: 'att_001_1', paymentToken: 'forbidden' })).status, 400);
    assert.equal((await h.control({ action, attemptId: 'att_001_1' }, 'DEMO_OPERATOR')).status, 403);
  }
  assert.equal((await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(1) })).status, 400);
  assert.equal((await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: 'invalid' })).status, 400);
  assert.equal((await h.control({ action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(9) })).status, 404);
  await stream.expectNone();
}));

test('strict delta contract accepts full upsert/sparse corrections and rejects incomplete or token-bearing payloads', T, () => withServer({}, async h => {
  const check = createAjv().compile(contract.components.schemas.PaymentDelta);
  const detail = (await h.get(path(8))).json;
  const envelope = changes => ({ type: 'payment.delta', scope: scope(8), paFiscalCode: PA2, noticeNumber: notice(8),
    projectionRevision: 2, changes: { logicalTransitions: [], removedAttemptIds: [], deleted: false, attemptChanges: [changes] } });
  const base = { attemptId: 'att_008_1', transitions: [], warning: false };
  const valid = [
    { ...base, upsert: detail.attempts[0] },
    { ...base, patch: { serviceIdentifier: null, psp: 'ABI00001', attemptStartedAt: null, startTimestampBasis: 'ANOMALY', timelineIncomplete: false } },
    { ...base, transitionCorrections: [{ index: 0, transition: { state: 'PAYING', transitionAt: iso(NOW - DAY), timestampBasis: 'SOURCE_EVENT' } }] }
  ];
  for (const item of valid) assert.equal(check(envelope(item)), true, JSON.stringify(check.errors));
  const incomplete = { ...detail.attempts[0] }; delete incomplete.serviceIdentifier;
  for (const item of [
    { ...base, upsert: incomplete },
    { ...base, upsert: { ...detail.attempts[0], paymentToken: 'forbidden' } },
    { ...base, upsert: { ...detail.attempts[0], expiresAt: NOW } },
    { ...base, upsert: detail.attempts[0], transitions: [detail.attempts[0].timeline[0]] },
    { ...base, upsert: detail.attempts[0], patch: { psp: 'ABI00001' } },
    { ...base, upsert: detail.attempts[0], transitionCorrections: [] },
    { ...base, patch: {} },
    { ...base, patch: { paymentToken: 'forbidden' } },
    { ...base, patch: { attemptStartedAt: iso(NOW) } },
    { ...base, patch: { startTimestampBasis: 'SOURCE_EVENT' } },
    { ...base, transitionCorrections: [{ index: -1, transition: detail.attempts[0].timeline[0] }] },
    { ...base, transitionCorrections: [{ index: 0, transition: { ...detail.attempts[0].timeline[0], paymentToken: 'forbidden' } }] }
  ]) assert.equal(check(envelope(item)), false, JSON.stringify(item));
}));
