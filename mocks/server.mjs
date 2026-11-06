import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ATTEMPT_STATES, LOGICAL_STATES, DAY, fixtures, current, warning, iso, key,
  safeAttempt, safeRecipient, retainedRecipients, paymentDetail, paymentSummary, selected, aggregate, withinWindow, primitiveRows, primitiveWarnings } from './model.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { createReDiagnostics } from './re-events.mjs';
import { createMaintenanceCache, httpMaintenanceFetcher, syntheticMaintenanceFetcher } from './maintenance.mjs';

const ROLES = {
  DEMO_VIEWER: { id: 'demo-viewer', role: 'viewer', pa: null, tokens: false, admin: false },
  DEMO_PA_VIEWER: { id: 'demo-pa-viewer', role: 'viewer', pa: '00000000001', tokens: false, admin: false },
  DEMO_OPERATOR: { id: 'demo-operator', role: 'operator', pa: null, tokens: true, admin: false },
  DEMO_ADMIN: { id: 'demo-admin', role: 'admin', pa: null, tokens: true, admin: true }
};
const FILTERS = ['paFiscalCode', 'noticeNumber', 'logicalState', 'attemptState',
  'serviceIdentifier', 'psp', 'canale', 'stazione', 'anomaliesOnly', 'unresolvedOnly'];
const DIMENSIONS = ['serviceIdentifier', 'psp', 'canale', 'stazione'];
const opaque = () => randomBytes(24).toString('base64url');
const fail = (status, code, message, extra = {}) => { throw Object.assign(new Error(message), { status, code, extra }); };
const requireValue = (condition, message = 'Parametri non validi.') => {
  if (!condition) fail(400, 'INVALID_REQUEST', message);
};
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function createMockServer({ now = Date.now, heartbeatMs = 15_000, replayLimit = 100,
  replayTtlMs = 5 * 60_000, cursorTtlMs = 5 * 60_000, audit = () => {}, maintenanceFetcher = syntheticMaintenanceFetcher() } = {}) {
  let offset = 0;
  const clock = () => now() + offset;
  let payments = fixtures(clock());
  let aggregateRevision = 1;
  const cursors = new Map(), replayCursors = new Map(), clients = new Set(), history = [], audits = [];
  let modes = { delayMs: 0, failure: false, auditFailure: false, empty: false };
  let checkDbScenario = 'match';
  let reScenario = 'success';
  const expiredAttemptIds = new Set();
  const reDiagnostics = createReDiagnostics(clock);
  const maintenance = createMaintenanceCache({ fetcher: maintenanceFetcher, now: clock });
  let freshnessState = { status: 'CURRENT', lagSeconds: 0, gapsDetected: false };
  let processedAt = iso(clock());

  const visible = user => modes.empty ? [] : payments.filter(p => !user.pa || p.paFiscalCode === user.pa);
  const allowed = (user, pa) => !user.pa || user.pa === pa;
  const freshness = () => ({ ...freshnessState, lastProcessedAt: processedAt, lastPublishedAt: processedAt, observedAt: iso(clock()) });
  const windowFor = q => {
    const from = q.from ?? iso(clock() - 60 * 60_000), to = q.to ?? iso(clock());
    requireValue([from, to].every(t => UTC.test(t) && Number.isFinite(Date.parse(t)) && iso(Date.parse(t)) === t));
    requireValue(Date.parse(from) < Date.parse(to) && Date.parse(to) - Date.parse(from) <= 60 * DAY);
    return { from, to };
  };
  function query(url, extra = []) {
    const q = Object.fromEntries(url.searchParams);
    for (const [name, value] of url.searchParams) {
      requireValue([...FILTERS, ...extra].includes(name) && url.searchParams.getAll(name).length === 1);
      requireValue(value.length > 0 && value.length <= (name === 'keys' ? 3099 : 256));
    }
    if (q.logicalState) requireValue(LOGICAL_STATES.includes(q.logicalState));
    if (q.attemptState) requireValue(ATTEMPT_STATES.includes(q.attemptState));
    for (const flag of ['anomaliesOnly', 'unresolvedOnly', 'live']) if (q[flag]) requireValue(['true', 'false'].includes(q[flag]));
    if (q.paFiscalCode) requireValue(/^\d{11}$/.test(q.paFiscalCode));
    if (q.noticeNumber) requireValue(/^\d{18}$/.test(q.noticeNumber));
    return q;
  }
  function checkAggregate(q) {
    if (DIMENSIONS.filter(d => q[d] !== undefined).length > 1
      || (q.stazione && !q.paFiscalCode)) {
      fail(422, 'UNSUPPORTED_AGGREGATION', 'Combinazione non disponibile negli aggregati; usare la lista tentativi.', { fallback: '/api/attempts' });
    }
  }
  function filtered(user, q) { return selected(visible(user), q); }
  const getPayment = (user, pa, notice) => {
    const p = visible(user).find(p => p.paFiscalCode === pa && p.noticeNumber === notice);
    if (!p) fail(404, 'NOT_FOUND', 'Pagamento non disponibile.');
    return p;
  };
  const getAttempt = (user, id) => {
    for (const p of visible(user)) {
      const a = p.attempts.find(a => a.attemptId === id);
      if (a) return [p, a];
    }
    fail(404, 'NOT_FOUND', 'Tentativo non disponibile.');
  };
  function advance(p, a, step, suppress = false) {
    const transition = state => ({ state, trigger: step.trigger, transitionAt: iso(clock()), timestampBasis: 'SOURCE_EVENT' });
    const transitions = (step.states ?? (step.state && step.state !== current(a) ? [step.state] : [])).map(transition);
    const logicalStates = step.logicalStates ?? (step.logical && step.logical !== current(p)
      && !(step.logical === 'NOTIFIED' && current(p) !== 'PAID') ? [step.logical] : []);
    const logicalTransitions = logicalStates.map(transition);
    const targets = step.recipientFrom
      ? (step.firstRecipientOnly ? p.recipients.slice(0, 1) : p.recipients)
        .filter(r => step.recipientFrom.includes(current(r)) && current(r) !== step.recipient)
      : [];
    if (step.recipientFrom) requireValue(targets.length > 0, 'Nessun destinatario nello stato richiesto.');
    if (step.state === 'NOTIFIED') requireValue(p.recipients.length > 0
      && p.recipients.every(r => ['NOTICE_SENT', 'NOTIFIED'].includes(current(r))),
    'Il completamento richiede le risposte di tutti i destinatari previsti nello scenario.');
    const createRecipients = step.recipient === 'NOTICE_GENERATED' && p.recipients.length === 0;
    if (!transitions.length && !logicalTransitions.length && !targets.length && !createRecipients) return;
    const before = structuredClone(payments);
    a.timeline.push(...transitions); p.timeline.push(...logicalTransitions); p.projectionRevision++;
    const recipientChanges = [];
    if (createRecipients) {
      for (const number of [1, 2]) {
        const recipient = { recipientId: `rcp_${p.noticeNumber}_${number}`,
          stazioneRecipient: `${p.paFiscalCode}_RECIPIENT_${number}`, timelineIncomplete: false,
          firstSeenAt: clock(), expiresAt: clock() + 60 * DAY,
          timeline: [transition('NOTICE_GENERATED')] };
        p.recipients.push(recipient);
        recipientChanges.push({ recipientId: recipient.recipientId, transitions: [],
          upsert: structuredClone(safeRecipient(recipient, p)) });
      }
    }
    for (const recipient of targets) {
      const entry = transition(step.recipient);
      recipient.timeline.push(entry);
      recipientChanges.push({ recipientId: recipient.recipientId, transitions: [entry] });
    }
    publish(before, [{ paFiscalCode: p.paFiscalCode, noticeNumber: p.noticeNumber, projectionRevision: p.projectionRevision,
      changes: { logicalTransitions,
        attemptChanges: transitions.length ? [{ attemptId: a.attemptId, transitions, warning: warning(a) }] : [],
        recipientChanges, removedRecipientIds: [],
        removedAttemptIds: [], deleted: false } }], suppress);
  }
  function page(items, user, url, q, sort = 'key') {
    const size = q.pageSize === undefined ? 20 : Number(q.pageSize);
    requireValue(/^\d+$/.test(q.pageSize ?? '20') && Number.isInteger(size) && size >= 1 && size <= 100);
    requireValue(q.sort === undefined || q.sort === sort);
    const normalized = { ...q }; delete normalized.cursor;
    const signature = JSON.stringify([user.id, url.pathname, Object.entries(normalized).sort(), size, sort]);
    let index = 0;
    if (q.cursor) {
      requireValue(/^[\w-]{32}$/.test(q.cursor), 'Cursore non valido.');
      const cursor = cursors.get(q.cursor);
      if (!cursor || cursor.expires <= clock() || cursor.revision !== aggregateRevision) fail(410, 'CURSOR_EXPIRED', 'Ricaricare la prima pagina.');
      requireValue(cursor.signature === signature, 'Il cursore non appartiene alla ricerca.');
      index = cursor.index;
    }
    let nextCursor = null;
    if (items.length > index + size) {
      nextCursor = opaque();
      cursors.set(nextCursor, { signature, index: index + size, expires: clock() + cursorTtlMs, revision: aggregateRevision });
    }
    for (const [id, c] of cursors) if (c.expires <= clock()) cursors.delete(id);
    return { items: items.slice(index, index + size), nextCursor, snapshotRevision: aggregateRevision };
  }
  function scopedPayments(user, scope) {
    return selected(visible(user), {
      ...(scope.paFiscalCode ? { paFiscalCode: scope.paFiscalCode } : {}),
      ...(scope.noticeNumber ? { noticeNumber: scope.noticeNumber } : {}),
      ...(scope.stazione ? { stazione: scope.stazione } : {})
    });
  }
  function compact(payments, window, live = false) {
    const snapshot = aggregate(payments, window, clock(), aggregateRevision, live);
    return { counts: { ...snapshot.counts, unresolvedPayments: snapshot.unresolved.payments,
      unresolvedAttempts: snapshot.unresolved.attempts, anomalyTransitions: snapshot.anomalies.transitions },
    logicalStates: snapshot.logicalStates, attemptStates: snapshot.attemptStates, recipientStates: snapshot.recipientStates,
    traffic: snapshot.traffic, transitions: snapshot.transitions,
    primitives: primitiveRows(payments, window, clock(), live),
    // Dimension moves can be applied without requesting an overview snapshot.
    matrices: snapshot.matrices, anomalies: snapshot.anomalies,
    durationSnapshot: snapshot.durations,
    durations: snapshot.durations.map(({ entity, fromState, toState, timestampBasis, samples, averageMs }) => ({
      entity, fromState, toState, timestampBasis, samples, totalMs: averageMs * samples
    })) };
  }
  function delta(before, after) {
    const rows = (a, b, keys, numbers) => {
      const map = new Map();
      for (const [sign, list] of [[-1, a], [1, b]]) for (const row of list) {
        const id = JSON.stringify(keys.map(k => row[k]));
        const r = map.get(id) || Object.fromEntries([...keys.map(k => [k, row[k]]), ...numbers.map(n => [n, 0])]);
        numbers.forEach(n => r[n] += sign * row[n]); map.set(id, r);
      }
      return [...map.values()].filter(r => numbers.some(n => r[n] !== 0));
    };
    const subtract = (a, b) => Object.fromEntries(Object.keys(b).map(k => [k, b[k] - a[k]]));
    return {
      counts: subtract(before.counts, after.counts),
      logicalStates: rows(before.logicalStates, after.logicalStates, ['state'], ['count']),
      attemptStates: rows(before.attemptStates, after.attemptStates, ['state'], ['count']),
      recipientStates: rows(before.recipientStates, after.recipientStates, ['state'], ['count']),
      primitives: rows(before.primitives, after.primitives, ['serviceIdentifier', 'primitive', 'direction'], ['requests', 'responses', 'warnings']),
      traffic: rows(before.traffic, after.traffic, ['bucketStart'], ['startedAttempts', 'estimatedStarts']),
      transitions: rows(before.transitions, after.transitions, ['bucketStart', 'entity', 'state', 'timestampBasis'], ['count']),
      matrices: Object.fromEntries(['psp', 'canale', 'recipient'].map(d => [d, rows(
        before.matrices[d].flatMap(r => r.states.map(s => ({ value: r.value, ...s }))),
        after.matrices[d].flatMap(r => r.states.map(s => ({ value: r.value, ...s }))),
        ['value', 'state'], ['count'])])),
      anomalies: subtract(before.anomalies, after.anomalies),
      durations: rows(before.durations, after.durations,
        ['entity', 'fromState', 'toState', 'timestampBasis'], ['samples', 'totalMs']),
      // Quantiles cannot be updated additively: this is the full authoritative replacement.
      durationSnapshot: after.durationSnapshot
    };
  }
  function scopeKey(user, scope) { return JSON.stringify([user.id, scope]); }
  function pruneReplay() {
    while (history.length > replayLimit || (history.length && history[0].createdAt + replayTtlMs <= clock())) history.shift();
    const oldest = history[0]?.sequence ?? sequence + 1;
    for (const [id, c] of replayCursors) if (c.expires <= clock() || c.sequence < oldest - 1) replayCursors.delete(id);
  }
  let sequence = 0;
  function sendEvent(client, type, data, seq) {
    const stableKey = JSON.stringify([scopeKey(client.user, client.scope), client.window, seq, type]);
    const existing = type === 'ready' ? undefined : [...replayCursors].find(([, c]) =>
      c.stableKey === stableKey && c.expires > clock());
    const id = existing?.[0] ?? opaque();
    replayCursors.set(id, { sequence: seq, scope: scopeKey(client.user, client.scope),
      window: client.window, stableKey, projectionRevision: data.projectionRevision, expires: clock() + replayTtlMs });
    client.res.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    client.last = { id, type, data };
  }
  function eventData(entry, client) {
    if (client.scope.scope === 'payment') {
      const change = entry.changes.find(c => c.paFiscalCode === client.scope.paFiscalCode && c.noticeNumber === client.scope.noticeNumber);
      return change && { type: 'payment.delta', scope: client.scope, ...change };
    }
    if (client.scope.scope === 'payment-list') {
      const keys = new Set(client.scope.keys.split(','));
      const changed = entry.changes.some(c => keys.has(`${c.paFiscalCode}:${c.noticeNumber}`));
      return changed ? { type: 'list.changed', scope: client.scope, projectionRevision: entry.revision } : null;
    }
    if (client.scope.scope === 'creditor-list') {
      const keys = new Set(client.scope.keys.split(','));
      const changed = entry.changes.some(c => keys.has(c.paFiscalCode));
      return changed ? { type: 'list.changed', scope: client.scope, projectionRevision: entry.revision } : null;
    }
    const before = selected(entry.before, client.scope, client.user.pa);
    const after = selected(entry.after, client.scope, client.user.pa);
    // No payment payload is broadcast to aggregate subscribers.
    return { type: 'aggregate.delta', scope: client.scope, projectionRevision: entry.revision,
      changes: delta(compact(before, client.window, client.live), compact(after, client.window, client.live)), freshness: entry.freshness };
  }
  function publish(before, changes, suppress = false) {
    aggregateRevision++;
    processedAt = iso(clock());
    // Replay snapshots never retain raw tokens or retention bookkeeping.
    const replaySnapshot = data => data.map(p => ({ ...p, attempts: p.attempts.map(a => {
      const { paymentToken: _token, firstSeenAt: _seen, expiresAt: _expires, ...safe } = a;
      return safe;
    }), recipients: p.recipients.map(r => {
      const { firstSeenAt: _seen, expiresAt: _expires, ...safe } = r;
      return safe;
    }) }));
    const entry = { sequence: ++sequence, revision: aggregateRevision, createdAt: clock(),
      before: replaySnapshot(before), after: replaySnapshot(structuredClone(modes.empty ? [] : payments)), changes, freshness: freshness() };
    history.push(entry); pruneReplay();
    for (const client of clients) {
      if (suppress && client.scope.scope === 'payment') continue;
      const data = eventData(entry, client);
      if (data) sendEvent(client, data.type, data, entry.sequence);
    }
  }
  function cleanup() {
    const before = structuredClone(modes.empty ? [] : payments), changes = [];
    payments = payments.filter(p => {
      const removed = p.attempts.filter(a => a.expiresAt <= clock()).map(a => a.attemptId);
      for (const id of removed) expiredAttemptIds.add(id);
      p.attempts = p.attempts.filter(a => a.expiresAt > clock());
      const keptRecipients = p.attempts.length ? retainedRecipients(p, clock()) : [];
      const removedRecipientIds = p.recipients.filter(r => !keptRecipients.includes(r)).map(r => r.recipientId);
      p.recipients = keptRecipients;
      if (removed.length || removedRecipientIds.length) {
        p.projectionRevision++;
        changes.push({ paFiscalCode: p.paFiscalCode, noticeNumber: p.noticeNumber, projectionRevision: p.projectionRevision,
          changes: { logicalTransitions: [], attemptChanges: [], removedAttemptIds: removed,
            removedRecipientIds, deleted: !p.attempts.length } });
      }
      return p.attempts.length;
    });
    if (changes.length) {
      // A retention sweep is a resync boundary: discard replay copies of expired data.
      history.length = 0; replayCursors.clear();
      publish(before, changes);
      // Keep only the resulting safe aggregate delta, not expired functional snapshots.
      history.length = 0;
    }
  }
  async function body(req) {
    let size = 0, text = '';
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) fail(400, 'INVALID_REQUEST', 'Richiesta troppo grande.');
      text += chunk;
    }
    requireValue(req.headers['content-type']?.split(';')[0] === 'application/json');
    try {
      const value = JSON.parse(text);
      requireValue(value && typeof value === 'object' && !Array.isArray(value));
      return value;
    } catch { fail(400, 'INVALID_REQUEST', 'Corpo JSON non valido.'); }
  }
  async function recordAudit(user, action, attemptId) {
    const record = { actorId: user.id, action, attemptId, recordedAt: iso(clock()) };
    try {
      if (modes.auditFailure) throw new Error('unavailable');
      await audit(record);
      audits.push(record);
    } catch { fail(500, 'AUDIT_UNAVAILABLE', 'Audit non disponibile; operazione negata.'); }
  }
  function stations(user, q, pa) {
    const data = filtered(user, { ...q, paFiscalCode: pa });
    const values = [...new Set(data.flatMap(p => p.attempts.map(a => a.stazione)))].sort((a, b) => String(a).localeCompare(String(b)));
    return values.map(stazione => {
      const projection = selected(data, { stazione: stazione ?? '~unknown' });
      const metrics = aggregate(projection, windowFor(q), clock(), aggregateRevision);
      return { stazione, traffic: metrics.traffic, startedAttempts: metrics.traffic.reduce((n, r) => n + r.startedAttempts, 0),
        logicalStates: metrics.logicalStates, attemptStates: metrics.attemptStates, unresolved: metrics.unresolved };
    });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') {
        requireValue(!url.search); return json(200, { status: 'ok', mode: 'synthetic-local-mock' });
      }
      // No bearer values are accepted in URLs, cookies, logs or event envelopes.
      const credential = req.headers.authorization?.replace(/^Bearer /, '');
      const user = Object.hasOwn(ROLES, credential ?? '') ? ROLES[credential] : undefined;
      if (!user || !req.headers.authorization?.startsWith('Bearer ')) fail(401, 'UNAUTHENTICATED', 'Credenziale demo richiesta.');
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        fail(403, 'FORBIDDEN', 'Usare un proxy same-origin locale; CORS disabilitato.');
      }
      if (path.startsWith('/__mock/')) {
        if (!user.admin) fail(403, 'FORBIDDEN', 'Controllo demo riservato.');
        requireValue(!url.search);
        if (path === '/__mock/audit' && req.method === 'GET') return json(200, { items: audits });
        if (path === '/__mock/control' && req.method === 'POST') {
          const b = await body(req);
          const actions = ['resolve', 'gap', 'scenario', 'createAttempt', 'completeDimensions', 'correctTimestamps', 'duplicate', 'advanceClock', 'empty', 'failure', 'delay', 'auditFailure', 'expireReplay', 'freshness', 'checkDb', 'reEvents'];
          requireValue(actions.includes(b.action));
          const accepted = {
            resolve: ['action', 'attemptId'], gap: ['action', 'attemptId'], duplicate: ['action'],
            scenario: ['action', 'attemptId', 'scenario'],
            checkDb: ['action', 'scenario'],
            reEvents: ['action', 'scenario'],
            createAttempt: ['action', 'paFiscalCode', 'noticeNumber'],
            completeDimensions: ['action', 'attemptId'], correctTimestamps: ['action', 'attemptId'],
            advanceClock: ['action', 'milliseconds'], empty: ['action', 'enabled'],
            failure: ['action', 'enabled'], delay: ['action', 'milliseconds'], auditFailure: ['action', 'enabled'],
            expireReplay: ['action'], freshness: ['action', 'status', 'lagSeconds', 'gapsDetected']
          }[b.action];
          requireValue(Object.keys(b).every(k => accepted.includes(k)));
          if (b.action === 'checkDb') {
            requireValue(['match', 'mismatch', 'missing', 'unconfigured', 'unavailable'].includes(b.scenario));
            checkDbScenario = b.scenario;
          }
          if (b.action === 'reEvents') {
            requireValue(['success', 'empty', 'error', 'limit', 'unconfigured', 'timeout', 'throttled'].includes(b.scenario));
            reScenario = b.scenario;
          }
          if (['empty', 'failure', 'auditFailure'].includes(b.action)) requireValue(typeof b.enabled === 'boolean');
          if (['advanceClock', 'delay'].includes(b.action)) requireValue(Number.isInteger(b.milliseconds) && b.milliseconds >= 0 && b.milliseconds <= (b.action === 'delay' ? 2000 : 365 * DAY));
          if (b.action === 'delay') modes.delayMs = b.milliseconds;
          if (b.action === 'failure') modes.failure = b.enabled;
          if (b.action === 'auditFailure') modes.auditFailure = b.enabled;
          if (b.action === 'advanceClock') { offset += b.milliseconds; cleanup(); }
          if (b.action === 'expireReplay') { history.length = 0; replayCursors.clear(); }
          if (b.action === 'duplicate') for (const c of clients) if (c.last) {
            c.res.write(`id: ${c.last.id}\nevent: ${c.last.type}\ndata: ${JSON.stringify(c.last.data)}\n\n`);
          }
          if (b.action === 'empty' && modes.empty !== b.enabled) {
            const before = structuredClone(modes.empty ? [] : payments);
            modes.empty = b.enabled;
            const changes = payments.map(p => {
              p.projectionRevision++;
              return { paFiscalCode: p.paFiscalCode, noticeNumber: p.noticeNumber, projectionRevision: p.projectionRevision,
                changes: { logicalTransitions: b.enabled ? [] : structuredClone(p.timeline), attemptChanges: b.enabled ? [] : p.attempts.map(a => ({ attemptId: a.attemptId,
                  transitions: [], warning: warning(a), upsert: structuredClone(safeAttempt(a, p)) })),
                  removedAttemptIds: b.enabled ? p.attempts.map(a => a.attemptId) : [], deleted: b.enabled,
                  recipientChanges: b.enabled ? [] : p.recipients.map(r => ({ recipientId: r.recipientId,
                    transitions: [], upsert: structuredClone(safeRecipient(r, p)) })),
                  removedRecipientIds: b.enabled ? p.recipients.map(r => r.recipientId) : [],
                  ...(!b.enabled ? { timelineIncomplete: p.timelineIncomplete } : {}) } };
            });
            publish(before, changes);
          }
          if (b.action === 'createAttempt') {
            requireValue(typeof b.paFiscalCode === 'string' && /^\d{11}$/.test(b.paFiscalCode)
              && typeof b.noticeNumber === 'string' && /^\d{18}$/.test(b.noticeNumber));
            const p = getPayment(user, b.paFiscalCode, b.noticeNumber);
            requireValue(current(p) === 'INSERTED', 'Il pagamento non consente una nuova attivazione.');
            const before = structuredClone(payments);
            const sequence = Math.max(...p.attempts.map(a => Number(a.attemptId.split('_').at(-1)))) + 1;
            const attemptId = `${p.attempts[0].attemptId.replace(/_\d+$/, '')}_${sequence}`, started = clock();
            const a = {
              attemptId, paymentToken: `SYNTHETIC-TOKEN-RETRY-${attemptId}`,
              serviceIdentifier: 'SYNTHETIC_SERVICE_A', psp: 'ABI00001',
              stazione: `${p.paFiscalCode}_01`, canale: 'SYNTHETIC_CHANNEL_A',
              attemptStartedAt: iso(started), startTimestampBasis: 'SOURCE_EVENT',
              firstSeenAt: started, expiresAt: started + 60 * DAY, timelineIncomplete: false,
              timeline: [{ state: 'PAYING', transitionAt: iso(started), timestampBasis: 'SOURCE_EVENT',
                trigger: 'activatePaymentNotice' }]
            };
            p.attempts.push(a);
            p.timeline.push({ state: 'PAYING', trigger: 'activatePaymentNotice',
              transitionAt: iso(started), timestampBasis: 'SOURCE_EVENT' });
            p.projectionRevision++;
            publish(before, [{ paFiscalCode: p.paFiscalCode, noticeNumber: p.noticeNumber, projectionRevision: p.projectionRevision,
              changes: { logicalTransitions: [{ ...p.timeline.at(-1) }], attemptChanges: [{
                attemptId: a.attemptId, transitions: [], warning: false, upsert: structuredClone(safeAttempt(a, p))
              }], removedAttemptIds: [], deleted: false } }]);
          }
          if (['completeDimensions', 'correctTimestamps'].includes(b.action)) {
            requireValue(typeof b.attemptId === 'string');
            const [p, a] = getAttempt(user, b.attemptId);
            const before = structuredClone(payments), patch = {}, transitionCorrections = [], logicalTransitionCorrections = [];
            if (b.action === 'completeDimensions') {
              for (const [dimension, value] of Object.entries({
                psp: 'ABI00001', stazione: `${p.paFiscalCode}_01`, canale: 'SYNTHETIC_CHANNEL_A'
              })) if (a[dimension] === null) patch[dimension] = value;
            } else {
              const source = a.firstSeenAt - 60_000;
              if (a.startTimestampBasis !== 'SOURCE_EVENT') {
                patch.attemptStartedAt = iso(source); patch.startTimestampBasis = 'SOURCE_EVENT';
                // A correction may shorten, never extend, the established retention.
                a.expiresAt = Math.min(a.expiresAt, source + 60 * DAY);
              }
              for (const [timeline, corrections] of [[a.timeline, transitionCorrections], [p.timeline, logicalTransitionCorrections]]) {
                timeline.forEach((t, index) => {
                  if (t.timestampBasis !== 'SOURCE_EVENT') {
                    const transition = { ...t, transitionAt: iso(source + index * 60_000), timestampBasis: 'SOURCE_EVENT' };
                    corrections.push({ index, transition }); timeline[index] = transition;
                  }
                });
              }
              if (a.timelineIncomplete) patch.timelineIncomplete = false;
            }
            if (Object.keys(patch).length || transitionCorrections.length || logicalTransitionCorrections.length) {
              Object.assign(a, patch);
              p.projectionRevision++;
              const incomplete = p.attempts.some(a => a.timelineIncomplete);
              const changes = { logicalTransitions: [], attemptChanges: [{
                attemptId: a.attemptId, transitions: [], warning: warning(a),
                ...(Object.keys(patch).length ? { patch } : {}),
                ...(transitionCorrections.length ? { transitionCorrections } : {})
              }], removedAttemptIds: [], deleted: false,
              ...(logicalTransitionCorrections.length ? { logicalTransitionCorrections } : {}) };
              if (b.action === 'correctTimestamps' && p.timelineIncomplete !== incomplete) {
                p.timelineIncomplete = incomplete; changes.timelineIncomplete = incomplete;
              }
              publish(before, [{ paFiscalCode: p.paFiscalCode, noticeNumber: p.noticeNumber,
                projectionRevision: p.projectionRevision, changes }]);
              cleanup();
            }
          }
          if (b.action === 'scenario') {
            requireValue(typeof b.attemptId === 'string' && typeof b.scenario === 'string'
              && Object.hasOwn(SCENARIOS, b.scenario));
            const [p, a] = getAttempt(user, b.attemptId);
            const step = SCENARIOS[b.scenario];
            requireValue(step.from.includes(current(a)) && step.logicalFrom.includes(current(p)),
              'Scenario non applicabile agli stati correnti.');
            advance(p, a, step);
          }
          if (['resolve', 'gap'].includes(b.action)) {
            requireValue(typeof b.attemptId === 'string');
            const [p, a] = getAttempt(user, b.attemptId);
            requireValue(warning(a), 'Il tentativo non è irrisolto.');
            requireValue(current(p) === 'PAYING', 'Il pagamento non consente questa risoluzione.');
            const step = current(a) === 'PAYMENT_UNKNOWN'
              ? { state: 'PAID', logical: 'PAID', trigger: 'sendPaymentOutcome' }
              : { state: 'CANCELLED', logical: 'INSERTED', trigger: 'sendPaymentResult-v2' };
            advance(p, a, step, b.action === 'gap');
            if (b.action === 'gap') {
              // Simulate one dropped delta followed by a later metadata reconciliation.
              const previous = structuredClone(payments);
              p.projectionRevision++; p.timelineIncomplete = true;
              publish(previous, [{ paFiscalCode: p.paFiscalCode, noticeNumber: p.noticeNumber, projectionRevision: p.projectionRevision,
                changes: { logicalTransitions: [], attemptChanges: [], removedAttemptIds: [], deleted: false, timelineIncomplete: true } }]);
            }
          }
          if (b.action === 'freshness') {
            requireValue(['CURRENT', 'DELAYED', 'GAP'].includes(b.status) && Number.isInteger(b.lagSeconds) && b.lagSeconds >= 0 && typeof b.gapsDetected === 'boolean');
            const before = structuredClone(modes.empty ? [] : payments);
            freshnessState = { status: b.status, lagSeconds: b.lagSeconds, gapsDetected: b.gapsDetected };
            publish(before, []);
          }
          return json(200, { action: b.action, projectionRevision: aggregateRevision, now: iso(clock()) });
        }
        fail(404, 'NOT_FOUND', 'Risorsa non disponibile.');
      }
      cleanup();
      if (modes.delayMs) await new Promise(resolve => setTimeout(resolve, modes.delayMs));
      if (modes.failure) fail(500, 'MOCK_FAILURE', 'Errore sintetico attivato.');
      if (req.method === 'GET' && path === '/api/me') {
        requireValue(!url.search);
        return json(200, { id: user.id, role: user.role, visiblePaFiscalCodes: user.pa ? [user.pa] : null,
          capabilities: { lookupToken: user.tokens, revealToken: user.tokens, mockControls: user.admin }, authentication: 'LOCAL_DEMO_ONLY' });
      }
      if (req.method === 'GET' && path === '/api/catalog') {
        requireValue(!url.search);
        const attempts = visible(user).flatMap(p => p.attempts);
        return json(200, { logicalStates: LOGICAL_STATES, attemptStates: ATTEMPT_STATES,
          warningStates: ['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'], unknownFilterValue: '~unknown',
          serviceIdentifiers: [...new Set(attempts.map(a => a.serviceIdentifier))].sort(),
          psps: [...new Set(attempts.map(a => a.psp))].sort(),
          canali: [...new Set(attempts.map(a => a.canale))].sort(),
          stazioni: [...new Set(attempts.map(a => a.stazione))].sort(),
          aggregateFilterPolicy: 'ONE_ATTEMPT_DIMENSION;STATION_REQUIRES_PA' });
      }
      if (req.method === 'GET' && path === '/api/serviceIdentifiers') {
        requireValue(!url.search);
        const identifiers = visible(user).flatMap(p => p.attempts)
          .map(a => a.serviceIdentifier).filter(identifier => typeof identifier === 'string');
        return json(200, [...new Set(identifiers)].sort());
      }
      if (req.method === 'GET' && path === '/api/nodo-monitoring/cache/version') {
        requireValue(!url.search);
        return json(200, { checkedAt: new Date().toISOString(), nodes: [
          { node: 'NDP001', target: 'NDP001DEV', outcome: 'OK', dbStatus: 'UP', cacheId: '2575664583527662',
            version: '3.40.4', environment: 'ND', serviceIdentifier: 'NDP001DEV' },
          { node: 'NDP004', target: 'NDP004IT', outcome: 'OK', dbStatus: 'UP', cacheId: '2575664583527662',
            version: '3.42.2-snapshot', environment: 'SIT', serviceIdentifier: 'NDP004IT' },
        ] });
      }
      if (req.method === 'GET' && path === '/api/apiconfig/maintenances') {
        requireValue(!url.search);
        const snapshot = await maintenance.get();
        if (!snapshot) fail(503, 'MAINTENANCE_UNAVAILABLE', 'Manutenzioni programmate non disponibili.');
        return json(200, snapshot);
      }
      if (req.method === 'GET' && path === '/api/freshness') { requireValue(!url.search); return json(200, freshness()); }
      if (req.method === 'POST' && ['/api/token-lookup'].includes(path)) {
        requireValue(!url.search);
        if (!user.tokens) fail(403, 'FORBIDDEN', 'Privilegio token richiesto.');
        const b = await body(req);
        requireValue(Object.keys(b).every(k => ['paymentToken', 'paFiscalCode', 'noticeNumber'].includes(k))
          && typeof b.paymentToken === 'string' && b.paymentToken.length > 0 && b.paymentToken.length <= 256);
        if (b.paFiscalCode !== undefined) requireValue(typeof b.paFiscalCode === 'string' && /^\d{11}$/.test(b.paFiscalCode));
        if (b.noticeNumber !== undefined) requireValue(typeof b.noticeNumber === 'string' && /^\d{18}$/.test(b.noticeNumber));
        const p = visible(user).find(p => (!b.paFiscalCode || p.paFiscalCode === b.paFiscalCode)
          && (!b.noticeNumber || p.noticeNumber === b.noticeNumber)
          && p.attempts.some(a => a.paymentToken === b.paymentToken));
        const a = p?.attempts.find(a => a.paymentToken === b.paymentToken);
        // Audit failed searches as well, without persisting the supplied secret.
        await recordAudit(user, 'TOKEN_LOOKUP', a?.attemptId ?? null);
        if (!p) fail(404, 'NOT_FOUND', 'Tentativo non disponibile.');
        cleanup();
        const [retained, attempt] = getAttempt(user, a.attemptId);
        return json(200, { paFiscalCode: retained.paFiscalCode, noticeNumber: retained.noticeNumber,
          attemptId: attempt.attemptId, projectionRevision: retained.projectionRevision });
      }
      const reEvents = path.match(/^\/api\/attempts\/(att_\d{3}_\d+)\/re-events$/);
      if (req.method === 'POST' && reEvents) {
        requireValue(!url.search);
        const request = await body(req);
        if (expiredAttemptIds.has(reEvents[1])) fail(410, 'RE_ATTEMPT_EXPIRED', 'Tentativo scaduto; nessuna scansione RE alternativa.');
        const [p, a] = getAttempt(user, reEvents[1]);
        return json(200, reDiagnostics(p, a, request, reScenario, user.id));
      }
      const checkDb = path.match(/^\/api\/attempts\/(att_\d{3}_\d+)\/check-db$/);
      if (req.method === 'GET' && checkDb) {
        requireValue(!url.search);
        cleanup();
        const [p, a] = getAttempt(user, checkDb[1]);
        if (!a.serviceIdentifier) fail(422, 'DB_SERVICE_MISSING', 'serviceIdentifier non disponibile per il tentativo.');
        if (checkDbScenario === 'unconfigured') fail(422, 'DB_SERVICE_UNCONFIGURED', 'Nessun database configurato per il servizio del tentativo.');
        if (checkDbScenario === 'unavailable') fail(503, 'DB_UNAVAILABLE', 'Database nodo-online non raggiungibile (simulazione).');
        const observed = { logicalState: current(p), attemptState: current(a) };
        const database = checkDbScenario === 'missing'
          ? { logicalState: null, attemptState: null }
          : checkDbScenario === 'mismatch'
            ? { logicalState: current(p) === 'PAID' ? 'PAYING' : 'PAID',
              attemptState: current(a) === 'PAID' ? 'PAYING' : 'PAID' }
            : { ...observed };
        return json(200, { attemptId: a.attemptId, paFiscalCode: p.paFiscalCode, noticeNumber: p.noticeNumber,
          serviceIdentifier: a.serviceIdentifier, projectionRevision: p.projectionRevision,
          source: 'SIMULATED', checkedAt: iso(clock()), observed, database });
      }
      const reveal = path.match(/^\/api\/attempts\/(att_\d{3}_\d+)\/reveal$/);
      if (req.method === 'POST' && reveal) {
        requireValue(!url.search);
        if (!user.tokens) fail(403, 'FORBIDDEN', 'Privilegio token richiesto.');
        const b = await body(req); requireValue(!Object.keys(b).length);
        const [, a] = getAttempt(user, reveal[1]);
        await recordAudit(user, 'TOKEN_REVEAL', a.attemptId);
        cleanup();
        const [, retained] = getAttempt(user, a.attemptId);
        return json(200, { attemptId: retained.attemptId, paymentToken: retained.paymentToken });
      }
      if (req.method === 'GET' && ['/api/payments', '/api/attempts'].includes(path)) {
        const q = query(url, ['from', 'to', 'live', 'pageSize', 'cursor', 'sort']);
        // Same interval semantics as the overview: only entities with activity in [from, to) (open on the right when live).
        requireValue((q.from === undefined) === (q.to === undefined) && (q.live === undefined || q.from !== undefined));
        const data = q.from === undefined ? filtered(user, q) : withinWindow(filtered(user, q), windowFor(q), q.live === 'true');
        const items = path === '/api/payments'
          ? data.map(p => paymentSummary(getPayment(user, p.paFiscalCode, p.noticeNumber))).sort((a, b) => key(a).localeCompare(key(b)))
          : data.flatMap(p => p.attempts.map(a => safeAttempt(a, p))).sort((a, b) => a.attemptId.localeCompare(b.attemptId));
        return json(200, page(items, user, url, q));
      }
      const detail = path.match(/^\/api\/payments\/(\d{11})\/(\d{18})$/);
      if (req.method === 'GET' && detail) {
        requireValue(!url.search);
        return json(200, paymentDetail(getPayment(user, detail[1], detail[2])));
      }
      if (req.method === 'GET' && path === '/api/overview') {
        const q = query(url, ['from', 'to', 'live']); checkAggregate(q);
        const window = windowFor(q), data = filtered(user, q);
        return json(200, { ...aggregate(data, window, clock(), aggregateRevision, q.live === 'true'),
          primitives: primitiveRows(data, window, clock(), q.live === 'true'), freshness: freshness() });
      }
      if (req.method === 'GET' && path === '/api/overview/primitive-warnings') {
        const q = query(url, ['from', 'to', 'live', 'primitive', 'pageSize', 'cursor']);
        requireValue(typeof q.primitive === 'string' && q.primitive.length <= 128, 'primitive è obbligatoria.');
        const items = primitiveWarnings(filtered(user, q), windowFor(q), clock(), q.live === 'true', q.primitive);
        return json(200, page(items, user, url, q));
      }
      const creditorDetail = path.match(/^\/api\/creditors\/(\d{11})$/);
      const stationList = path.match(/^\/api\/creditors\/(\d{11})\/stations$/);
      if (req.method === 'GET' && (path === '/api/creditors' || creditorDetail || stationList)) {
        const q = query(url, ['from', 'to', 'pageSize', 'cursor', 'sort']);
        if (creditorDetail || stationList) {
          requireValue(q.paFiscalCode === undefined || q.paFiscalCode === (creditorDetail || stationList)[1]);
          q.paFiscalCode = (creditorDetail || stationList)[1];
          if (!allowed(user, q.paFiscalCode) || !visible(user).some(p => p.paFiscalCode === q.paFiscalCode)) fail(404, 'NOT_FOUND', 'Ente non disponibile.');
        }
        checkAggregate(q); windowFor(q);
        if (stationList) return json(200, page(stations(user, q, stationList[1]), user, url, q));
        if (creditorDetail) {
          requireValue(!q.cursor && !q.pageSize && !q.sort);
          return json(200, { paFiscalCode: creditorDetail[1],
            ...aggregate(filtered(user, q), windowFor(q), clock(), aggregateRevision), freshness: freshness() });
        }
        const sort = q.sort ?? 'traffic';
        requireValue(['traffic', 'unresolved'].includes(sort));
        const rows = [...new Set(filtered(user, q).map(p => p.paFiscalCode))].map(paFiscalCode => {
          const metrics = aggregate(filtered(user, { ...q, paFiscalCode }), windowFor(q), clock(), aggregateRevision);
          return { paFiscalCode, startedAttempts: metrics.traffic.reduce((n, r) => n + r.startedAttempts, 0),
            counts: metrics.counts, logicalStates: metrics.logicalStates, unresolved: metrics.unresolved };
        }).sort((a, b) => (sort === 'traffic' ? b.startedAttempts - a.startedAttempts : b.unresolved.attempts - a.unresolved.attempts) || a.paFiscalCode.localeCompare(b.paFiscalCode));
        return json(200, page(rows, user, url, q, sort));
      }
      if (req.method === 'GET' && path === '/api/events') {
        const q = query(url, ['scope', 'from', 'to', 'keys', 'live']);
        requireValue(['payment', 'overview', 'creditor', 'station', 'payment-list', 'creditor-list'].includes(q.scope));
        requireValue(q.live === undefined || q.scope === 'overview', 'live è ammesso solo nello scope overview.');
        let listKeys;
        if (q.scope === 'payment') {
          requireValue(q.paFiscalCode && q.noticeNumber && Object.keys(q).every(k => ['scope', 'paFiscalCode', 'noticeNumber'].includes(k)));
          if (!allowed(user, q.paFiscalCode)) fail(404, 'NOT_FOUND', 'Pagamento non disponibile.');
        }
        if (q.scope === 'payment-list' || q.scope === 'creditor-list') {
          requireValue(typeof q.keys === 'string' && Object.keys(q).every(k => ['scope', 'keys'].includes(k)));
          const keys = q.keys.split(',');
          requireValue(keys.length >= 1 && keys.length <= 100 && keys.every(Boolean));
          requireValue(new Set(keys).size === keys.length);
          if (q.scope === 'payment-list') {
            requireValue(keys.every(value => /^\d{11}:\d{18}$/.test(value)));
            for (const value of keys) {
              const [pa] = value.split(':');
              if (!allowed(user, pa)) fail(404, 'NOT_FOUND', 'Risorsa non disponibile.');
            }
          } else {
            requireValue(keys.every(value => /^\d{11}$/.test(value)));
            for (const pa of keys) if (!allowed(user, pa)) fail(404, 'NOT_FOUND', 'Risorsa non disponibile.');
          }
          listKeys = keys.sort();
          q.keys = listKeys.join(',');
        }
        if (!['payment-list', 'creditor-list'].includes(q.scope)) requireValue(q.keys === undefined);
        if (['creditor', 'station'].includes(q.scope)) {
          requireValue(q.paFiscalCode && !q.noticeNumber && (q.scope === 'station' ? q.stazione : !q.stazione));
          if (!allowed(user, q.paFiscalCode) || !visible(user).some(p => p.paFiscalCode === q.paFiscalCode)) fail(404, 'NOT_FOUND', 'Ente non disponibile.');
        }
        if (!['payment', 'payment-list', 'creditor-list'].includes(q.scope)) checkAggregate(q);
        const scope = Object.fromEntries(Object.entries(q).sort());
        pruneReplay();
        let last;
        if (req.headers['last-event-id']) {
          const id = req.headers['last-event-id'];
          requireValue(/^[\w-]{32}$/.test(id), 'Cursore SSE non valido.');
          last = replayCursors.get(id);
          if (!last || last.expires <= clock()) fail(410, 'SSE_CURSOR_EXPIRED', 'Aprire un nuovo stream e riallineare lo snapshot.', { resync: true });
          requireValue(last.scope === scopeKey(user, scope), 'Cursore SSE non appartenente allo scope.');
        }
        if (listKeys && !last) {
          for (const value of listKeys) {
            const [pa, notice] = value.split(':');
            const exists = q.scope === 'payment-list'
              ? visible(user).some(payment => payment.paFiscalCode === pa && payment.noticeNumber === notice)
              : visible(user).some(payment => payment.paFiscalCode === value);
            if (!exists) fail(404, 'NOT_FOUND', 'Risorsa non disponibile.');
          }
        }
        const retainedPayment = q.scope === 'payment'
          ? visible(user).find(p => p.paFiscalCode === q.paFiscalCode && p.noticeNumber === q.noticeNumber) : null;
        if (q.scope === 'payment' && !retainedPayment && !last) fail(404, 'NOT_FOUND', 'Pagamento non disponibile.');
        const window = ['payment', 'payment-list', 'creditor-list'].includes(q.scope)
          ? undefined : last?.window ?? windowFor(q);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        const client = { user, scope, res, window, live: q.live === 'true' };
        clients.add(client);
        if (last) for (const entry of history.filter(h => h.sequence > last.sequence)) {
          const data = eventData(entry, client);
          if (data) sendEvent(client, data.type, data, entry.sequence);
        }
        const revision = q.scope === 'payment'
          ? retainedPayment?.projectionRevision ?? history.flatMap(h => h.changes).filter(c =>
            c.paFiscalCode === q.paFiscalCode && c.noticeNumber === q.noticeNumber).at(-1)?.projectionRevision
              ?? last?.projectionRevision ?? 0 : aggregateRevision;
        sendEvent(client, 'ready', { type: 'ready', scope, projectionRevision: revision, ...(window ? { window } : {}) }, sequence);
        const heartbeat = setInterval(() => { cleanup(); res.write(': heartbeat\n\n'); }, heartbeatMs);
        heartbeat.unref();
        res.on('close', () => { clearInterval(heartbeat); clients.delete(client); });
        return;
      }
      fail(404, 'NOT_FOUND', 'Risorsa non disponibile.');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = error.status ?? 500;
      if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="local-demo"');
      json(status, { code: error.code ?? 'INTERNAL_ERROR',
        message: error.status ? error.message : 'Errore interno del mock.', ...error.extra });
    }
  });
  // Read-only production semantics are simulated, not an Event Hubs consumer or database.
  const cleanupTimer = setInterval(cleanup, 1000);
  cleanupTimer.unref();
  maintenance.start();
  server.on('close', () => { clearInterval(cleanupTimer); maintenance.stop(); });
  server.closeStreams = () => { for (const c of clients) c.res.end(); };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const fixed = process.env.MOCK_NOW ? Date.parse(process.env.MOCK_NOW) : null;
  if (fixed !== null && !Number.isFinite(fixed)) throw new Error('Invalid MOCK_NOW');
  const server = createMockServer({ now: fixed === null ? Date.now : () => fixed,
    ...(process.env.MAINTENANCE_SYNTHETIC === 'true' ? {} : { maintenanceFetcher: httpMaintenanceFetcher({
      url: process.env.MAINTENANCE_API_URL, apiKey: process.env.MAINTENANCE_API_KEY }) }) });
  server.listen(port, '127.0.0.1', () => console.log(`Synthetic local mock: http://127.0.0.1:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeStreams(); server.close(); });
}
