import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, PA1, notice, DAY, NOW } from './harness.mjs';

const path = '/api/attempts/att_001_1/re-events';
const window = {
  from: new Date(NOW - DAY - 900000).toISOString(),
  to: new Date(NOW - DAY + 900000).toISOString(),
};
const post = (h, body = window, options = {}) => h.call('POST', path, { body, ...options });

test('RE diagnostic keeps all 33 source fields and all categories without changing projection', () =>
  withServer({}, async (h) => {
    const before = (await h.get(`/api/payments/${PA1}/${notice(1)}`)).json;
    const response = await post(h, window, { token: 'DEMO_VIEWER' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = response.json;
    assert.equal(result.source, 'RE');
    assert.equal(result.coverage, 'WINDOW_ONLY');
    assert.ok(result.warnings.some((w) => w.includes('sintetic')));
    assert.deepEqual([...new Set(result.events.map((e) => e.categoriaEvento))].sort(), [
      'INTERFACCIA',
      'INTERNO',
      'SCONOSCIUTA',
    ]);
    assert.deepEqual(
      result.events
        .filter((event) => ['paSendRT', 'paSendRTV2'].includes(event.tipoEvento))
        .map((event) => [event.tipoEvento, event.categoriaEvento, event.sottoTipoEvento])
        .sort((a, b) => String(a[2]).localeCompare(String(b[2]))),
      [
        ['paSendRT', 'INTERFACCIA', 'REQ'],
        ['paSendRT', 'INTERFACCIA', 'RESP'],
      ],
    );
    assert.equal(Object.keys(result.events[0]).length, 36);
    assert.ok(
      result.events.every(
        (e) =>
          e.idDominio === PA1 &&
          e.noticeNumber === notice(1) &&
          e.paymentToken === 'SYNTHETIC-TOKEN-1-1',
      ),
    );
    assert.ok(result.events.some((e) => e.payloadDecoded.text?.includes('<script>')));
    for (const status of ['ABSENT', 'DECODED', 'INVALID_BASE64', 'INVALID_UTF8', 'TOO_LARGE'])
      assert.ok(
        result.events.some((e) => e.payloadDecoded.status === status),
        status,
      );
    const large = result.events.find((e) => e.payloadOmitted);
    assert.equal(large.payload, null);
    assert.ok(large.payloadSourceBytes > 256 * 1024);
    assert.deepEqual((await h.get(`/api/payments/${PA1}/${notice(1)}`)).json, before);
    assert.deepEqual((await h.get('/__mock/audit')).json.items, []);
  }));

test('RE validates bounded UTC intervals and rejects query/token overrides with explicit errors', () =>
  withServer({}, async (h) => {
    for (const body of [
      {},
      { ...window, from: 'invalid' },
      { ...window, to: window.from },
      { ...window, from: '2026-10-10T00:00:00Z' },
      { ...window, paymentToken: 'override' },
      { ...window, cursor: 'tampered' },
    ])
      assert.equal((await post(h, body)).status, 400);
    assert.equal((await h.call('POST', `${path}?token=override`, { body: window })).status, 400);
    assert.equal(
      (await h.call('POST', '/api/attempts/att_999_1/re-events', { body: window })).status,
      404,
    );
    await h.control({ action: 'advanceClock', milliseconds: 61 * DAY });
    assert.equal((await post(h)).status, 410);
  }));

test('RE freezes a paginated snapshot, binds signed cursors and never expands the search', () =>
  withServer({}, async (h) => {
    await h.control({ action: 'reEvents', scenario: 'limit' });
    const first = (await post(h)).json;
    assert.equal(first.events.length, 100);
    assert.ok(first.nextCursor);
    await h.control({ action: 'reEvents', scenario: 'empty' });
    const second = await post(h, { ...window, cursor: first.nextCursor });
    assert.equal(second.status, 200);
    assert.equal(second.json.events.length, 100);
    assert.notEqual(second.json.events[0].uniqueId, first.events[0].uniqueId);
    assert.equal(
      (
        await post(h, {
          ...window,
          to: new Date(NOW - DAY + 800000).toISOString(),
          cursor: first.nextCursor,
        })
      ).status,
      400,
    );
    assert.equal((await post(h, { ...window, cursor: `${first.nextCursor}x` })).status, 400);
    let page = second.json;
    let count = first.events.length + page.events.length;
    while (page.nextCursor) {
      const response = await post(h, { ...window, cursor: page.nextCursor });
      assert.equal(response.status, 200);
      page = response.json;
      count += page.events.length;
    }
    assert.equal(count, 1000);
    assert.equal(page.coverage, 'LIMIT_REACHED');
    assert.equal(page.truncated, true);
  }));

test('RE distinguishes an empty window, partial/outside retention and source failures', () =>
  withServer({}, async (h) => {
    await h.control({ action: 'reEvents', scenario: 'empty' });
    assert.deepEqual((await post(h)).json.events, []);
    const clipped = await post(h, {
      from: new Date(NOW - 30 * DAY - 1000).toISOString(),
      to: new Date(NOW - 30 * DAY + 1000).toISOString(),
    });
    assert.equal(clipped.json.coverage, 'RETENTION_CLIPPED');
    const outside = await post(h, {
      from: new Date(NOW - 31 * DAY).toISOString(),
      to: new Date(NOW - 31 * DAY + 1000).toISOString(),
    });
    assert.equal(outside.status, 200);
    assert.deepEqual(outside.json.events, []);
    assert.ok(outside.json.warnings.includes('OUTSIDE_RETENTION'));
    const future = await post(h, {
      from: new Date(NOW + 1000).toISOString(),
      to: new Date(NOW + 2000).toISOString(),
    });
    assert.equal(future.status, 200);
    assert.deepEqual(future.json.events, []);
    assert.ok(future.json.warnings.includes('OUTSIDE_AVAILABLE_WINDOW'));
    for (const [scenario, status] of [
      ['error', 502],
      ['unconfigured', 503],
      ['timeout', 504],
      ['throttled', 429],
    ]) {
      await h.control({ action: 'reEvents', scenario });
      const response = await post(h);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }));

test('RE pagination is independent from live corrections to projection timestamps', () =>
  withServer({}, async (h) => {
    const attempt = (await h.get('/api/attempts?pageSize=100')).json.items.find(
      (a) => a.attemptId === 'att_007_1',
    );
    const start = Date.parse(attempt.attemptStartedAt);
    const range = { from: new Date(start).toISOString(), to: new Date(start + 2000).toISOString() };
    const request = (body) => h.call('POST', '/api/attempts/att_007_1/re-events', { body });
    await h.control({ action: 'reEvents', scenario: 'limit' });
    const first = (await request(range)).json;
    assert.equal(first.events.length, 100);
    await h.control({ action: 'correctTimestamps', attemptId: 'att_007_1' });
    const next = await request({ ...range, cursor: first.nextCursor });
    assert.equal(next.status, 200);
    assert.equal(next.json.events.length, 100);
    assert.ok(next.json.nextCursor);
    assert.equal(
      next.json.events[0].insertedTimestamp,
      new Date(start + 100).toISOString().slice(0, -1) + '0000',
    );
  }));

test('RE position scope adds the token-less calls, with a KO outcome, and binds cursors to the scope', () =>
  withServer({}, async (h) => {
    const attempt = await post(h);
    assert.equal(attempt.status, 200);
    assert.ok(attempt.json.events.every((e) => e.paymentToken !== null));
    assert.ok(!attempt.json.warnings.includes('POSITION_SCOPE'));

    const position = await post(h, { ...window, scope: 'POSITION' });
    assert.equal(position.status, 200);
    assert.ok(position.json.warnings.includes('POSITION_SCOPE'));
    const tokenless = position.json.events.filter((e) => e.paymentToken === null);
    assert.deepEqual(
      tokenless.map((e) => `${e.tipoEvento} ${e.sottoTipoEvento}`),
      ['verifyPaymentNotice REQ', 'paVerifyPaymentNotice REQ', 'paVerifyPaymentNotice RESP', 'verifyPaymentNotice RESP'],
    );
    assert.ok(tokenless.every((e) => e.idDominio === PA1 && e.noticeNumber === notice(1)));
    assert.ok(tokenless.filter((e) => e.sottoTipoEvento === 'RESP').every((e) => e.payloadDecoded.text.includes('faultCode')));
    assert.equal(position.json.events.length, attempt.json.events.length + 4);
    const times = position.json.events.map((e) => e.insertedTimestamp);
    assert.deepEqual(times, [...times].sort());
  }));

test('RE position scope rejects unknown scopes and cursors issued for another scope', () =>
  withServer({}, async (h) => {
    assert.equal((await post(h, { ...window, scope: 'ALL' })).status, 400);
    assert.equal((await post(h, { ...window, scope: 'position' })).status, 400);
    await h.control({ action: 'reEvents', scenario: 'limit' });
    const attempt = (await post(h)).json;
    assert.ok(attempt.nextCursor);
    assert.equal((await post(h, { ...window, scope: 'POSITION', cursor: attempt.nextCursor })).status, 400);
    const position = (await post(h, { ...window, scope: 'POSITION' })).json;
    assert.ok(position.nextCursor);
    assert.equal((await post(h, { ...window, cursor: position.nextCursor })).status, 400);
    assert.equal((await post(h, { ...window, scope: 'POSITION', cursor: position.nextCursor })).status, 200);
  }));
