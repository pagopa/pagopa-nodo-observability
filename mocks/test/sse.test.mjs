import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, NOW, DAY, PA1, PA2, notice } from './harness.mjs';

const T = { timeout: 30_000 };
const OVERVIEW = { scope: 'overview' };
// Interval covering the whole retention of the fixtures (every dated attempt), slightly open to the future.
const ALL = { from: new Date(NOW - 60 * DAY + 2 * 3_600_000).toISOString(), to: new Date(NOW + 3_600_000).toISOString() };
const OVERVIEW_ALL = { scope: 'overview', ...ALL };
const PAYMENT = n => ({ scope: 'payment', paFiscalCode: n < 5 ? PA1 : PA2, noticeNumber: notice(n) });
const PAYMENT_LIST = keys => ({ scope: 'payment-list', keys: keys.join(',') });
const CREDITOR_LIST = keys => ({ scope: 'creditor-list', keys: keys.join(',') });
const zero = delta => Object.values(delta.counts).every(v => v === 0)
  && delta.logicalStates.length === 0 && delta.attemptStates.length === 0;

test('ready event with scope, revision and heartbeat comments', T, () => withServer({}, async h => {
  const { stream, frame } = await h.ready(OVERVIEW);
  assert.match(frame.id, /^[\w-]{32}$/);
  assert.deepEqual(frame.data, { type: 'ready', scope: OVERVIEW, projectionRevision: 1,
    window: { from: '2026-10-16T09:00:00.000Z', to: '2026-10-16T10:00:00.000Z' } });
  const heartbeat = await stream.next(2000, f => f.comment === 'heartbeat');
  assert.equal(heartbeat.event, undefined);
  const pay = await h.ready(PAYMENT(2));
  assert.equal(pay.frame.data.projectionRevision, 1);
  assert.deepEqual(pay.frame.data.scope, PAYMENT(2));
}));

test('payment delta is scoped to its payment; overview receives aggregate only', T, () => withServer({}, async h => {
  const { stream: p1 } = await h.ready(PAYMENT(1));
  const { stream: p2 } = await h.ready(PAYMENT(2));
  const { stream: ov } = await h.ready(OVERVIEW_ALL);
  assert.equal((await h.control({ action: 'resolve', attemptId: 'att_001_1' })).status, 200);
  const delta = await p1.next();
  assert.equal(delta.event, 'payment.delta');
  assert.equal(delta.data.projectionRevision, 2);
  assert.deepEqual(delta.data.scope, PAYMENT(1));
  assert.equal(delta.data.paFiscalCode, PA1);
  assert.equal(delta.data.noticeNumber, notice(1));
  assert.deepEqual(delta.data.changes.logicalTransitions.map(t => t.state), ['PAID']);
  assert.deepEqual(delta.data.changes.attemptChanges.map(c => [c.attemptId, c.warning]), [['att_001_1', false]]);
  assert.doesNotMatch(JSON.stringify(delta.data), /paymentToken|firstSeenAt|expiresAt/);
  await p2.expectNone();
  const agg = await ov.next();
  assert.equal(agg.event, 'aggregate.delta');
  assert.deepEqual(Object.keys(agg.data).sort(), ['changes', 'freshness', 'projectionRevision', 'scope', 'type']);
  assert.equal(agg.data.changes.counts.unresolvedPayments, -1);
  assert.equal(agg.data.changes.counts.unresolvedAttempts, -1);
  assert.equal(agg.data.changes.counts.attempts, 0);
  assert.deepEqual(agg.data.changes.attemptStates.map(r => [r.state, r.count]).sort(), [['PAID', 1], ['PAYMENT_UNKNOWN', -1]]);
  assert.equal(JSON.stringify(agg.data).includes(notice(1)), false);
  assert.equal('attempts' in agg.data || 'timeline' in agg.data || 'paFiscalCode' in agg.data, false);
}));

test('one payment-list stream invalidates only selected payment keys', T, () => withServer({}, async h => {
  const keys = [`${PA1}:${notice(1)}`, `${PA1}:${notice(2)}`];
  const { stream, frame } = await h.ready(PAYMENT_LIST(keys));
  assert.deepEqual(frame.data.scope, PAYMENT_LIST(keys));
  assert.equal(frame.data.projectionRevision, 1);
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const changed = await stream.next();
  assert.equal(changed.event, 'list.changed');
  assert.deepEqual(changed.data, {
    type: 'list.changed', scope: PAYMENT_LIST(keys), projectionRevision: 2
  });
  await h.control({ action: 'resolve', attemptId: 'att_004_1' });
  await stream.expectNone();
  await h.control({ action: 'duplicate' });
  const duplicate = await stream.next();
  assert.equal(duplicate.id, changed.id);
  assert.deepEqual(duplicate.data, changed.data);
  assert.doesNotMatch(JSON.stringify(changed.data), /paymentToken|firstSeenAt|expiresAt/);
}));

test('payment-list scopes are normalized, user-bound and replay expiry requires resync', T, () => withServer({}, async h => {
  const keys = [`${PA2}:${notice(5)}`, `${PA1}:${notice(1)}`];
  const normalized = PAYMENT_LIST([...keys].sort());
  const { stream, frame } = await h.ready(PAYMENT_LIST(keys));
  await stream.close();
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const resumed = await h.open(normalized, { lastEventId: frame.id });
  assert.equal(resumed.status, 200);
  const replayed = await resumed.next();
  assert.equal(replayed.event, 'list.changed');
  assert.equal((await resumed.next()).event, 'ready');
  await resumed.close();
  const repeated = await h.open(normalized, { lastEventId: frame.id });
  assert.equal((await repeated.next()).id, replayed.id);
  await repeated.close();
  assert.equal((await h.open(PAYMENT_LIST([`${PA1}:${notice(1)}`]), { lastEventId: frame.id })).status, 400);
  assert.equal((await h.open(normalized, { token: 'DEMO_OPERATOR', lastEventId: frame.id })).status, 400);
  assert.equal((await h.open(normalized, { token: 'DEMO_PA_VIEWER' })).status, 404);
  await h.control({ action: 'expireReplay' });
  const expired = await h.open(normalized, { lastEventId: frame.id });
  assert.equal(expired.status, 410);
  assert.equal(expired.json.resync, true);
}));

test('a bound payment-list replay can report a selected key that disappeared after its snapshot', T, () => withServer({}, async h => {
  const scope = PAYMENT_LIST([`${PA1}:${notice(1)}`]);
  const { stream, frame } = await h.ready(scope);
  await stream.close();
  await h.control({ action: 'empty', enabled: true });
  const resumed = await h.open(scope, { lastEventId: frame.id });
  assert.equal(resumed.status, 200);
  const invalidated = await resumed.next();
  assert.equal(invalidated.event, 'list.changed');
  assert.deepEqual(invalidated.data.scope, scope);
}));

test('creditor-list stream invalidates selected PA rows only and enforces PA authorization', T, () => withServer({}, async h => {
  const { stream } = await h.ready(CREDITOR_LIST([PA1, PA2]));
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const changed = await stream.next();
  assert.equal(changed.event, 'list.changed');
  assert.deepEqual(changed.data.scope, CREDITOR_LIST([PA1, PA2]));
  await h.control({ action: 'resolve', attemptId: 'att_005_1' });
  await stream.expectNone();
  assert.equal((await h.open(CREDITOR_LIST([PA1, PA2]), { token: 'DEMO_PA_VIEWER' })).status, 404);
  const limited = await h.ready(CREDITOR_LIST([PA1]), { token: 'DEMO_PA_VIEWER' });
  assert.equal(limited.frame.data.scope.keys, PA1);
}));

test('creditor and station streams carry scoped aggregate deltas', T, () => withServer({}, async h => {
  const { stream: c1 } = await h.ready({ scope: 'creditor', paFiscalCode: PA1, ...ALL });
  const { stream: c2 } = await h.ready({ scope: 'creditor', paFiscalCode: PA2, ...ALL });
  const { stream: s1 } = await h.ready({ scope: 'station', paFiscalCode: PA1, stazione: `${PA1}_01`, ...ALL });
  const { stream: s2 } = await h.ready({ scope: 'station', paFiscalCode: PA1, stazione: `${PA1}_02`, ...ALL });
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const d1 = await c1.next(), d2 = await c2.next(), ds1 = await s1.next(), ds2 = await s2.next();
  for (const d of [d1, d2, ds1, ds2]) assert.equal(d.event, 'aggregate.delta');
  assert.deepEqual(d1.data.scope, { scope: 'creditor', paFiscalCode: PA1, ...ALL });
  assert.equal(d1.data.changes.counts.unresolvedAttempts, -1);
  assert.equal(ds1.data.changes.counts.unresolvedAttempts, -1);
  assert.deepEqual(ds1.data.scope, { scope: 'station', paFiscalCode: PA1, stazione: `${PA1}_01`, ...ALL });
  assert.equal(zero(d2.data.changes), true);
  assert.equal(zero(ds2.data.changes), true);
  for (const d of [d1, d2, ds1, ds2]) assert.equal(JSON.stringify(d.data).includes(notice(1)), false);
}));

test('limited PA viewer aggregate streams only reflect visible data', T, () => withServer({}, async h => {
  const { stream: limited } = await h.ready(OVERVIEW_ALL, { token: 'DEMO_PA_VIEWER' });
  const { stream: full } = await h.ready(OVERVIEW_ALL);
  await h.control({ action: 'empty', enabled: true });
  const a = await limited.next(), b = await full.next();
  assert.equal(a.data.changes.counts.payments, -4);
  assert.equal(a.data.changes.counts.attempts, -5);
  assert.equal(b.data.changes.counts.payments, -7);
  assert.equal(b.data.changes.counts.attempts, -8);
  assert.equal(JSON.stringify(a.data).includes(PA2), false);
}));

test('Last-Event-ID replays missed events and rejects other scope or user', T, () => withServer({}, async h => {
  const { stream, frame } = await h.ready(OVERVIEW_ALL);
  await stream.close();
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const replay = await h.open(OVERVIEW_ALL, { lastEventId: frame.id });
  assert.equal(replay.status, 200);
  const first = await replay.next();
  assert.equal(first.event, 'aggregate.delta');
  assert.equal(first.data.projectionRevision, 2);
  assert.equal(first.data.changes.counts.unresolvedAttempts, -1);
  const ready = await replay.next();
  assert.equal(ready.event, 'ready');
  assert.equal(ready.data.projectionRevision, 2);
  const resume = await h.open(OVERVIEW_ALL, { lastEventId: ready.id });
  assert.equal(resume.status, 200);
  assert.equal((await resume.next()).event, 'ready');
  await resume.expectNone();
  const crossScope = await h.open({ scope: 'creditor', paFiscalCode: PA1 }, { lastEventId: frame.id });
  assert.equal(crossScope.status, 400);
  assert.equal(crossScope.json.code, 'INVALID_REQUEST');
  const crossUser = await h.open(OVERVIEW_ALL, { token: 'DEMO_OPERATOR', lastEventId: frame.id });
  assert.equal(crossUser.status, 400);
  const otherPayment = await h.ready(PAYMENT(1));
  const wrongPayment = await h.open(PAYMENT(2), { lastEventId: otherPayment.frame.id });
  assert.equal(wrongPayment.status, 400);
}));

test('payment stream replay delivers only that payment events', T, () => withServer({}, async h => {
  const { stream, frame } = await h.ready(PAYMENT(1));
  await stream.close();
  await h.control({ action: 'resolve', attemptId: 'att_004_1' });
  const replay = await h.open(PAYMENT(1), { lastEventId: frame.id });
  assert.equal((await replay.next()).event, 'ready');
  await replay.expectNone();
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  assert.equal((await replay.next()).data.paFiscalCode, PA1);
}));

test('expired replay cursors return 410 with resync hint (expireReplay and TTL)', T, () => withServer({ replayTtlMs: 60_000 }, async h => {
  const { frame } = await h.ready(OVERVIEW);
  const { frame: other } = await h.ready(OVERVIEW);
  await h.control({ action: 'expireReplay' });
  const expired = await h.open(OVERVIEW, { lastEventId: frame.id });
  assert.equal(expired.status, 410);
  assert.equal(expired.json.code, 'SSE_CURSOR_EXPIRED');
  assert.equal(expired.json.resync, true);
  assert.equal((await h.open(OVERVIEW, { lastEventId: other.id })).status, 410);
  const { frame: fresh } = await h.ready(OVERVIEW);
  await h.control({ action: 'advanceClock', milliseconds: 61_000 });
  assert.equal((await h.open(OVERVIEW, { lastEventId: fresh.id })).status, 410);
  assert.equal((await h.open(OVERVIEW, { lastEventId: 'A'.repeat(32) })).status, 410);
}));

test('malformed SSE requests are rejected with 400', T, () => withServer({}, async h => {
  const bad = [{}, { scope: 'nope' }, { scope: 'payment', paFiscalCode: PA1 },
    { scope: 'payment', noticeNumber: notice(1) }, { scope: 'payment', paFiscalCode: PA1, noticeNumber: 'abc' },
    { scope: 'payment', paFiscalCode: PA1, noticeNumber: notice(1), stazione: 'x' }, { scope: 'creditor' },
    { scope: 'creditor', paFiscalCode: PA1, stazione: `${PA1}_01` }, { scope: 'station', paFiscalCode: PA1 },
    { scope: 'station', stazione: `${PA1}_01` }, { scope: 'overview', extra: '1' },
    { scope: 'creditor', paFiscalCode: '123' },
    { scope: 'payment-list', keys: `${PA1}:${notice(1)},${PA1}:${notice(1)}` },
    { scope: 'payment-list', keys: `${PA1}:${notice(1)},bad` },
    { scope: 'payment-list', keys: `${PA1}:${notice(1)}`, from: '2026-10-16T09:00:00.000Z' },
    { scope: 'creditor-list', keys: `${PA1},bad` },
    { scope: 'creditor-list', keys: PA1, psp: 'ABI00001' }];
  for (const query of bad) {
    const r = await h.open(query);
    assert.equal(r.status, 400, JSON.stringify(query));
    assert.equal(r.json.code, 'INVALID_REQUEST');
  }
  for (const id of ['bad', 'short-id', '!'.repeat(32), 'x'.repeat(33)]) {
    const r = await h.open(OVERVIEW, { lastEventId: id });
    assert.equal(r.status, 400, id);
  }
  const duplicated = await fetch(`${h.base}/api/events?scope=overview&scope=creditor`, {
    headers: { Authorization: 'Bearer DEMO_ADMIN' }, signal: AbortSignal.timeout(3000)
  });
  assert.equal(duplicated.status, 400);
  await duplicated.body.cancel();
  assert.equal((await h.open({ scope: 'payment', paFiscalCode: PA1, noticeNumber: '300000000000000099' })).status, 404);
  assert.equal((await h.open({ scope: 'creditor', paFiscalCode: '00000000009' })).status, 404);
  assert.equal((await h.open(PAYMENT_LIST(Array.from({ length: 101 }, (_, i) => `${PA1}:${String(i).padStart(18, '3')}`)))).status, 400);
  assert.equal((await h.open(CREDITOR_LIST([PA1, PA2]), { token: 'DEMO_PA_VIEWER' })).status, 404);
}));

test('duplicate control re-sends the last event with the same id', T, () => withServer({}, async h => {
  const { stream, frame } = await h.ready(OVERVIEW);
  assert.equal((await h.control({ action: 'duplicate' })).status, 200);
  const dup = await stream.next();
  assert.equal(dup.id, frame.id);
  assert.equal(dup.event, 'ready');
  assert.deepEqual(dup.data, frame.data);
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const delta = await stream.next();
  await h.control({ action: 'duplicate' });
  const again = await stream.next();
  assert.equal(again.id, delta.id);
  assert.deepEqual(again.data, delta.data);
}));

test('gap skips a payment revision, later delta enables targeted resync', T, () => withServer({}, async h => {
  const { stream: payment, frame } = await h.ready(PAYMENT(4));
  const { stream: overview } = await h.ready(OVERVIEW);
  assert.equal(frame.data.projectionRevision, 1);
  assert.equal((await h.control({ action: 'gap', attemptId: 'att_004_1' })).status, 200);
  const later = await payment.next();
  assert.equal(later.event, 'payment.delta');
  assert.equal(later.data.projectionRevision, 3);
  assert.equal(later.data.changes.timelineIncomplete, true);
  assert.deepEqual(later.data.changes.attemptChanges, []);
  await payment.expectNone();
  const revisions = [(await overview.next()).data.projectionRevision, (await overview.next()).data.projectionRevision];
  assert.deepEqual(revisions, [2, 3]);
  assert.ok(later.data.projectionRevision > frame.data.projectionRevision + 1, 'client detects the missing revision');
  const detail = (await h.get(`/api/payments/${PA1}/${notice(4)}`)).json;
  assert.equal(detail.projectionRevision, 3);
  assert.equal(detail.timelineIncomplete, true);
  assert.equal(detail.attempts[0].state, 'CANCELLED');
  const resynced = await h.ready(PAYMENT(4));
  assert.equal(resynced.frame.data.projectionRevision, 3);
}));

test('retention expiry publishes aggregate and payment deltas', T, () => withServer({}, async h => {
  const { stream: payment } = await h.ready(PAYMENT(3));
  const { stream: overview } = await h.ready(OVERVIEW_ALL);
  await h.control({ action: 'advanceClock', milliseconds: 86_400_000 });
  const p = await payment.next();
  assert.equal(p.event, 'payment.delta');
  assert.deepEqual(p.data.changes.removedAttemptIds, ['att_003_1']);
  assert.equal(p.data.changes.deleted, true);
  const o = await overview.next();
  assert.equal(o.data.changes.counts.payments, -1);
  assert.equal(o.data.changes.counts.attempts, -1);
}));

test('retention replay boundary returns 410 before checking deleted page keys', T, () => withServer({}, async h => {
  const { stream, frame } = await h.ready(PAYMENT_LIST([`${PA1}:${notice(3)}`]));
  await stream.close();
  await h.control({ action: 'advanceClock', milliseconds: 86_400_000 });
  const resumed = await h.open(PAYMENT_LIST([`${PA1}:${notice(3)}`]), { lastEventId: frame.id });
  assert.equal(resumed.status, 410);
  assert.equal(resumed.json.code, 'SSE_CURSOR_EXPIRED');
  assert.equal(resumed.json.resync, true);
}));

test('closing streams frees the server and unauthenticated SSE is refused', T, () => withServer({}, async h => {
  const { stream } = await h.ready(OVERVIEW);
  await stream.close();
  assert.equal((await h.get('/api/me')).status, 200);
  assert.equal((await h.open(OVERVIEW, { token: null })).status, 401);
}));
