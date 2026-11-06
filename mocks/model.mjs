export const LOGICAL_STATES = ['INSERTED', 'PAYING', 'PAID', 'NOTICE_STORED', 'NOTIFIED'];
export const RECIPIENT_STATES = ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTICE_PENDING', 'NOTIFIED'];
export const ATTEMPT_STATES = ['PAYING', 'PAYING_RPT', 'PAID_NORPT', 'PAID', 'FAILED_NORPT', 'FAILED', 'CANCELLED', 'CANCELLED_NORPT', 'NOTICE_GENERATED', 'NOTICE_STORED', 'NOTICE_SENT', 'NOTIFIED', 'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_ACCEPTED', 'PAYMENT_REFUSED', 'PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'];
export const DAY = 86_400_000;
export const iso = value => new Date(value).toISOString();
export const current = entity => entity.timeline.at(-1).state;
export const warning = attempt => ['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR'].includes(current(attempt));
export const anomalous = entity => entity.timeline.some(item => item.timestampBasis === 'ANOMALY');
export const key = payment => `${payment.paFiscalCode}/${payment.noticeNumber}`;

export function fixtures(now) {
  const transition = (state, trigger, at, basis = 'SOURCE_EVENT') => ({
    state, trigger, transitionAt: basis === 'ANOMALY' ? null : iso(at), timestampBasis: basis
  });
  const data = [
    {
      logical: [['PAYING', 'activatePaymentNotice']],
      attempts: [[['PAYING', 'activatePaymentNotice'], ['PAYMENT_RESERVED', 'closePayment'],
        ['PAYMENT_SENT', 'pspNotifyPayment'], ['PAYMENT_UNKNOWN', 'pspNotifyPayment']]], age: 1
    },
    {
      logical: [['PAYING', 'activatePaymentNotice'], ['INSERTED', 'closePayment'],
        ['PAYING', 'activatePaymentNoticeV2'], ['PAID', 'sendPaymentOutcomeV2']],
      attempts: [
        [['PAYING', 'activatePaymentNotice'], ['CANCELLED', 'closePayment']],
        [['PAYING', 'activatePaymentNoticeV2'], ['PAYMENT_RESERVED', 'closePayment-v2'],
          ['PAYMENT_SENT', 'pspNotifyPaymentV2'], ['PAYMENT_ACCEPTED', 'pspNotifyPaymentV2'], ['PAID', 'sendPaymentOutcomeV2']]
      ], age: 3
    },
    {
      logical: [['PAYING', 'activatePaymentNotice'], ['INSERTED', 'closePayment']],
      attempts: [[['PAYING', 'activatePaymentNotice'], ['CANCELLED', 'closePayment']]], age: 59.9
    },
    {
      logical: [['PAYING', 'activatePaymentNoticeV2']],
      attempts: [[['PAYING', 'activatePaymentNoticeV2'], ['PAYMENT_RESERVED', 'closePayment-v2'],
        ['PAYMENT_SENT', 'pspNotifyPaymentV2'], ['PAYMENT_SEND_ERROR', 'pspNotifyPaymentV2']]], age: 0.2
    },
    {
      logical: [['PAYING', 'activatePaymentNotice'], ['PAID', 'sendPaymentOutcome'], ['NOTICE_STORED', 'NodoInviaRPT']],
      attempts: [[['PAYING', 'activatePaymentNotice'], ['PAID_NORPT', 'sendPaymentOutcome'],
        ['PAID', 'NodoInviaRPT'], ['NOTICE_GENERATED', 'NodoInviaRPT'], ['NOTICE_STORED', 'NodoInviaRPT']]], age: 10
    },
    {
      logical: [['PAYING', 'activatePaymentNoticeV2'], ['PAID', 'sendPaymentOutcomeV2'], ['NOTIFIED', 'sendPaymentOutcomeV2']],
      attempts: [[['PAYING', 'activatePaymentNoticeV2'], ['PAID', 'sendPaymentOutcomeV2'],
        ['NOTICE_GENERATED', 'sendPaymentOutcomeV2'], ['NOTICE_SENT', 'sendPaymentOutcomeV2'],
        ['NOTIFIED', 'sendPaymentOutcomeV2']]], age: 20
    },
    {
      logical: [['PAYING', 'activatePaymentNotice']],
      attempts: [[['PAYING', 'activatePaymentNotice'], ['PAYMENT_RESERVED', 'closePayment'],
        ['PAYMENT_SENT', 'pspNotifyPayment']]], age: 2, estimated: true
    },
    {
      logical: [['PAYING', 'activatePaymentNotice']],
      attempts: [[['PAYING', 'activatePaymentNotice']]], age: 1, missing: true
    }
  ];
  return data.map((item, index) => {
    const started = now - item.age * DAY;
    const paFiscalCode = index < 4 ? '00000000001' : '00000000002';
    return {
      paFiscalCode, noticeNumber: `30000000000000000${index + 1}`,
      projectionRevision: 1, timelineIncomplete: Boolean(item.estimated || item.missing),
      timeline: item.logical.map(([state, trigger], i) => {
        // Retry activations/outcomes share the corresponding attempt's clock.
        const at = index === 1 ? [started, started + 60_000, started + DAY, started + DAY + 240_000][i]
          : state === 'PAID' ? started + item.attempts[0].findIndex(([state]) => ['PAID', 'PAID_NORPT'].includes(state)) * 60_000
          : state === 'NOTICE_STORED' || state === 'NOTIFIED' ? started + (item.attempts[0].length - 1) * 60_000
          : started + i * 60_000;
        return transition(state, trigger, at, item.missing ? 'ANOMALY' : item.estimated && i === 0 ? 'INFERRED' : 'SOURCE_EVENT');
      }),
      attempts: item.attempts.map((states, a) => {
        const first = started + a * DAY;
        return {
          attemptId: `att_${String(index + 1).padStart(3, '0')}_${a + 1}`,
          paymentToken: `SYNTHETIC-TOKEN-${index + 1}-${a + 1}`,
          serviceIdentifier: item.missing ? null : index % 2 ? 'SYNTHETIC_SERVICE_B' : 'SYNTHETIC_SERVICE_A',
          psp: item.missing ? null : index % 2 ? 'ABI00002' : 'ABI00001',
          stazione: item.missing ? null : `${paFiscalCode}_${index % 2 ? '02' : '01'}`,
          canale: item.missing ? null : index % 2 ? 'SYNTHETIC_CHANNEL_B' : 'SYNTHETIC_CHANNEL_A',
          attemptStartedAt: item.missing ? null : iso(first),
          startTimestampBasis: item.missing ? 'ANOMALY' : item.estimated ? 'INFERRED' : 'SOURCE_EVENT',
          firstSeenAt: first, expiresAt: first + 60 * DAY,
          timelineIncomplete: Boolean(item.estimated || item.missing),
          timeline: states.map(([state, trigger], i) => transition(state, trigger,
            first + (item.estimated ? Math.max(0, i - 1) : i) * 60_000,
            item.missing ? 'ANOMALY' : item.estimated && i === 0 ? 'INFERRED' : 'SOURCE_EVENT'))
        };
      }),
      recipients: [4, 5].includes(index) ? [1, 2].map(number => ({
        recipientId: `rcp_${String(index + 1).padStart(3, '0')}_${number}`,
        stazioneRecipient: `${paFiscalCode}_RECIPIENT_${number}`,
        timelineIncomplete: false,
        firstSeenAt: started + 2 * 60_000, expiresAt: started + 2 * 60_000 + 60 * DAY,
        timeline: (index === 5 ? ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTIFIED'] : ['NOTICE_GENERATED'])
          .map((state, i) => transition(state, index === 5 ? 'sendPaymentOutcomeV2' : 'NodoInviaRPT',
            started + (i + 2) * 60_000)),
      })) : [],
    };
  });
}

export function safeAttempt(attempt, payment) {
  const { paymentToken, firstSeenAt: _first, expiresAt: _expiry, ...safe } = attempt;
  return { ...safe, paFiscalCode: payment.paFiscalCode, noticeNumber: payment.noticeNumber,
    state: current(attempt), warning: warning(attempt), hasAnomaly: anomalous(attempt),
    tokenDisplay: paymentToken, projectionRevision: payment.projectionRevision };
}

export function safeRecipient(recipient, payment) {
  const { firstSeenAt: _seen, expiresAt: _expires, ...safe } = recipient;
  return { ...safe, paFiscalCode: payment.paFiscalCode, noticeNumber: payment.noticeNumber,
    state: current(recipient), hasAnomaly: anomalous(recipient), projectionRevision: payment.projectionRevision };
}

export function retainedRecipients(payment, now) {
  return payment.recipients.filter(recipient => recipient.expiresAt > now);
}

export function paymentSummary(payment) {
  return {
    paFiscalCode: payment.paFiscalCode, noticeNumber: payment.noticeNumber,
    state: current(payment), projectionRevision: payment.projectionRevision,
    timelineIncomplete: payment.timelineIncomplete,
    hasAnomaly: anomalous(payment) || payment.attempts.some(anomalous) || payment.recipients.some(anomalous),
    warning: payment.attempts.some(warning), attemptCount: payment.attempts.length
  };
}

export function paymentDetail(payment) {
  return { ...paymentSummary(payment), timeline: payment.timeline,
    attempts: payment.attempts.map(attempt => safeAttempt(attempt, payment)),
    recipients: payment.recipients.map(recipient => safeRecipient(recipient, payment)) };
}

export function selected(payments, filters, allowedPa) {
  const match = (value, wanted) => wanted === undefined || (wanted === '~unknown' ? value === null : value === wanted);
  return payments.filter(p => (!allowedPa || p.paFiscalCode === allowedPa)
    && match(p.paFiscalCode, filters.paFiscalCode) && match(p.noticeNumber, filters.noticeNumber)
    && match(current(p), filters.logicalState)
    && (filters.anomaliesOnly !== 'true' || anomalous(p) || p.attempts.some(anomalous) || p.recipients.some(anomalous)))
    .map(p => ({ ...p, attempts: p.attempts.filter(a =>
      match(current(a), filters.attemptState) && match(a.serviceIdentifier, filters.serviceIdentifier)
      && match(a.psp, filters.psp) && match(a.canale, filters.canale) && match(a.stazione, filters.stazione)
      && (filters.unresolvedOnly !== 'true' || warning(a))) }))
    .filter(p => p.attempts.length);
}

// A primitive request must be answered within this budget, otherwise it is a (visual) warning.
export const PRIMITIVE_RESPONSE_BUDGET_MS = 10_000;
// Synthetic RE pairing: every sourced transition stands for one primitive call. PAYMENT_UNKNOWN is answered
// late and PAYMENT_SEND_ERROR is never answered, so the fixtures exercise both warning causes.
const primitiveLatency = state => state === 'PAYMENT_UNKNOWN' ? 12_000 : state === 'PAYMENT_SEND_ERROR' ? null : 300;
// Direction of a primitive call relative to the Nodo, from the RE parties of its REQ event: the Nodo serves the call
// (erogatore) when others call it, it is the caller (fruitore) when it calls a PA or PSP. Never guessed otherwise.
export const NODO_PARTY = 'NodoDeiPagamentiSPC';
export const primitiveDirection = ({ fruitore, erogatore }) =>
  erogatore === NODO_PARTY ? 'INBOUND' : fruitore === NODO_PARTY ? 'OUTBOUND' : 'UNKNOWN';
// Synthetic RE parties: the mock has no REQ events, so they are simulated per primitive name (case-insensitive,
// ignoring a trailing V2). Primitives not listed (e.g. cacheVersion) carry no known party and stay UNKNOWN.
const NODO_SERVES = new Set(['verifypaymentnotice', 'activatepaymentnotice', 'sendpaymentoutcome', 'closepayment',
  'checkposition', 'nodoinviarpt']);
const NODO_CALLS = new Set(['paverifypaymentnotice', 'pagetpayment', 'pasendrt', 'pspnotifypayment', 'sendpaymentresult',
  'paattivarpt']);
export function primitiveParties(primitive) {
  const name = primitive.toLowerCase().replace(/[-_]?v2$/, '');
  if (NODO_SERVES.has(name)) return { fruitore: 'SYNTHETIC_CALLER', erogatore: NODO_PARTY };
  if (NODO_CALLS.has(name)) return { fruitore: NODO_PARTY, erogatore: 'SYNTHETIC_RECIPIENT' };
  return { fruitore: null, erogatore: null };
}
// `live` keeps the window open on the right: requests after `to` still count (rolling preset ranges).
function* primitiveCalls(payments, window, now, live) {
  for (const payment of payments) {
    for (const attempt of payment.attempts) {
      for (const t of attempt.timeline) {
        if (t.timestampBasis === 'ANOMALY' || !t.transitionAt || !t.trigger) continue;
        const requestAt = Date.parse(t.transitionAt);
        if (requestAt < Date.parse(window.from) || (!live && requestAt >= Date.parse(window.to))) continue;
        const latency = primitiveLatency(t.state);
        yield { payment, attempt, primitive: t.trigger, requestAt, answered: latency !== null,
          warning: latency === null ? now - requestAt > PRIMITIVE_RESPONSE_BUDGET_MS : latency > PRIMITIVE_RESPONSE_BUDGET_MS };
      }
    }
  }
}
export function primitiveRows(payments, window, now, live = false) {
  const rows = new Map();
  for (const { attempt, primitive, answered, warning } of primitiveCalls(payments, window, now, live)) {
    const direction = primitiveDirection(primitiveParties(primitive));
    const id = JSON.stringify([attempt.serviceIdentifier, primitive, direction]);
    const row = rows.get(id) || { serviceIdentifier: attempt.serviceIdentifier, primitive, direction, requests: 0, responses: 0, warnings: 0 };
    row.requests++;
    if (answered) row.responses++;
    if (warning) row.warnings++;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => String(a.serviceIdentifier).localeCompare(String(b.serviceIdentifier))
    || a.primitive.localeCompare(b.primitive) || a.direction.localeCompare(b.direction));
}
// Calls counted as `warnings` by primitiveRows for one primitive, newest first. Service and dimension filters are
// applied by the caller through `selected`, exactly as for the overview.
export function primitiveWarnings(payments, window, now, live, primitive) {
  return [...primitiveCalls(payments, window, now, live)]
    .filter(call => call.warning && call.primitive === primitive)
    .map(({ payment, attempt, requestAt }) => ({ calledAt: iso(requestAt), psp: attempt.psp,
      canale: attempt.canale, paFiscalCode: payment.paFiscalCode, stazione: attempt.stazione }))
    .sort((a, b) => b.calledAt.localeCompare(a.calledAt) || a.paFiscalCode.localeCompare(b.paFiscalCode)
      || String(a.stazione).localeCompare(String(b.stazione)) || String(a.psp).localeCompare(String(b.psp)));
}

// `live` keeps the window open on the right (rolling preset ranges): activity after `to` still counts.
const windowTest = (window, live) => value => value !== null && value !== undefined
  && Date.parse(value) >= Date.parse(window.from) && (live || Date.parse(value) < Date.parse(window.to));
const hasActivity = (record, inWindow) => record.timeline.some(t => t.timestampBasis !== 'ANOMALY' && inWindow(t.transitionAt));
// Entities belong to an interval when they had activity in it (at least one dated transition, or the attempt start).
// Payments with no dated activity of their own are kept when one of their attempts or recipients was active; the
// returned payments only carry the active attempts and recipients. Undated (ANOMALY-only) entities match no interval.
export function withinWindow(payments, window, live = false) {
  const inWindow = windowTest(window, live);
  const attemptActive = a => inWindow(a.attemptStartedAt) || hasActivity(a, inWindow);
  const recipientActive = r => hasActivity(r, inWindow);
  return payments
    .filter(p => hasActivity(p, inWindow) || p.attempts.some(attemptActive) || p.recipients.some(recipientActive))
    .map(p => ({ ...p, attempts: p.attempts.filter(attemptActive), recipients: p.recipients.filter(recipientActive) }));
}
const counts = (states, entities) => states.map(state => ({ state, count: entities.filter(e => current(e) === state).length }));
export function aggregate(allPayments, window, now, revision, live = false) {
  const payments = withinWindow(allPayments, window, live);
  const attempts = payments.flatMap(p => p.attempts);
  const recipients = payments.flatMap(p => p.recipients);
  const inWindow = windowTest(window, live);
  const dayBucket = value => `${value.slice(0, 10)}T00:00:00.000Z`;
  const traffic = new Map();
  for (const a of attempts.filter(a => inWindow(a.attemptStartedAt))) {
    const bucketStart = dayBucket(a.attemptStartedAt);
    const row = traffic.get(bucketStart) || { bucketStart, startedAttempts: 0, estimatedStarts: 0 };
    row.startedAttempts++;
    if (a.startTimestampBasis === 'INFERRED') row.estimatedStarts++;
    traffic.set(bucketStart, row);
  }
  const transitions = new Map();
  const durations = new Map();
  for (const [entity, records] of [['logical', payments], ['attempt', attempts], ['recipient', recipients]]) {
    for (const record of records) {
      for (const t of record.timeline.filter(t => t.timestampBasis !== 'ANOMALY' && inWindow(t.transitionAt))) {
        const bucketStart = dayBucket(t.transitionAt);
        const id = `${bucketStart}/${entity}/${t.state}/${t.timestampBasis}`;
        const row = transitions.get(id) || { bucketStart, entity, state: t.state, timestampBasis: t.timestampBasis, count: 0 };
        row.count++;
        transitions.set(id, row);
      }
      for (let i = 1; i < record.timeline.length; i++) {
        const a = record.timeline[i - 1], b = record.timeline[i];
        if (!a.transitionAt || !b.transitionAt || !inWindow(b.transitionAt)) continue;
        const duration = Date.parse(b.transitionAt) - Date.parse(a.transitionAt);
        if (duration < 0) continue;
        const timestampBasis = [a, b].some(t => t.timestampBasis === 'INFERRED') ? 'INFERRED' : 'SOURCE_EVENT';
        const id = `${entity}/${a.state}/${b.state}/${timestampBasis}`;
        const row = durations.get(id) || { entity, fromState: a.state, toState: b.state, timestampBasis, samples: [] };
        row.samples.push(duration);
        durations.set(id, row);
      }
    }
  }
  const matrix = dimension => [...new Set(attempts.map(a => a[dimension]))].sort((a, b) => String(a).localeCompare(String(b)))
    .map(value => ({ value, states: counts(ATTEMPT_STATES, attempts.filter(a => a[dimension] === value)) }));
  return {
    snapshotAt: iso(now), projectionRevision: revision, window,
    counts: { payments: payments.length, attempts: attempts.length },
    logicalStates: counts(LOGICAL_STATES, payments), attemptStates: counts(ATTEMPT_STATES, attempts),
    recipientStates: counts(RECIPIENT_STATES, recipients),
    unresolved: { payments: payments.filter(p => p.attempts.some(warning)).length, attempts: attempts.filter(warning).length },
    matrices: { psp: matrix('psp'), canale: matrix('canale'),
      recipient: [...new Set(recipients.map(r => r.stazioneRecipient))].sort((a, b) => String(a).localeCompare(String(b)))
        .map(value => ({ value, states: counts(RECIPIENT_STATES, recipients.filter(r => r.stazioneRecipient === value)) })) },
    traffic: [...traffic.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart)),
    transitions: [...transitions.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    durations: [...durations.values()].map(({ samples, ...r }) => {
      const ordered = [...samples].sort((a, b) => a - b);
      const quantile = p => ordered[Math.ceil(p * ordered.length) - 1];
      return { ...r, samples: ordered.length, averageMs: ordered.reduce((sum, sample) => sum + sample, 0) / ordered.length,
        medianMs: quantile(0.5), p95Ms: quantile(0.95) };
    }),
    anomalies: { transitions: [...payments, ...attempts, ...recipients].flatMap(p => p.timeline).filter(t => t.timestampBasis === 'ANOMALY').length,
      payments: payments.filter(p => anomalous(p) || p.attempts.some(anomalous) || p.recipients.some(anomalous)).length }
  };
}
