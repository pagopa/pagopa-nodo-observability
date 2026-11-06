import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, NOW, DAY, PA1, PA2, notice } from './harness.mjs';
import { LOGICAL_STATES, ATTEMPT_STATES } from '../model.mjs';

const T = { timeout: 30_000 };
// Interval covering the whole retention of the fixtures (every dated attempt), slightly open to the future.
const ALL = `from=${new Date(NOW - 60 * DAY + 2 * 3_600_000).toISOString()}&to=${new Date(NOW + 3_600_000).toISOString()}`;
const sum = (list, field = 'count') => list.reduce((n, r) => n + r[field], 0);
const allAttempts = async h => {
  const out = [];
  let cursor;
  do {
    const r = await h.get(`/api/attempts?pageSize=100${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(r.status, 200);
    out.push(...r.json.items); cursor = r.json.nextCursor;
  } while (cursor);
  return out;
};

test('catalog exposes exactly five logical and eighteen attempt states', T, () => withServer({}, async h => {
  const r = await h.get('/api/catalog');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.logicalStates, ['INSERTED', 'PAYING', 'PAID', 'NOTICE_STORED', 'NOTIFIED']);
  assert.equal(r.json.attemptStates.length, 18);
  assert.deepEqual(r.json.attemptStates, ['PAYING', 'PAYING_RPT', 'PAID_NORPT', 'PAID', 'FAILED_NORPT', 'FAILED', 'CANCELLED',
    'CANCELLED_NORPT', 'NOTICE_GENERATED', 'NOTICE_STORED', 'NOTICE_SENT', 'NOTIFIED', 'PAYMENT_RESERVED', 'PAYMENT_SENT',
    'PAYMENT_ACCEPTED', 'PAYMENT_REFUSED', 'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR']);
  assert.deepEqual(r.json.logicalStates, LOGICAL_STATES);
  assert.deepEqual(r.json.attemptStates, ATTEMPT_STATES);
  assert.equal(r.json.unknownFilterValue, '~unknown');
  assert.deepEqual(r.json.warningStates, ['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR']);
}));

test('service identifiers are sorted, unique strings from visible attempts', T, () => withServer({}, async h => {
  for (const token of ['DEMO_VIEWER', 'DEMO_PA_VIEWER']) {
    const attempts = (await h.get('/api/attempts?pageSize=100', { token })).json.items;
    if (token === 'DEMO_VIEWER') {
      assert.ok(attempts.some(attempt => attempt.serviceIdentifier === null),
        'visible attempts include one with a null service identifier');
    }
    const catalog = (await h.get('/api/catalog', { token })).json;
    assert.deepEqual(catalog.serviceIdentifiers,
      [...new Set(attempts.map(attempt => attempt.serviceIdentifier))].sort());
    const expected = [...new Set(attempts.map(attempt => attempt.serviceIdentifier)
      .filter(identifier => typeof identifier === 'string'))].sort();
    const response = await h.get('/api/serviceIdentifiers', { token });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.json));
    assert.deepEqual(response.json, expected);
    assert.deepEqual(response.json, catalog.serviceIdentifiers.filter(identifier => typeof identifier === 'string'));
    assert.equal(response.json.includes(null), false);
    assert.equal(response.json.every(identifier => typeof identifier === 'string' && identifier !== null), true);
    assert.equal(new Set(response.json).size, response.json.length);
  }
}));

test('attempt timelines expose the primitive that caused each transition', T, () => withServer({}, async h => {
  const payment = (await h.get(`/api/payments/${PA1}/${notice(1)}`)).json;
  assert.deepEqual(
    payment.attempts[0].timeline.slice(0, 3).map(transition => transition.trigger),
    ['activatePaymentNotice', 'closePayment', 'pspNotifyPayment']
  );
}));

test('health, me, freshness for every role', T, () => withServer({}, async h => {
  const health = await h.get('/health', { token: null });
  assert.equal(health.status, 200);
  assert.equal(health.json.status, 'ok');
  assert.equal((await h.get('/health?x=1', { token: null })).status, 400);
  const expected = {
    DEMO_VIEWER: ['viewer', null, false, false], DEMO_PA_VIEWER: ['viewer', [PA1], false, false],
    DEMO_OPERATOR: ['operator', null, true, false], DEMO_ADMIN: ['admin', null, true, true]
  };
  for (const [token, [role, pas, tokens, controls]] of Object.entries(expected)) {
    const me = await h.get('/api/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.json.role, role);
    assert.deepEqual(me.json.visiblePaFiscalCodes, pas);
    assert.equal(me.json.capabilities.lookupToken, tokens);
    assert.equal(me.json.capabilities.revealToken, tokens);
    assert.equal(me.json.capabilities.mockControls, controls);
    assert.equal((await h.get('/api/freshness', { token })).status, 200);
  }
  const fresh = (await h.get('/api/freshness')).json;
  assert.equal(fresh.status, 'CURRENT');
  assert.equal(fresh.observedAt, '2026-10-16T10:00:00.000Z');
}));

test('missing, unknown and malformed credentials get 401 on every business endpoint', T, () => withServer({}, async h => {
  const endpoints = ['/api/me', '/api/catalog', '/api/serviceIdentifiers', '/api/freshness', '/api/payments', '/api/attempts',
    `/api/payments/${PA1}/${notice(1)}`, '/api/overview', '/api/overview/primitive-warnings?primitive=pspNotifyPayment', '/api/creditors', `/api/creditors/${PA1}`,
    `/api/creditors/${PA1}/stations`, `/api/events?scope=overview`];
  const bad = [undefined, 'Bearer NOPE', 'Bearer', 'Basic DEMO_ADMIN', 'DEMO_ADMIN', 'bearer DEMO_ADMIN', 'Bearer  DEMO_ADMIN',
    'Bearer toString', 'Bearer constructor', 'Bearer __proto__', 'Bearer hasOwnProperty'];
  for (const path of endpoints) for (const authorization of bad) {
    const r = await h.get(path, { token: null, headers: authorization ? { Authorization: authorization } : {} });
    assert.equal(r.status, 401, `${path} with ${authorization}`);
    assert.equal(r.json.code, 'UNAUTHENTICATED');
    assert.match(r.headers.get('www-authenticate'), /^Bearer/);
  }
  for (const [method, path] of [['POST', '/api/token-lookup'], ['POST', '/api/attempts/att_001_1/reveal'],
    ['POST', '/__mock/control'], ['GET', '/__mock/audit']]) {
    assert.equal((await h.call(method, path, { token: 'Bearer', ...(method === 'POST' ? { body: {} } : {}) })).status, 401);
  }
  assert.equal((await h.get('/api/me?token=DEMO_ADMIN', { token: null })).status, 401);
  assert.equal((await h.get('/api/me', { headers: { Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await h.get('/api/serviceIdentifiers', { headers: { Origin: 'http://evil.example' } })).status, 403);
  const events = await h.open({ scope: 'overview' }, { token: 'NOPE' });
  assert.equal(events.status, 401);
}));

test('query parameters are strictly validated', T, () => withServer({}, async h => {
  const bad = ['unknown=1', 'psp=a&psp=b', 'psp=', 'logicalState=NOPE', 'attemptState=PAYING_X', 'logicalState=PAYING_RPT',
    'anomaliesOnly=yes', 'unresolvedOnly=1', 'paFiscalCode=123', 'noticeNumber=abc', 'pageSize=0', 'pageSize=101',
    'pageSize=abc', 'pageSize=1.5', 'pageSize=-1', 'sort=other', 'cursor=bad', `psp=${'x'.repeat(257)}`, 'from=2026-01-01T00:00:00.000Z'];
  for (const path of ['/api/payments', '/api/attempts']) for (const q of bad) {
    const r = await h.get(`${path}?${q}`);
    assert.equal(r.status, 400, `${path}?${q}`);
    assert.equal(r.json.code, 'INVALID_REQUEST');
  }
  const badWindows = ['from=2026-10-01', 'from=2026-10-01T00:00:00Z', 'to=garbage', 'from=2026-10-10T00:00:00.000Z&to=2026-10-10T00:00:00.000Z',
    'from=2026-10-10T00:00:00.000Z&to=2026-10-09T00:00:00.000Z', 'from=2026-06-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z',
    'from=2026-02-30T00:00:00.000Z&to=2026-03-02T00:00:00.000Z', 'pageSize=3', 'cursor=x'];
  for (const q of badWindows) assert.equal((await h.get(`/api/overview?${q}`)).status, 400, q);
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(1)}?x=1`)).status, 400);
  assert.equal((await h.get('/api/catalog?x=1')).status, 400);
  assert.equal((await h.get('/api/serviceIdentifiers?x=1')).status, 400);
  assert.equal((await h.get('/api/creditors?sort=bogus')).status, 400);
  assert.equal((await h.get(`/api/creditors/${PA1}?pageSize=1`)).status, 400);
  assert.equal((await h.get(`/api/creditors/${PA1}?paFiscalCode=${PA2}`)).status, 400);
  assert.equal((await h.get('/api/payments?sort=key')).status, 200);
  assert.equal((await h.get('/api/payments?anomaliesOnly=false&unresolvedOnly=false')).status, 200);
  assert.equal((await h.get('/api/overview?from=2026-09-16T10:00:00.000Z&to=2026-10-16T10:00:00.000Z')).status, 200);
}));

test('payments and attempts lists, filters and entity-specific states', T, () => withServer({}, async h => {
  const payments = (await h.get('/api/payments')).json;
  assert.equal(payments.items.length, 8);
  assert.equal(payments.nextCursor, null);
  const attempts = await allAttempts(h);
  assert.equal(attempts.length, 9);
  for (const forbidden of ['total', 'totalCount', 'count', 'totalItems']) {
    assert.equal(forbidden in payments, false);
  }
  const ids = async q => (await h.get(q)).json.items.map(i => i.noticeNumber);
  assert.deepEqual(await ids(`/api/payments?paFiscalCode=${PA2}`), [5, 6, 7, 8].map(notice));
  assert.deepEqual(await ids('/api/payments?logicalState=PAID'), [notice(2)]);
  assert.deepEqual(await ids('/api/payments?logicalState=NOTIFIED'), [notice(6)]);
  assert.deepEqual(await ids('/api/payments?logicalState=NOTICE_STORED'), [notice(5)]);
  assert.deepEqual(await ids('/api/payments?attemptState=NOTIFIED'), [notice(6)]);
  assert.deepEqual(await ids('/api/payments?attemptState=PAID'), [notice(2)]);
  assert.deepEqual(await ids('/api/payments?unresolvedOnly=true'), [1, 4].map(notice));
  assert.deepEqual(await ids('/api/payments?anomaliesOnly=true'), [notice(8)]);
  assert.deepEqual(await ids('/api/payments?psp=~unknown'), [notice(8)]);
  assert.deepEqual(await ids(`/api/payments?noticeNumber=${notice(3)}`), [notice(3)]);
  assert.deepEqual(await ids('/api/payments?serviceIdentifier=SYNTHETIC_SERVICE_B'), [2, 4, 6].map(notice));
  assert.deepEqual(await ids('/api/payments?stazione=00000000002_01'), [5, 7].map(notice));
  const unresolved = (await h.get('/api/attempts?unresolvedOnly=true')).json.items;
  assert.deepEqual(unresolved.map(a => [a.attemptId, a.state, a.warning]),
    [['att_001_1', 'PAYMENT_UNKNOWN', true], ['att_004_1', 'PAYMENT_SEND_ERROR', true]]);
  assert.equal((await h.get('/api/payments?psp=NOPE')).json.items.length, 0);
  assert.equal(attempts.find(a => a.attemptId === 'att_006_1').state, 'NOTIFIED');
  assert.equal(payments.items.find(p => p.noticeNumber === notice(6)).state, 'NOTIFIED');
  for (const a of attempts) {
    assert.match(a.tokenDisplay, /SYNTHETIC-TOKEN/);
    assert.equal('paymentToken' in a, false);
    assert.equal('expiresAt' in a || 'firstSeenAt' in a, false);
  }
}));

test('combined psp and canale filters work on lists but are rejected by aggregates', T, () => withServer({}, async h => {
  const list = await h.get('/api/attempts?psp=ABI00001&canale=SYNTHETIC_CHANNEL_A');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.items.map(a => a.attemptId), ['att_001_1', 'att_003_1', 'att_005_1', 'att_007_1']);
  assert.equal((await h.get('/api/attempts?psp=ABI00001&canale=SYNTHETIC_CHANNEL_B')).json.items.length, 0);
  assert.equal((await h.get('/api/payments?psp=ABI00001&canale=SYNTHETIC_CHANNEL_A')).json.items.length, 4);
  for (const path of ['/api/overview', '/api/creditors', `/api/creditors/${PA1}`, `/api/creditors/${PA1}/stations`]) {
    const r = await h.get(`${path}?psp=ABI00001&canale=SYNTHETIC_CHANNEL_A`);
    assert.equal(r.status, 422, path);
    assert.equal(r.json.code, 'UNSUPPORTED_AGGREGATION');
    assert.equal(r.json.fallback, '/api/attempts');
  }
  assert.equal((await h.get('/api/overview?serviceIdentifier=SYNTHETIC_SERVICE_A&psp=ABI00001')).status, 422);
  assert.equal((await h.get('/api/overview?stazione=00000000001_01')).status, 422);
  assert.equal((await h.get(`/api/overview?stazione=00000000001_01&paFiscalCode=${PA1}`)).status, 200);
  assert.equal((await h.get('/api/overview?psp=ABI00001')).status, 200);
}));

test('payment detail exposes clear tokens and timelines, 404 for unknown', T, () => withServer({}, async h => {
  const r = await h.get(`/api/payments/${PA1}/${notice(2)}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.state, 'PAID');
  assert.equal(r.json.attempts.length, 2);
  assert.deepEqual(r.json.timeline.map(t => t.state), ['PAYING', 'INSERTED', 'PAYING', 'PAID']);
  assert.deepEqual(r.json.attempts[0].timeline.map(t => t.state), ['PAYING', 'CANCELLED']);
  assert.equal(r.json.attempts[1].state, 'PAID');
  for (const a of r.json.attempts) assert.match(a.tokenDisplay, /SYNTHETIC-TOKEN/);
  assert.equal((await h.get(`/api/payments/${PA1}/${'300000000000000099'}`)).status, 404);
  assert.equal((await h.get(`/api/payments/${PA2}/${notice(1)}`)).status, 404);
  assert.equal((await h.get('/api/payments/abc/def')).status, 404);
}));

test('anomalies, missing timestamps and estimated starts', T, () => withServer({}, async h => {
  const missing = (await h.get(`/api/payments/${PA2}/${notice(8)}`)).json;
  assert.equal(missing.hasAnomaly, true);
  assert.equal(missing.timelineIncomplete, true);
  const a = missing.attempts[0];
  assert.equal(a.attemptStartedAt, null);
  assert.equal(a.startTimestampBasis, 'ANOMALY');
  assert.equal(a.hasAnomaly, true);
  assert.equal(a.psp, null);
  assert.deepEqual(a.timeline.map(t => [t.transitionAt, t.timestampBasis]), [[null, 'ANOMALY']]);
  const estimated = (await h.get(`/api/payments/${PA2}/${notice(7)}`)).json.attempts[0];
  assert.equal(estimated.startTimestampBasis, 'INFERRED');
  assert.equal(estimated.timeline[0].timestampBasis, 'INFERRED');
  assert.equal(estimated.timeline[1].timestampBasis, 'SOURCE_EVENT');
  assert.equal(estimated.timelineIncomplete, true);
  const overview = (await h.get(`/api/overview?${new URLSearchParams({
    from: new Date(NOW - 30 * DAY).toISOString(),
    to: new Date(NOW).toISOString()
  })}`)).json;
  // The fully undated payment cannot be attributed to any interval: it stays out of windowed aggregates ...
  assert.deepEqual(overview.anomalies, { transitions: 0, payments: 0 });
  // ... but remains reachable without an interval.
  assert.deepEqual((await h.get('/api/payments?anomaliesOnly=true')).json.items.map(p => p.noticeNumber), [notice(8)]);
  assert.equal(sum(overview.traffic, 'estimatedStarts'), 1);
  assert.equal(overview.transitions.some(t => t.timestampBasis === 'ANOMALY'), false);
  assert.equal(overview.transitions.some(t => t.timestampBasis === 'INFERRED'), true);
  const start = Date.parse(estimated.attemptStartedAt);
  assert.equal(start, NOW - 2 * DAY);
}));

test('overview counts and matrices cover only entities active in the selected window', T, () => withServer({}, async h => {
  const all = await allAttempts(h);
  const wideWindow = { from: new Date(NOW - 30 * DAY).toISOString(), to: new Date(NOW).toISOString() };
  const inWide = all.filter(a => a.attemptStartedAt && Date.parse(a.attemptStartedAt) >= NOW - 30 * DAY);
  const o = (await h.get(`/api/overview?${new URLSearchParams(wideWindow)}`)).json;
  assert.equal(o.snapshotAt, '2026-10-16T10:00:00.000Z');
  assert.equal(o.counts.payments, 6);
  assert.equal(o.counts.attempts, inWide.length);
  assert.ok(o.counts.attempts < all.length);
  assert.equal(sum(o.logicalStates), o.counts.payments);
  assert.equal(sum(o.attemptStates), o.counts.attempts);
  assert.deepEqual(o.logicalStates.map(s => s.state), LOGICAL_STATES);
  assert.deepEqual(o.attemptStates.map(s => s.state), ATTEMPT_STATES);
  for (const dim of ['psp', 'canale']) {
    assert.equal(o.matrices[dim].reduce((n, row) => n + sum(row.states), 0), inWide.length, dim);
    for (const row of o.matrices[dim]) {
      assert.deepEqual(row.states.map(s => s.state), ATTEMPT_STATES);
      assert.equal(sum(row.states), inWide.filter(a => a[dim] === row.value).length);
    }
  }
  assert.deepEqual(o.unresolved, { payments: 2, attempts: 2 });
  assert.equal(sum(o.traffic, 'startedAttempts'), inWide.length);
  const narrowWindow = new URLSearchParams({ from: '2026-10-14T00:00:00.000Z', to: '2026-10-16T10:00:00.000Z' });
  const narrow = (await h.get(`/api/overview?${narrowWindow}`)).json;
  assert.equal(narrow.window.from, '2026-10-14T00:00:00.000Z');
  assert.equal(narrow.snapshotAt, o.snapshotAt);
  assert.ok(narrow.counts.attempts < o.counts.attempts);
  assert.ok(narrow.counts.payments < o.counts.payments);
  assert.equal(sum(narrow.attemptStates), narrow.counts.attempts);
  assert.equal(sum(narrow.logicalStates), narrow.counts.payments);
  // Lists opened from the overview use the same interval and return the same entities.
  const listed = (await h.get(`/api/attempts?pageSize=100&${narrowWindow}`)).json.items;
  assert.equal(listed.length, narrow.counts.attempts);
  assert.equal((await h.get(`/api/payments?pageSize=100&${narrowWindow}`)).json.items.length, narrow.counts.payments);
  assert.deepEqual(o.traffic.map(t => t.bucketStart), [...o.traffic.map(t => t.bucketStart)].sort());
  const filtered = (await h.get(`/api/overview?psp=ABI00001&${ALL}`)).json;
  assert.equal(filtered.counts.attempts, 4);
  assert.equal(filtered.matrices.psp.length, 1);
  assert.equal(sum(filtered.attemptStates), 4);
}));

test('the right edge of a live window stays open while a closed window excludes later activity', T, () => withServer({}, async h => {
  const params = live => new URLSearchParams({ from: new Date(NOW - 60 * 60_000).toISOString(),
    to: new Date(NOW).toISOString(), ...(live ? { live: 'true' } : {}) });
  const closed = (await h.get(`/api/overview?${params(false)}`)).json;
  await h.control({ action: 'advanceClock', milliseconds: 1000 });
  assert.equal((await h.control({ action: 'resolve', attemptId: 'att_001_1' })).status, 200);
  const live = (await h.get(`/api/overview?${params(true)}`)).json;
  const stillClosed = (await h.get(`/api/overview?${params(false)}`)).json;
  const stateCount = (o, state) => o.attemptStates.find(row => row.state === state).count;
  assert.equal(stateCount(live, 'PAID'), stateCount(closed, 'PAID') + 1);
  assert.deepEqual(stillClosed.attemptStates, closed.attemptStates);
}));

test('overview duration quantiles are real nearest-rank sample statistics', T, () => withServer({}, async h => {
  const response = await h.get(`/api/overview?${new URLSearchParams({
    from: new Date(NOW - 30 * DAY).toISOString(),
    to: new Date(NOW + DAY).toISOString()
  })}`);
  assert.equal(response.status, 200);
  const row = response.json.durations.find(item => item.entity === 'logical'
    && item.fromState === 'PAYING' && item.toState === 'PAID' && item.timestampBasis === 'SOURCE_EVENT');
  assert.ok(row);
  assert.equal(row.samples, 3);
  assert.equal(row.averageMs, 120_000);
  assert.equal(row.medianMs, 60_000);
  assert.equal(row.p95Ms, 240_000);
  assert.notEqual(row.medianMs, row.averageMs);
  assert.deepEqual(Object.keys(row).sort(),
    ['averageMs', 'entity', 'fromState', 'medianMs', 'p95Ms', 'samples', 'timestampBasis', 'toState'].sort());
}));

test('aggregate API defaults to the shared one-hour window', T, () => withServer({}, async h => {
  const overview = (await h.get('/api/overview')).json;
  assert.deepEqual(overview.window, {
    from: new Date(NOW - 60 * 60_000).toISOString(),
    to: new Date(NOW).toISOString()
  });
}));

test('creditors, stations and traffic match each other', T, () => withServer({}, async h => {
  const list = (await h.get('/api/creditors')).json;
  assert.deepEqual(list.items.map(i => i.paFiscalCode).sort(), [PA1, PA2]);
  const overview = (await h.get('/api/overview')).json;
  for (const row of list.items) {
    const detail = (await h.get(`/api/creditors/${row.paFiscalCode}`)).json;
    const stations = (await h.get(`/api/creditors/${row.paFiscalCode}/stations`)).json;
    assert.equal(detail.paFiscalCode, row.paFiscalCode);
    assert.equal(row.startedAttempts, sum(detail.traffic, 'startedAttempts'));
    assert.deepEqual(row.counts, detail.counts);
    assert.equal(sum(stations.items, 'startedAttempts'), row.startedAttempts);
    assert.equal(stations.items.reduce((n, s) => n + sum(s.attemptStates), 0), detail.counts.attempts);
    assert.equal(stations.items.reduce((n, s) => n + s.unresolved.attempts, 0), detail.unresolved.attempts);
    for (const s of stations.items) assert.equal(sum(s.traffic, 'startedAttempts'), s.startedAttempts);
  }
  assert.equal(sum(list.items, 'startedAttempts'), sum(overview.traffic, 'startedAttempts'));
  const st1 = (await h.get(`/api/creditors/${PA1}/stations`)).json.items.map(s => s.stazione);
  assert.deepEqual(st1, [`${PA1}_01`, `${PA1}_02`]);
  const st2 = (await h.get(`/api/creditors/${PA2}/stations`)).json.items.map(s => s.stazione);
  assert.deepEqual(st2, [`${PA2}_01`, `${PA2}_02`, null]);
  assert.deepEqual((await h.get('/api/creditors?sort=unresolved')).json.items[0].paFiscalCode, PA1);
  assert.equal((await h.get('/api/creditors/00000000009')).status, 404);
  assert.equal((await h.get('/api/creditors/00000000009/stations')).status, 404);
  const paged = (await h.get('/api/creditors?pageSize=1')).json;
  assert.equal(paged.items.length, 1);
  assert.ok(paged.nextCursor);
  assert.equal((await h.get(`/api/creditors?pageSize=1&cursor=${paged.nextCursor}`)).json.items.length, 1);
}));

test('freshness is independent from filters and follows controls', T, () => withServer({}, async h => {
  const c = await h.control({ action: 'freshness', status: 'DELAYED', lagSeconds: 90, gapsDetected: true });
  assert.equal(c.status, 200);
  const base = (await h.get('/api/freshness')).json;
  assert.deepEqual([base.status, base.lagSeconds, base.gapsDetected], ['DELAYED', 90, true]);
  for (const path of ['/api/overview?psp=ABI00001', `/api/overview?paFiscalCode=${PA2}&unresolvedOnly=true`,
    '/api/overview?psp=NOPE', `/api/creditors/${PA1}?psp=ABI00001`]) {
    const r = await h.get(path);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.freshness, base, path);
  }
  assert.equal((await h.control({ action: 'freshness', status: 'BOGUS', lagSeconds: 1, gapsDetected: false })).status, 400);
}));

test('resolution removes the warning and updates aggregates', T, () => withServer({}, async h => {
  const before = (await h.get(`/api/overview?${ALL}`)).json;
  assert.equal((await h.control({ action: 'resolve', attemptId: 'att_001_1' })).status, 200);
  const detail = (await h.get(`/api/payments/${PA1}/${notice(1)}`)).json;
  assert.equal(detail.attempts[0].state, 'PAID');
  assert.equal(detail.attempts[0].warning, false);
  assert.equal(detail.warning, false);
  assert.equal(detail.state, 'PAID');
  assert.equal(detail.projectionRevision, 2);
  assert.deepEqual((await h.get('/api/attempts?unresolvedOnly=true')).json.items.map(a => a.attemptId), ['att_004_1']);
  const after = (await h.get(`/api/overview?${ALL}`)).json;
  assert.deepEqual(after.unresolved, { payments: 1, attempts: 1 });
  assert.equal(after.projectionRevision, before.projectionRevision + 1);
  assert.equal(after.counts.attempts, before.counts.attempts);
  assert.equal((await h.control({ action: 'resolve', attemptId: 'att_001_1' })).status, 400);
  assert.equal((await h.control({ action: 'resolve', attemptId: 'att_999_1' })).status, 404);
  assert.equal((await h.control({ action: 'gap', attemptId: 'att_004_1' })).status, 200);
  const gap = (await h.get(`/api/payments/${PA1}/${notice(4)}`)).json;
  assert.equal(gap.attempts[0].state, 'CANCELLED');
  assert.equal(gap.warning, false);
  assert.equal(gap.timelineIncomplete, true);
}));

test('pagination cursors are opaque and bound to user, filters, sort and size', T, () => withServer({}, async h => {
  const first = (await h.get('/api/attempts?pageSize=4&psp=ABI00001')).json;
  assert.equal(first.items.length, 4);
  assert.equal(first.nextCursor, null);
  const p1 = (await h.get('/api/attempts?pageSize=4')).json;
  assert.equal(p1.items.length, 4);
  assert.match(p1.nextCursor, /^[\w-]{32}$/);
  assert.equal(Object.keys(p1).sort().join(), 'items,nextCursor,snapshotRevision');
  const p2 = (await h.get(`/api/attempts?pageSize=4&cursor=${p1.nextCursor}`)).json;
  const p3 = (await h.get(`/api/attempts?pageSize=4&cursor=${p2.nextCursor}`)).json;
  const ids = [...p1.items, ...p2.items, ...p3.items].map(a => a.attemptId);
  assert.equal(new Set(ids).size, 9);
  assert.equal(p3.items.length, 1);
  assert.equal(p3.nextCursor, null);
  assert.deepEqual(ids, [...ids].sort());
  const c = p1.nextCursor;
  for (const bad of [`/api/attempts?pageSize=4&psp=ABI00001&cursor=${c}`, `/api/attempts?pageSize=3&cursor=${c}`,
    `/api/payments?pageSize=4&cursor=${c}`, `/api/attempts?cursor=${c}&sort=key&pageSize=2`, 'cursor=short']) {
    const r = await h.get(bad.startsWith('/') ? bad : `/api/attempts?${bad}`);
    assert.equal(r.status, 400, bad);
  }
  assert.equal((await h.get(`/api/attempts?pageSize=4&cursor=${c}`, { token: 'DEMO_OPERATOR' })).status, 400);
  assert.equal((await h.get(`/api/attempts?pageSize=4&cursor=${'A'.repeat(32)}`)).status, 410);
  const x = (await h.get('/api/attempts?pageSize=4')).json.nextCursor;
  assert.notEqual(x, c);
}));

test('cursors expire by TTL (410) and when the snapshot changes', T, () => withServer({ cursorTtlMs: 60_000 }, async h => {
  const a = (await h.get('/api/attempts?pageSize=2')).json.nextCursor;
  const b = (await h.get('/api/attempts?pageSize=2')).json.nextCursor;
  const ok = await h.get(`/api/attempts?pageSize=2&cursor=${a}`);
  assert.equal(ok.status, 200);
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const stale = await h.get(`/api/attempts?pageSize=2&cursor=${b}`);
  assert.equal(stale.status, 410);
  assert.equal(stale.json.code, 'CURSOR_EXPIRED');
  const fresh = (await h.get('/api/attempts?pageSize=2')).json.nextCursor;
  await h.control({ action: 'advanceClock', milliseconds: 61_000 });
  assert.equal((await h.get(`/api/attempts?pageSize=2&cursor=${fresh}`)).status, 410);
  const creditorsCursor = (await h.get('/api/creditors?pageSize=1')).json.nextCursor;
  await h.control({ action: 'advanceClock', milliseconds: 61_000 });
  assert.equal((await h.get(`/api/creditors?pageSize=1&cursor=${creditorsCursor}`)).status, 410);
}));

test('token lookup and reveal are audited for authorised operators', T, () => withServer({}, async h => {
  const lookup = await h.call('POST', '/api/token-lookup', { token: 'DEMO_OPERATOR', body: { paymentToken: 'SYNTHETIC-TOKEN-2-2' } });
  assert.equal(lookup.status, 200);
  assert.deepEqual(lookup.json, { paFiscalCode: PA1, noticeNumber: notice(2), attemptId: 'att_002_2', projectionRevision: 1 });
  const reveal = await h.call('POST', '/api/attempts/att_002_2/reveal', { token: 'DEMO_OPERATOR', body: {} });
  assert.equal(reveal.status, 200);
  assert.deepEqual(reveal.json, { attemptId: 'att_002_2', paymentToken: 'SYNTHETIC-TOKEN-2-2' });
  assert.equal((await h.call('POST', '/api/token-lookup', { token: 'DEMO_OPERATOR', body: { paymentToken: 'NOPE' } })).status, 404);
  const audit = await h.get('/__mock/audit');
  assert.equal(audit.status, 200);
  assert.deepEqual(audit.json.items.map(i => [i.actorId, i.action, i.attemptId]),
    [['demo-operator', 'TOKEN_LOOKUP', 'att_002_2'], ['demo-operator', 'TOKEN_REVEAL', 'att_002_2'], ['demo-operator', 'TOKEN_LOOKUP', null]]);
  for (const item of audit.json.items) assert.equal(item.recordedAt, '2026-10-16T10:00:00.000Z');
  const detail = await h.get(`/api/payments/${PA1}/${notice(2)}`, { token: 'DEMO_OPERATOR' });
  assert.match(detail.json.attempts[1].tokenDisplay, /SYNTHETIC-TOKEN/);
  assert.equal((await h.get('/api/attempts', { token: 'DEMO_ADMIN' })).status, 200);
  assert.equal((await h.call('POST', '/api/attempts/att_999_9/reveal', { token: 'DEMO_ADMIN', body: {} })).status, 404);
  assert.equal((await h.call('POST', '/api/token-lookup', { token: 'DEMO_ADMIN', body: { paymentToken: 'SYNTHETIC-TOKEN-1-1', extra: 1 } })).status, 400);
  assert.equal((await h.call('POST', '/api/token-lookup', { token: 'DEMO_ADMIN', body: { paymentToken: '' } })).status, 400);
  assert.equal((await h.call('POST', '/api/token-lookup', { token: 'DEMO_ADMIN', raw: '{', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await h.call('POST', '/api/token-lookup', { token: 'DEMO_ADMIN', body: { paymentToken: 'x' }, headers: { 'Content-Type': 'text/plain' } })).status, 400);
  assert.equal((await h.call('POST', '/api/attempts/att_001_1/reveal', { token: 'DEMO_ADMIN', body: { a: 1 } })).status, 400);
  assert.equal((await h.call('POST', '/api/attempts/att_001_1/reveal?x=1', { token: 'DEMO_ADMIN', body: {} })).status, 400);
  const full = (await h.get('/__mock/audit')).json.items;
  assert.equal(JSON.stringify(full).includes('SYNTHETIC'), false);
  assert.equal(full.every(i => !('paymentToken' in i)), true);
}));

test('token lookup preserves optional PA and NAV constraints without exposing the token in the URL', T, () => withServer({}, async h => {
  const constrained = await h.call('POST', '/api/token-lookup', {
    token: 'DEMO_OPERATOR',
    body: { paymentToken: 'SYNTHETIC-TOKEN-2-2', paFiscalCode: PA1, noticeNumber: notice(2) }
  });
  assert.equal(constrained.status, 200);
  assert.equal(constrained.json.attemptId, 'att_002_2');
  const mismatch = await h.call('POST', '/api/token-lookup', {
    token: 'DEMO_OPERATOR',
    body: { paymentToken: 'SYNTHETIC-TOKEN-2-2', paFiscalCode: PA2, noticeNumber: notice(2) }
  });
  assert.equal(mismatch.status, 404);
  assert.equal((await h.call('POST', '/api/token-lookup', {
    token: 'DEMO_OPERATOR',
    body: { paymentToken: 'SYNTHETIC-TOKEN-2-2', paFiscalCode: 'invalid' }
  })).status, 400);
}));

test('viewers are denied token lookup and reveal without audit records', T, () => withServer({}, async h => {
  for (const token of ['DEMO_VIEWER', 'DEMO_PA_VIEWER']) {
    const lookup = await h.call('POST', '/api/token-lookup', { token, body: { paymentToken: 'SYNTHETIC-TOKEN-1-1' } });
    assert.equal(lookup.status, 403);
    assert.equal(lookup.json.code, 'FORBIDDEN');
    const reveal = await h.call('POST', '/api/attempts/att_001_1/reveal', { token, body: {} });
    assert.equal(reveal.status, 403);
  }
  assert.deepEqual((await h.get('/__mock/audit')).json.items, []);
}));

test('every authenticated role sees paymentToken in clear on readable payment data', T, () => withServer({}, async h => {
  for (const token of ['DEMO_VIEWER', 'DEMO_PA_VIEWER', 'DEMO_OPERATOR', 'DEMO_ADMIN']) {
    const list = await h.get('/api/attempts?pageSize=100', { token });
    assert.equal(list.status, 200);
    assert.equal(list.json.items.find(a => a.attemptId === 'att_001_1').tokenDisplay, 'SYNTHETIC-TOKEN-1-1');

    const detail = await h.get(`/api/payments/${PA1}/${notice(1)}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.attempts[0].tokenDisplay, 'SYNTHETIC-TOKEN-1-1');
  }
}));

test('audit failure fails closed for lookup and reveal', T, () => withServer({}, async h => {
  assert.equal((await h.control({ action: 'auditFailure', enabled: true })).status, 200);
  const lookup = await h.call('POST', '/api/token-lookup', { token: 'DEMO_OPERATOR', body: { paymentToken: 'SYNTHETIC-TOKEN-1-1' } });
  assert.equal(lookup.status, 500);
  assert.equal(lookup.json.code, 'AUDIT_UNAVAILABLE');
  const reveal = await h.call('POST', '/api/attempts/att_001_1/reveal', { token: 'DEMO_OPERATOR', body: {} });
  assert.equal(reveal.status, 500);
  assert.doesNotMatch(reveal.text, /SYNTHETIC-TOKEN/);
  assert.deepEqual((await h.get('/__mock/audit')).json.items, []);
  await h.control({ action: 'auditFailure', enabled: false });
  assert.equal((await h.call('POST', '/api/attempts/att_001_1/reveal', { token: 'DEMO_OPERATOR', body: {} })).status, 200);
}));

test('audit sink rejection also fails closed', T, () => withServer({ audit: async () => { throw new Error('sink down'); } }, async h => {
  const reveal = await h.call('POST', '/api/attempts/att_001_1/reveal', { token: 'DEMO_OPERATOR', body: {} });
  assert.equal(reveal.status, 500);
  assert.doesNotMatch(reveal.text, /SYNTHETIC-TOKEN/);
  assert.deepEqual((await h.get('/__mock/audit')).json.items, []);
}));

test('limited PA viewer cannot see inaccessible data anywhere', T, () => withServer({}, async h => {
  const token = 'DEMO_PA_VIEWER';
  const payments = (await h.get('/api/payments', { token })).json.items;
  assert.deepEqual(payments.map(p => p.paFiscalCode), [PA1, PA1, PA1, PA1]);
  assert.equal((await h.get(`/api/payments?paFiscalCode=${PA2}`, { token })).json.items.length, 0);
  assert.equal((await h.get(`/api/payments/${PA2}/${notice(5)}`, { token })).status, 404);
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(1)}`, { token })).status, 200);
  const attempts = (await h.get('/api/attempts?pageSize=100', { token })).json.items;
  assert.equal(attempts.length, 5);
  assert.equal(attempts.every(a => a.paFiscalCode === PA1), true);
  const o = (await h.get(`/api/overview?${ALL}`, { token })).json;
  assert.equal(o.counts.payments, 4);
  assert.equal(o.counts.attempts, 5);
  assert.equal(JSON.stringify(o).includes(PA2), false);
  const catalog = (await h.get('/api/catalog', { token })).json;
  assert.equal(catalog.stazioni.every(s => s?.startsWith(PA1)), true);
  assert.deepEqual((await h.get('/api/serviceIdentifiers', { token })).json,
    catalog.serviceIdentifiers.filter(identifier => typeof identifier === 'string'));
  const creditors = (await h.get('/api/creditors', { token })).json.items;
  assert.deepEqual(creditors.map(c => c.paFiscalCode), [PA1]);
  for (const path of [`/api/creditors/${PA2}`, `/api/creditors/${PA2}/stations`]) assert.equal((await h.get(path, { token })).status, 404);
  assert.equal((await h.get(`/api/creditors/${PA1}`, { token })).status, 200);
  assert.equal((await h.get(`/api/creditors/${PA1}/stations`, { token })).status, 200);
  assert.equal((await h.get(`/api/overview?paFiscalCode=${PA2}`, { token })).json.counts.attempts, 0);
  assert.equal((await h.open({ scope: 'payment', paFiscalCode: PA2, noticeNumber: notice(5) }, { token })).status, 404);
  assert.equal((await h.open({ scope: 'creditor', paFiscalCode: PA2 }, { token })).status, 404);
  assert.equal((await h.open({ scope: 'station', paFiscalCode: PA2, stazione: `${PA2}_01` }, { token })).status, 404);
  assert.equal((await h.call('POST', '/__mock/control', { token, body: { action: 'duplicate' } })).status, 403);
  assert.equal((await h.get('/__mock/audit', { token })).status, 403);
  const reveal = await h.call('POST', '/api/attempts/att_005_1/reveal', { token: 'DEMO_OPERATOR', body: {} });
  assert.equal(reveal.status, 200);
}));

test('mock controls validate input and require admin', T, () => withServer({}, async h => {
  for (const token of ['DEMO_VIEWER', 'DEMO_PA_VIEWER', 'DEMO_OPERATOR']) {
    assert.equal((await h.control({ action: 'duplicate' }, token)).status, 403);
    assert.equal((await h.get('/__mock/audit', { token })).status, 403);
  }
  for (const body of [{}, { action: 'nope' }, { action: 'duplicate', extra: 1 }, { action: 'advanceClock', milliseconds: -1 },
    { action: 'advanceClock', milliseconds: 1.5 }, { action: 'advanceClock', milliseconds: 366 * DAY }, { action: 'delay', milliseconds: 2001 },
    { action: 'empty', enabled: 'yes' }, { action: 'failure' }, { action: 'resolve' }, { action: 'freshness', status: 'CURRENT' }]) {
    assert.equal((await h.control(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await h.call('POST', '/__mock/control', { raw: '[]', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await h.call('POST', '/__mock/control?x=1', { body: { action: 'duplicate' } })).status, 400);
  assert.equal((await h.get('/__mock/audit?x=1')).status, 400);
  assert.equal((await h.get('/__mock/unknown', { contractCheck: false })).status, 404);
  assert.equal((await h.get('/api/unknown', { contractCheck: false })).status, 404);
  assert.equal((await h.control({ action: 'delay', milliseconds: 5 })).status, 200);
  assert.equal((await h.get('/api/me')).status, 200);
  assert.equal((await h.control({ action: 'delay', milliseconds: 0 })).status, 200);
  const clock = await h.control({ action: 'advanceClock', milliseconds: 1000 });
  assert.equal(clock.json.now, '2026-10-16T10:00:01.000Z');
}));

test('failure and empty modes', T, () => withServer({}, async h => {
  assert.equal((await h.control({ action: 'failure', enabled: true })).status, 200);
  const failure = await h.get('/api/payments');
  assert.equal(failure.status, 500);
  assert.equal(failure.json.code, 'MOCK_FAILURE');
  assert.equal((await h.get('/api/serviceIdentifiers')).status, 500);
  assert.equal((await h.control({ action: 'failure', enabled: false })).status, 200);
  assert.equal((await h.control({ action: 'empty', enabled: true })).status, 200);
  assert.deepEqual((await h.get('/api/payments')).json.items, []);
  assert.deepEqual((await h.get('/api/serviceIdentifiers')).json, []);
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(1)}`)).status, 404);
  const o = (await h.get('/api/overview')).json;
  assert.deepEqual(o.counts, { payments: 0, attempts: 0 });
  assert.equal(sum(o.attemptStates), 0);
  assert.deepEqual((await h.get('/api/creditors')).json.items, []);
  assert.equal((await h.control({ action: 'empty', enabled: false })).status, 200);
  assert.equal((await h.get('/api/payments')).json.items.length, 8);
}));

test('retention: attempt att_003_1 expires after a day, other records remain', T, () => withServer({}, async h => {
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(3)}`)).status, 200);
  await h.control({ action: 'advanceClock', milliseconds: DAY });
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(3)}`)).status, 404);
  const attempts = await allAttempts(h);
  assert.equal(attempts.some(a => a.attemptId === 'att_003_1'), false);
  assert.equal(attempts.length, 8);
  assert.equal((await h.get('/api/payments')).json.items.length, 7);
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(2)}`)).json.attempts.length, 2);
  assert.equal((await h.call('POST', '/api/attempts/att_003_1/reveal', { token: 'DEMO_ADMIN', body: {} })).status, 404);
  // The fully undated payment (notice 8) matches no interval, so it is not part of windowed counts.
  const overview = (await h.get(`/api/overview?${ALL}`)).json;
  assert.equal(overview.counts.payments, 6);
}));

test('retention: first attempt expires before the second, logical payment lasts until the last', T, () => withServer({}, async h => {
  await h.control({ action: 'advanceClock', milliseconds: 57.5 * DAY });
  const mid = (await h.get(`/api/payments/${PA1}/${notice(2)}`)).json;
  assert.deepEqual(mid.attempts.map(a => a.attemptId), ['att_002_2']);
  assert.equal(mid.attemptCount, 1);
  assert.equal(mid.state, 'PAID');
  assert.equal(mid.timeline.length, 4);
  assert.equal(mid.projectionRevision, 2);
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(1)}`)).status, 200);
  await h.control({ action: 'advanceClock', milliseconds: DAY });
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(2)}`)).status, 404);
}));

test('retention: fallback technical firstSeen expires an attempt with missing timestamps', T, () => withServer({}, async h => {
  assert.equal((await h.get(`/api/payments/${PA2}/${notice(8)}`)).json.attempts[0].attemptStartedAt, null);
  await h.control({ action: 'advanceClock', milliseconds: 58.5 * DAY });
  assert.equal((await h.get(`/api/payments/${PA2}/${notice(8)}`)).status, 200);
  await h.control({ action: 'advanceClock', milliseconds: DAY });
  assert.equal((await h.get(`/api/payments/${PA2}/${notice(8)}`)).status, 404);
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(4)}`)).status, 200);
  const overview = (await h.get('/api/overview')).json;
  assert.equal(overview.anomalies.transitions, 0);
}));

test('dynamic fixtures are deterministic across servers', T, async () => {
  let first;
  await withServer({}, async h => { first = (await h.get('/api/overview')).text + (await h.get('/api/payments')).text; });
  await withServer({}, async h => { assert.equal((await h.get('/api/overview')).text + (await h.get('/api/payments')).text, first); });
});

test('maintenances are fetched once for now..now+7d and served from the cache', T, async () => {
  const calls = [];
  const maintenanceFetcher = async window => {
    calls.push(window);
    return { station_maintenance_list: [{ broker_code: 'B2', broker_name: 'Two', start_date_time: '2026-10-18T10:00:00.000+02:00',
      end_date_time: '2026-10-18T12:00:00.000+02:00', stations: ['B2_01'], creditor_institutions: [
        { business_name: 'Ente', creditor_institution_code: '00000000001' }] }] };
  };
  await withServer({ maintenanceFetcher }, async h => {
    for (let i = 0; i < 3; i++) {
      const r = await h.get('/api/apiconfig/maintenances');
      assert.equal(r.status, 200);
      assert.equal(r.json.stale, false);
      assert.deepEqual(r.json.items, [{ brokerCode: 'B2', brokerName: 'Two', startDateTime: '2026-10-18T08:00:00.000Z',
        endDateTime: '2026-10-18T10:00:00.000Z', stations: ['B2_01'],
        creditorInstitutions: [{ businessName: 'Ente', code: '00000000001' }] }]);
    }
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { from: new Date(NOW).toISOString(), to: new Date(NOW + 7 * DAY).toISOString() });
  });
});

test('maintenances answer 503 when the upstream never answered', T, () =>
  withServer({ maintenanceFetcher: async () => { throw new Error('down'); } }, async h => {
    const r = await h.get('/api/apiconfig/maintenances');
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'MAINTENANCE_UNAVAILABLE');
  }));
