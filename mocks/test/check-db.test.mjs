import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, PA1, notice } from './harness.mjs';

const path = '/api/attempts/att_001_1/check-db';

test('Check DB returns separate simulated states without changing the projection', () =>
  withServer({}, async (h) => {
    const before = (await h.get(`/api/payments/${PA1}/${notice(1)}`)).json;
    const response = await h.get(path, { token: 'DEMO_VIEWER' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      attemptId: 'att_001_1',
      paFiscalCode: PA1,
      noticeNumber: notice(1),
      serviceIdentifier: before.attempts[0].serviceIdentifier,
      projectionRevision: before.projectionRevision,
      source: 'SIMULATED',
      checkedAt: '2026-10-16T10:00:00.000Z',
      observed: { logicalState: before.state, attemptState: before.attempts[0].state },
      database: { logicalState: before.state, attemptState: before.attempts[0].state },
    });
    assert.equal(JSON.stringify(response.json).includes('SYNTHETIC-TOKEN'), false);
    assert.deepEqual((await h.get(`/api/payments/${PA1}/${notice(1)}`)).json, before);
  }));

test('Check DB simulates discrepancies, missing records and routing/connection errors', () =>
  withServer({}, async (h) => {
    for (const scenario of ['mismatch', 'missing', 'unconfigured', 'unavailable', 'match']) {
      assert.equal((await h.control({ action: 'checkDb', scenario })).status, 200);
      const response = await h.get(path);
      if (scenario === 'unconfigured') {
        assert.equal(response.status, 422);
        assert.equal(response.json.code, 'DB_SERVICE_UNCONFIGURED');
      } else if (scenario === 'unavailable') {
        assert.equal(response.status, 503);
        assert.equal(response.json.code, 'DB_UNAVAILABLE');
      } else {
        assert.equal(response.status, 200);
        for (const field of ['logicalState', 'attemptState']) {
          if (scenario === 'missing') assert.equal(response.json.database[field], null);
          else if (scenario === 'mismatch')
            assert.notEqual(response.json.database[field], response.json.observed[field]);
          else assert.equal(response.json.database[field], response.json.observed[field]);
        }
      }
    }
    assert.equal((await h.control({ action: 'checkDb', scenario: 'invalid' })).status, 400);
  }));

test('Check DB rejects overrides and handles missing services, visibility and retention', () =>
  withServer({}, async (h) => {
    assert.equal((await h.get(path, { token: null })).status, 401);
    assert.equal((await h.get(`${path}?serviceIdentifier=override`)).status, 400);
    assert.equal((await h.get('/api/attempts/att_999_1/check-db')).status, 404);
    const attempts = (await h.get('/api/attempts?pageSize=100')).json.items;
    const hidden = attempts.find((attempt) => attempt.paFiscalCode !== PA1);
    assert.ok(hidden);
    assert.equal(
      (await h.get(`/api/attempts/${hidden.attemptId}/check-db`, { token: 'DEMO_PA_VIEWER' }))
        .status,
      404,
    );
    const missing = attempts.find((attempt) => attempt.serviceIdentifier === null);
    assert.ok(missing);
    const response = await h.get(`/api/attempts/${missing.attemptId}/check-db`);
    assert.equal(response.status, 422);
    assert.equal(response.json.code, 'DB_SERVICE_MISSING');
    await h.control({ action: 'advanceClock', milliseconds: 61 * 86_400_000 });
    assert.equal((await h.get(path)).status, 404);
  }));
