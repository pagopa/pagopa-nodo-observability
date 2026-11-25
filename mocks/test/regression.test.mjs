import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, NOW, DAY, PA1, notice } from './harness.mjs';
import { aggregate, fixtures, primitiveDirection, primitiveParties, primitiveRows, primitiveWarnings, retainedRecipients, safeRecipient } from '../model.mjs';

const T = { timeout: 30_000 };
const iso = n => new Date(n).toISOString();
const applyRows = (before, changes, keys, numbers) => {
  const id = row => JSON.stringify(keys.map(k => row[k]));
  const rows = new Map(before.map(row => [id(row), structuredClone(row)]));
  for (const change of changes) {
    const row = rows.get(id(change)) ?? Object.fromEntries([...keys.map(k => [k, change[k]]), ...numbers.map(n => [n, 0])]);
    for (const n of numbers) row[n] += change[n];
    rows.set(id(change), row);
  }
  return [...rows.values()].filter(r => numbers.some(n => r[n] !== 0)).sort((a, b) => id(a).localeCompare(id(b)));
};
const normalized = (rows, keys, numbers) => applyRows(rows, [], keys, numbers);

test('recipient retention expires at its own boundary without removing records needed by another retained attempt', () => {
  const payment = fixtures(NOW)[5];
  const first = payment.recipients[0];
  const second = payment.recipients[1];
  second.expiresAt = first.expiresAt + DAY;
  assert.deepEqual(retainedRecipients(payment, first.expiresAt - 1), [first, second]);
  assert.deepEqual(retainedRecipients(payment, first.expiresAt), [second]);
  assert.equal(payment.attempts.length, 1);
  assert.doesNotMatch(JSON.stringify(safeRecipient(second, payment)), /expiresAt|firstSeenAt/);
});

test('recipient-only timeout and retry aggregate deltas equal REST including repeated transition durations', T, () => withServer({}, async h => {
  for (const scenario of ['outcomeOk', 'generateReceipt', 'sendReceipt']) {
    assert.equal((await h.control({ action: 'scenario', attemptId: 'att_001_1', scenario })).status, 200);
  }
  const query = { from: iso(NOW - DAY), to: iso(NOW + DAY) };
  const { stream } = await h.ready({ scope: 'overview', ...query });
  const url = `/api/overview?${new URLSearchParams(query)}`;
  let before = (await h.get(url)).json;
  const flat = rows => rows.flatMap(row => row.states.map(state => ({ value: row.value, ...state })));
  for (const scenario of ['receiptTimeout', 'retryReceipt', 'receiptTimeout', 'retryReceipt']) {
    await h.control({ action: 'advanceClock', milliseconds: 1000 });
    assert.equal((await h.control({ action: 'scenario', attemptId: 'att_001_1', scenario })).status, 200);
    const change = (await stream.next()).data.changes;
    const after = (await h.get(url)).json;
    assert.deepEqual(change.attemptStates, []);
    assert.deepEqual(change.logicalStates, []);
    assert.deepEqual(applyRows(before.recipientStates, change.recipientStates, ['state'], ['count']),
      normalized(after.recipientStates, ['state'], ['count']));
    assert.deepEqual(applyRows(flat(before.matrices.recipient), change.matrices.recipient, ['value', 'state'], ['count']),
      normalized(flat(after.matrices.recipient), ['value', 'state'], ['count']));
    assert.deepEqual(change.durationSnapshot, after.durations);
    before = after;
  }
}));

test('duration rows expose true nearest-rank median and p95, not estimates from averages', () => {
  const point = offset => new Date(NOW + offset).toISOString();
  const payment = {
    paFiscalCode: PA1, noticeNumber: notice(1), timelineIncomplete: false,
    timeline: [
      { state: 'INSERTED', transitionAt: point(0), timestampBasis: 'SOURCE_EVENT' },
      { state: 'PAYING', transitionAt: point(1), timestampBasis: 'SOURCE_EVENT' },
      { state: 'INSERTED', transitionAt: point(3), timestampBasis: 'SOURCE_EVENT' },
      { state: 'PAYING', transitionAt: point(5), timestampBasis: 'SOURCE_EVENT' },
      { state: 'INSERTED', transitionAt: point(6), timestampBasis: 'SOURCE_EVENT' },
      { state: 'PAYING', transitionAt: point(106), timestampBasis: 'SOURCE_EVENT' },
      { state: 'PAID', transitionAt: point(2), timestampBasis: 'SOURCE_EVENT' },
      { state: 'NOTICE_STORED', transitionAt: null, timestampBasis: 'ANOMALY' }
    ],
    attempts: [], recipients: []
  };
  const result = aggregate([payment], { from: point(-1), to: point(200) }, NOW, 1);
  const row = result.durations.find(item => item.entity === 'logical' && item.fromState === 'INSERTED' && item.toState === 'PAYING');
  assert.deepEqual(
    { samples: row.samples, averageMs: row.averageMs, medianMs: row.medianMs, p95Ms: row.p95Ms },
    { samples: 3, averageMs: 103 / 3, medianMs: 2, p95Ms: 100 }
  );
  assert.equal(result.durations.some(item => item.toState === 'PAID'), false, 'negative duration is excluded');
  assert.equal(result.durations.some(item => item.toState === 'NOTICE_STORED'), false, 'anomalous timestamps are excluded');

  const sparse = aggregate([{
    ...payment, timeline: [payment.timeline[0], payment.timeline[1]]
  }], { from: point(-1), to: point(200) }, NOW, 1);
  assert.equal(sparse.durations[0].medianMs, 1);
  assert.equal(sparse.durations[0].p95Ms, 1);
  assert.deepEqual(aggregate([], { from: point(-1), to: point(200) }, NOW, 1).durations, []);
});

test('filtered snapshot plus SSE delta equals REST, including windows and duration sums', T, () => withServer({}, async h => {
  const cases = [
    { psp: 'ABI00001', to: iso(NOW + DAY) },
    { psp: 'ABI00002', to: iso(NOW + DAY) },
    { attemptState: 'PAYMENT_UNKNOWN', to: iso(NOW + DAY) },
    { to: iso(NOW) }
  ];
  const subscriptions = [];
  for (const filters of cases) {
    const query = { from: iso(NOW - 30 * DAY), ...filters };
    const { stream, frame } = await h.ready({ scope: 'overview', ...query });
    assert.deepEqual(frame.data.window, { from: query.from, to: query.to });
    const url = `/api/overview?${new URLSearchParams(query)}`;
    subscriptions.push({ stream, before: (await h.get(url)).json, url });
  }
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  for (const { stream, before, url } of subscriptions) {
    const change = (await stream.next()).data.changes;
    const after = (await h.get(url)).json;
    for (const field of ['payments', 'attempts']) assert.equal(before.counts[field] + change.counts[field], after.counts[field]);
    assert.equal(before.unresolved.payments + change.counts.unresolvedPayments, after.unresolved.payments);
    assert.equal(before.unresolved.attempts + change.counts.unresolvedAttempts, after.unresolved.attempts);
    for (const [field, keys, numbers] of [
      ['logicalStates', ['state'], ['count']], ['attemptStates', ['state'], ['count']], ['recipientStates', ['state'], ['count']],
      ['traffic', ['bucketStart'], ['startedAttempts', 'estimatedStarts']],
      ['transitions', ['bucketStart', 'entity', 'state', 'timestampBasis'], ['count']]
    ]) assert.deepEqual(applyRows(before[field], change[field], keys, numbers), normalized(after[field], keys, numbers), field);
    const totals = rows => rows.map(({ entity, fromState, toState, timestampBasis, samples, averageMs }) => ({
      entity, fromState, toState, timestampBasis, samples, totalMs: averageMs * samples
    }));
    const durationKeys = ['entity', 'fromState', 'toState', 'timestampBasis'];
    assert.deepEqual(applyRows(totals(before.durations), change.durations, durationKeys, ['samples', 'totalMs']),
      normalized(totals(after.durations), durationKeys, ['samples', 'totalMs']));
    assert.deepEqual(change.durationSnapshot, after.durations);
    assert.equal(change.durations.some(row => 'medianMs' in row || 'p95Ms' in row), false);
    for (const dimension of ['psp', 'canale', 'recipient']) {
      const flat = rows => rows.flatMap(row => row.states.map(state => ({ value: row.value, ...state })));
      assert.deepEqual(applyRows(flat(before.matrices[dimension]), change.matrices[dimension], ['value', 'state'], ['count']),
        normalized(flat(after.matrices[dimension]), ['value', 'state'], ['count']));
    }
  }
}));

test('filtered aggregate deltas reconcile new attempts, dimensions and timestamps with REST', T, () => withServer({}, async h => {
  const window = { from: iso(NOW - 30 * DAY), to: iso(NOW + DAY) };
  const subscriptions = [];
  for (const filters of [{}, { psp: '~unknown' }, { psp: 'ABI00001' }, { anomaliesOnly: 'true' }]) {
    const query = { ...window, ...filters };
    const { stream, frame } = await h.ready({ scope: 'overview', ...query });
    assert.deepEqual(frame.data.window, window);
    const url = `/api/overview?${new URLSearchParams(query)}`;
    subscriptions.push({ stream, before: (await h.get(url)).json, url });
  }
  const totals = rows => rows.map(({ entity, fromState, toState, timestampBasis, samples, averageMs }) => ({
    entity, fromState, toState, timestampBasis, samples, totalMs: averageMs * samples
  }));
  const flat = rows => rows.flatMap(row => row.states.map(state => ({ value: row.value, ...state })));
  const assertRows = (before, changes, after, keys, numbers, label) =>
    assert.deepEqual(applyRows(before, changes, keys, numbers), normalized(after, keys, numbers), label);
  for (const control of [
    { action: 'createAttempt', paFiscalCode: PA1, noticeNumber: notice(3) },
    { action: 'completeDimensions', attemptId: 'att_008_1' },
    { action: 'correctTimestamps', attemptId: 'att_007_1' },
    { action: 'correctTimestamps', attemptId: 'att_008_1' }
  ]) {
    assert.equal((await h.control(control)).status, 200);
    for (const subscription of subscriptions) {
      const { stream, before, url } = subscription;
      const event = await stream.next();
      assert.equal(event.event, 'aggregate.delta');
      const change = event.data.changes;
      const response = await h.get(url);
      assert.equal(response.status, 200);
      const after = response.json;
      const label = `${JSON.stringify(control)} ${url}`;
      assert.deepEqual(after.window, window);
      assert.equal(event.data.projectionRevision, after.projectionRevision, label);
      for (const field of ['payments', 'attempts']) {
        assert.equal(before.counts[field] + change.counts[field], after.counts[field], `${label} counts.${field}`);
      }
      assert.equal(before.unresolved.payments + change.counts.unresolvedPayments, after.unresolved.payments, label);
      assert.equal(before.unresolved.attempts + change.counts.unresolvedAttempts, after.unresolved.attempts, label);
      for (const field of ['transitions', 'payments']) {
        assert.equal(before.anomalies[field] + change.anomalies[field], after.anomalies[field], `${label} anomalies.${field}`);
      }
      for (const [field, keys, numbers] of [
        ['logicalStates', ['state'], ['count']], ['attemptStates', ['state'], ['count']], ['recipientStates', ['state'], ['count']],
        ['traffic', ['bucketStart'], ['startedAttempts', 'estimatedStarts']],
        ['transitions', ['bucketStart', 'entity', 'state', 'timestampBasis'], ['count']],
        ['primitives', ['serviceIdentifier', 'primitive', 'direction'], ['requests', 'responses', 'warnings']]
      ]) assertRows(before[field], change[field], after[field], keys, numbers, `${label} ${field}`);
      for (const dimension of ['psp', 'canale', 'recipient']) {
        assertRows(flat(before.matrices[dimension]), change.matrices[dimension], flat(after.matrices[dimension]),
          ['value', 'state'], ['count'], `${label} matrices.${dimension}`);
      }
      assertRows(totals(before.durations), change.durations, totals(after.durations),
        ['entity', 'fromState', 'toState', 'timestampBasis'], ['samples', 'totalMs'], `${label} durations`);
      assert.deepEqual(change.durationSnapshot, after.durations, `${label} quantile snapshot`);
      assert.equal(change.durations.some(row => 'medianMs' in row || 'p95Ms' in row), false, `${label} additive delta stays legacy-safe`);
      subscription.before = after;
    }
  }
}));

test('replay retains stable delta IDs, and cursors are bound to aggregate filters and windows', T, () => withServer({}, async h => {
  const query = { scope: 'overview', psp: 'ABI00001', from: iso(NOW - DAY * 30), to: iso(NOW + DAY) };
  const a = await h.ready(query), b = await h.ready(query);
  await h.control({ action: 'resolve', attemptId: 'att_001_1' });
  const event = await a.stream.next(), other = await b.stream.next();
  assert.equal(event.id, other.id);
  const replay = await h.open(query, { lastEventId: a.frame.id });
  assert.equal((await replay.next()).id, event.id);
  assert.equal((await h.open({ ...query, psp: 'ABI00002' }, { lastEventId: event.id })).status, 400);
  assert.equal((await h.open({ ...query, to: iso(NOW + DAY * 2) }, { lastEventId: event.id })).status, 400);
  const unsupported = await h.open({ scope: 'overview', psp: 'ABI00001', canale: 'SYNTHETIC_CHANNEL_A' });
  assert.equal(unsupported.status, 422);
}));

test('retention is an explicit replay-resync boundary; deleted payment search remains 404', T, () => withServer({}, async h => {
  const query = { scope: 'payment', paFiscalCode: PA1, noticeNumber: notice(3) };
  const { stream, frame } = await h.ready(query);
  await h.control({ action: 'advanceClock', milliseconds: DAY });
  const removed = await stream.next();
  assert.equal(removed.data.changes.deleted, true);
  assert.equal((await h.open(query, { lastEventId: frame.id })).status, 410);
  assert.equal((await h.open(query)).status, 404);
  assert.equal((await h.get(`/api/payments/${PA1}/${notice(3)}`)).status, 404);
  const resumed = await h.open(query, { lastEventId: removed.id });
  assert.equal((await resumed.next()).data.projectionRevision, removed.data.projectionRevision);
}));

test('retry logical activation and outcome align with their corresponding attempts', T, () => withServer({}, async h => {
  const payment = (await h.get(`/api/payments/${PA1}/${notice(2)}`)).json;
  assert.equal(payment.timeline[1].transitionAt, payment.attempts[0].timeline.at(-1).transitionAt);
  assert.equal(payment.timeline[2].transitionAt, payment.attempts[1].attemptStartedAt);
  assert.equal(payment.timeline[3].transitionAt, payment.attempts[1].timeline.at(-1).transitionAt);
}));

test('same-origin browser POST is accepted without enabling cross-origin CORS', T, () => withServer({}, async h => {
  const accepted = await h.call('POST', '/api/token-lookup', {
    token: 'DEMO_OPERATOR', body: { paymentToken: 'SYNTHETIC-TOKEN-1-1' }, headers: { Origin: h.base }
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.has('access-control-allow-origin'), false);
  assert.equal((await h.call('POST', '/api/token-lookup', {
    token: 'DEMO_OPERATOR', body: { paymentToken: 'SYNTHETIC-TOKEN-1-1' }, headers: { Origin: 'https://evil.example' }
  })).status, 403);
}));

test('expiry during an asynchronous audit cannot reveal a removed token', T, async () => {
  let current = NOW;
  await withServer({ now: () => current, audit: async () => { current += 61 * DAY; } }, async h => {
    const reveal = await h.call('POST', '/api/attempts/att_001_1/reveal', { token: 'DEMO_OPERATOR', body: {} });
    assert.equal(reveal.status, 404);
    assert.doesNotMatch(reveal.text, /SYNTHETIC-TOKEN/);
    assert.equal((await h.get('/api/payments')).json.items.length, 0);
  });
});

test('delay simulation is observable and removable through mock controls', T, () => withServer({}, async h => {
  await h.control({ action: 'delay', milliseconds: 80 });
  const start = performance.now();
  assert.equal((await h.get('/api/payments')).status, 200);
  assert.ok(performance.now() - start >= 70);
  assert.equal((await h.control({ action: 'delay', milliseconds: 0 })).status, 200);
}));

test('overview counts primitive requests and responses per serviceIdentifier and warns when a response is late or missing', T, () => withServer({}, async h => {
  const window = new URLSearchParams({ from: iso(NOW - 30 * DAY), to: iso(NOW + DAY) });
  const rows = (await h.get(`/api/overview?${window}`)).json.primitives;
  const total = field => rows.reduce((sum, row) => sum + row[field], 0);
  assert.deepEqual([...new Set(rows.map(row => row.serviceIdentifier))], ['SYNTHETIC_SERVICE_A', 'SYNTHETIC_SERVICE_B']);
  assert.ok(rows.some(row => row.serviceIdentifier === 'SYNTHETIC_SERVICE_A' && row.primitive === 'activatePaymentNotice'));
  assert.ok(rows.every(row => typeof row.primitive === 'string' && row.primitive.length > 0));
  // One request per sourced attempt transition; PAYMENT_UNKNOWN answers after 12 s, PAYMENT_SEND_ERROR never answers.
  assert.equal(total('requests'), 28);
  assert.equal(total('responses'), 27);
  assert.equal(total('warnings'), 2);
  assert.deepEqual(rows.filter(row => row.warnings).map(row => row.primitive).sort(), ['pspNotifyPayment', 'pspNotifyPaymentV2']);
  const filtered = (await h.get(`/api/overview?${new URLSearchParams({ from: window.get('from'), to: window.get('to'), serviceIdentifier: 'SYNTHETIC_SERVICE_B' })}`)).json.primitives;
  assert.deepEqual([...new Set(filtered.map(row => row.serviceIdentifier))], ['SYNTHETIC_SERVICE_B']);
}));

test('every primitive row carries its direction relative to the Nodo, derived from the RE parties and never guessed', T, () => withServer({}, async h => {
  const window = new URLSearchParams({ from: iso(NOW - 30 * DAY), to: iso(NOW + DAY) });
  const rows = (await h.get(`/api/overview?${window}`)).json.primitives;
  assert.ok(rows.every(row => ['INBOUND', 'OUTBOUND', 'UNKNOWN'].includes(row.direction)));
  const directionOf = name => rows.find(row => row.primitive === name)?.direction;
  assert.equal(directionOf('sendPaymentOutcomeV2'), 'INBOUND');
  assert.equal(directionOf('pspNotifyPaymentV2'), 'OUTBOUND');
  assert.equal(directionOf('NodoInviaRPT'), 'INBOUND');
}));

test('primitiveDirection: the Nodo as erogatore is inbound, as fruitore outbound, any other pair is unknown', () => {
  assert.equal(primitiveDirection({ fruitore: 'PSP', erogatore: 'NodoDeiPagamentiSPC' }), 'INBOUND');
  assert.equal(primitiveDirection({ fruitore: 'NodoDeiPagamentiSPC', erogatore: '02654890025' }), 'OUTBOUND');
  assert.equal(primitiveDirection({ fruitore: null, erogatore: null }), 'UNKNOWN');
  assert.equal(primitiveDirection(primitiveParties('cacheVersion')), 'UNKNOWN');
});

test('an unanswered primitive request is pending until the 10 s budget elapses', () => {
  const payment = fixtures(NOW)[3];
  const window = { from: iso(NOW - DAY), to: iso(NOW + DAY) };
  const sendError = payment.attempts[0].timeline.at(-1);
  sendError.transitionAt = iso(NOW - 5_000);
  const sum = field => primitiveRows([payment], window, NOW).reduce((n, row) => n + row[field], 0);
  assert.equal(sum('warnings'), 0);
  sendError.transitionAt = iso(NOW - 10_001);
  assert.equal(sum('warnings'), 1);
  assert.equal(sum('responses'), 3);
});

test('primitive warnings list each unanswered call with psp, canale, ente, stazione and call time, matching the overview count', T, () => withServer({}, async h => {
  const window = new URLSearchParams({ from: iso(NOW - 30 * DAY), to: iso(NOW + DAY) });
  const rows = (await h.get(`/api/overview?${window}`)).json.primitives.filter(row => row.warnings);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const params = new URLSearchParams({ from: window.get('from'), to: window.get('to'), primitive: row.primitive,
      serviceIdentifier: row.serviceIdentifier ?? '~unknown' });
    const { status, json } = await h.get(`/api/overview/primitive-warnings?${params}`);
    assert.equal(status, 200);
    assert.equal(json.items.length, row.warnings, row.primitive);
    for (const item of json.items) {
      assert.deepEqual(Object.keys(item).sort(), ['calledAt', 'canale', 'paFiscalCode', 'psp', 'stazione']);
      assert.match(item.calledAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(item.paFiscalCode, /^\d{11}$/);
    }
  }
  const [row] = rows;
  const base = { from: window.get('from'), to: window.get('to'), primitive: row.primitive };
  const other = row.serviceIdentifier === 'SYNTHETIC_SERVICE_A' ? 'SYNTHETIC_SERVICE_B' : 'SYNTHETIC_SERVICE_A';
  assert.equal((await h.get(`/api/overview/primitive-warnings?${new URLSearchParams({ ...base, serviceIdentifier: other })}`)).json.items.length, 0);
  assert.equal((await h.get(`/api/overview/primitive-warnings?${new URLSearchParams({ ...base, primitive: 'activatePaymentNotice' })}`)).json.items.length, 0);
  assert.equal((await h.get(`/api/overview/primitive-warnings?${window}`)).status, 400, 'primitive is required');
  assert.equal((await h.get(`/api/overview/primitive-warnings?${new URLSearchParams({ ...base, serviceIdentifier: row.serviceIdentifier ?? '~unknown', psp: 'ABI00001' })}`)).status, 200, 'dimensions can be combined');
  const first = await h.get(`/api/overview/primitive-warnings?${new URLSearchParams({ ...base, pageSize: '1' })}`);
  assert.equal(first.status, 200);
  assert.equal(first.json.nextCursor, null);
}));

test('primitive warnings are listed newest first and only once the 10 s budget has elapsed', () => {
  const window = { from: iso(NOW - DAY), to: iso(NOW + DAY) };
  const payments = fixtures(NOW).filter(p => p.attempts.some(a => ['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'].includes(a.timeline.at(-1).state)));
  const calls = payments.flatMap(p => p.attempts.map(a => [p, a, a.timeline.at(-1)]))
    .filter(([, , t]) => ['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'].includes(t.state));
  assert.ok(calls.length >= 2);
  calls.forEach(([, , t], index) => { t.transitionAt = iso(NOW - (index + 1) * 60_000); });
  const [[, , pending]] = calls;
  const primitive = pending.trigger;
  const listed = () => primitiveWarnings(payments, window, NOW, false, primitive);
  const times = listed().map(item => Date.parse(item.calledAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  if (pending.state === 'PAYMENT_SEND_ERROR') {
    pending.transitionAt = iso(NOW - 5_000);
    assert.ok(listed().every(item => item.calledAt !== pending.transitionAt), 'a call still within 10 s is pending, not a warning');
  }
});

test('a live window counts primitive requests that happen after its end, in the snapshot and in the SSE delta', T, () => withServer({}, async h => {
  const closed = { from: iso(NOW - DAY), to: iso(NOW) };
  const total = rows => rows.reduce((n, row) => n + row.requests, 0);
  const live = { ...closed, live: 'true' };
  const closedUrl = `/api/overview?${new URLSearchParams(closed)}`, liveUrl = `/api/overview?${new URLSearchParams(live)}`;
  const { stream } = await h.ready({ scope: 'overview', ...live });
  const before = (await h.get(liveUrl)).json.primitives;
  await h.control({ action: 'advanceClock', milliseconds: 1000 });
  assert.equal((await h.control({ action: 'scenario', attemptId: 'att_001_1', scenario: 'outcomeOk' })).status, 200);
  const change = (await stream.next()).data.changes.primitives;
  assert.equal(total(change), 1, 'the delta carries the new request');
  assert.equal(total((await h.get(liveUrl)).json.primitives), total(before) + 1, 'the live snapshot includes it');
  assert.equal(total((await h.get(closedUrl)).json.primitives), total(before), 'a closed window does not');
  assert.equal((await h.get(`/api/overview?${new URLSearchParams({ ...closed, live: 'maybe' })}`)).status, 400);
  assert.equal((await h.open({ scope: 'creditor', paFiscalCode: PA1, live: 'true' })).status, 400);
}));
