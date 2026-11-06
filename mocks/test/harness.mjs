import assert from 'node:assert/strict';
import { createMockServer } from '../server.mjs';
import { loadContract, createResponseValidator, createAjv } from '../validate-contract.mjs';

export const NOW = Date.parse('2026-10-16T10:00:00.000Z');
export const DAY = 86_400_000;
export const RAW_TOKEN = /SYNTHETIC-TOKEN/;
export const PA1 = '00000000001';
export const PA2 = '00000000002';
export const notice = n => `30000000000000000${n}`;

export const contract = await loadContract();
const validateResponse = createResponseValidator(contract);
const ajv = createAjv();
const EVENT_SCHEMAS = {
  ready: 'ReadyEvent',
  'payment.delta': 'PaymentDelta',
  'aggregate.delta': 'AggregateDelta',
  'list.changed': 'ListChangedEvent'
};
const eventChecks = Object.fromEntries(Object.entries(EVENT_SCHEMAS)
  .map(([type, name]) => [type, ajv.compile(contract.components.schemas[name])]));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class SseTimeout extends Error {}

export class Sse {
  constructor(res, abort, harness) {
    this.res = res; this.abort = abort; this.harness = harness;
    this.reader = res.body.getReader(); this.decoder = new TextDecoder();
    this.buffer = ''; this.frames = []; this.pending = null;
  }

  parse(text) {
    this.buffer += text;
    let end;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const raw = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 2);
      const frame = {};
      for (const line of raw.split('\n')) {
        if (line.startsWith(':')) frame.comment = line.slice(1).trim();
        else if (line.startsWith('id: ')) frame.id = line.slice(4);
        else if (line.startsWith('event: ')) frame.event = line.slice(7);
        else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
      }
      if (frame.event) this.harness.checkEvent(frame);
      this.frames.push(frame);
    }
  }

  async next(timeoutMs = 3000, predicate = f => f.event !== undefined) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.frames.length) {
        const frame = this.frames.shift();
        if (predicate(frame)) return frame;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SseTimeout('SSE read timeout');
      this.pending ??= this.reader.read();
      let timer;
      const timeout = new Promise(resolve => { timer = setTimeout(resolve, remaining, SseTimeout); });
      const result = await Promise.race([this.pending, timeout]);
      clearTimeout(timer);
      if (result === SseTimeout) throw new SseTimeout('SSE read timeout');
      this.pending = null;
      if (result.done) throw new Error('SSE stream closed');
      this.parse(this.decoder.decode(result.value, { stream: true }));
    }
  }

  async expectNone(ms = 150, predicate) {
    try { await this.next(ms, predicate); } catch (error) {
      if (error instanceof SseTimeout) return;
      throw error;
    }
    assert.fail('unexpected SSE event');
  }

  async close() {
    this.abort.abort();
    try { await this.reader.cancel(); } catch { /* already aborted */ }
  }
}

export async function withServer(options, fn) {
  const server = createMockServer({ now: () => NOW, heartbeatMs: 20, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const streams = [];
  const contractErrors = [];
  const harness = {
    base, contractErrors,
    checkEvent(frame) {
      const check = eventChecks[frame.event];
      if (!check) { contractErrors.push(`unknown SSE event ${frame.event}`); return; }
      if (frame.data?.type !== frame.event) contractErrors.push(`SSE event ${frame.event} has data.type ${frame.data?.type}`);
      if (!check(frame.data)) contractErrors.push(`SSE ${frame.event}: ${ajv.errorsText(check.errors)}`);
    },
    async call(method, path, { token = 'DEMO_ADMIN', body, headers = {}, contractCheck = true, raw } = {}) {
      const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(5000) };
      if (token) init.headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) { init.headers['Content-Type'] ??= 'application/json'; init.body = JSON.stringify(body); }
      if (raw !== undefined) init.body = raw;
      const res = await fetch(base + path, init);
      const text = await res.text();
      let json;
      try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
      if (contractCheck) {
        try { validateResponse(method, path, res.status, json); } catch (error) { contractErrors.push(error.message); }
      }
      return { status: res.status, json, headers: res.headers, text };
    },
    get: (path, options) => harness.call('GET', path, options),
    control: (body, token = 'DEMO_ADMIN') => harness.call('POST', '/__mock/control', { token, body }),
    async open(query, { token = 'DEMO_ADMIN', lastEventId } = {}) {
      const abort = new AbortController();
      const headers = { Accept: 'text/event-stream' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;
      const res = await fetch(`${base}/api/events?${new URLSearchParams(query)}`, { headers, signal: abort.signal });
      if (res.status !== 200) {
        const json = await res.json();
        try { validateResponse('GET', '/api/events', res.status, json); } catch (error) { contractErrors.push(error.message); }
        return { status: res.status, json };
      }
      assert.match(res.headers.get('content-type'), /^text\/event-stream/);
      const stream = new Sse(res, abort, harness);
      streams.push(stream);
      stream.status = 200;
      return stream;
    },
    async ready(query, options) {
      const stream = await harness.open(query, options);
      assert.equal(stream.status, 200);
      const frame = await stream.next();
      assert.equal(frame.event, 'ready');
      return { stream, frame };
    }
  };
  try {
    await fn(harness);
    assert.deepEqual(contractErrors, [], 'responses must validate against the OpenAPI contract');
  } finally {
    await Promise.all(streams.map(s => s.close()));
    server.closeStreams();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
