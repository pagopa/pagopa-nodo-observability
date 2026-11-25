import { Attempt } from './domain';
import { defaultReWindow, isReEventsResponse, positionReWindow, RE_FIELDS } from './re-event';

export function reResponse() {
  return {
    attemptId: 'attempt-1',
    source: 'RE',
    retrievedAt: '2026-10-23T12:00:00.000Z',
    window: { from: '2026-10-23T10:00:00.000Z', to: '2026-10-23T11:00:00.000Z' },
    coverage: 'WINDOW_ONLY',
    nextCursor: null,
    truncated: false,
    warnings: [],
    events: [
      {
        ...Object.fromEntries(RE_FIELDS.map((field) => [field, null])),
        insertedTimestamp: '2026-10-23T10:00:00.1234567',
        status: 'unknown_FUTURE_STATE',
        version: 1,
        standIn: false,
        payload: 'w6g=',
        payloadDecoded: { status: 'DECODED', text: 'è', reason: null },
        payloadOmitted: false,
        payloadSourceBytes: 4,
      },
    ],
  };
}

describe('RE diagnostic contract', () => {
  it('preserves every original field, nullable values, unknown states and precise timestamps', () => {
    const value = reResponse();
    expect(RE_FIELDS.length).toBe(33);
    expect(isReEventsResponse(value)).toBe(true);
    expect(value.events[0].insertedTimestamp).toBe('2026-10-23T10:00:00.1234567');
  });

  it('rejects malformed envelopes, missing source fields and inconsistent payload outcomes', () => {
    const valid = reResponse();
    for (const patch of [
      { source: 'SIMULATED' },
      { coverage: 'COMPLETE' },
      { nextCursor: 12 },
      { retrievedAt: 'invalid' },
      { warnings: [1] },
      { events: [{}] },
      { events: [{ ...valid.events[0], version: {} }] },
      {
        events: [
          {
            ...valid.events[0],
            payloadDecoded: { status: 'INVALID_UTF8', text: 'fallback', reason: null },
          },
        ],
      },
      { events: [{ ...valid.events[0], payloadOmitted: true }] },
    ])
      expect(isReEventsResponse({ ...valid, ...patch })).toBe(false);
    expect(
      isReEventsResponse({
        ...valid,
        window: { from: valid.window.to, to: valid.window.from },
      }),
    ).toBe(false);
  });

  it('allows an explicit oversized omission but never treats it as an absent payload', () => {
    const value = reResponse();
    const event = {
      ...value.events[0],
      payload: null,
      payloadOmitted: true,
      payloadSourceBytes: 400000,
      payloadDecoded: { status: 'TOO_LARGE', text: null, reason: 'Limite superato' },
    };
    expect(isReEventsResponse({ ...value, events: [event] })).toBe(true);
    expect(isReEventsResponse({ ...value, events: [{ ...event, payloadOmitted: false }] })).toBe(
      false,
    );
  });

  const attempt = {
    attemptStartedAt: '2026-10-23T10:00:00.000Z',
    startTimestampBasis: 'SOURCE_EVENT',
    timeline: [
      { state: 'PAYING', transitionAt: '2026-10-23T10:10:00.000Z', timestampBasis: 'SOURCE_EVENT' },
    ],
  } satisfies Pick<Attempt, 'attemptStartedAt' | 'startTimestampBasis' | 'timeline'>;
  const now = Date.parse('2026-10-23T12:00:00.000Z');

  it('suggests the UTC window with margins and clips a long history to its first 24 hours', () => {
    expect(defaultReWindow(attempt, now)).toEqual({
      from: '2026-10-23T09:45:00.000Z',
      to: '2026-10-23T12:00:00.000Z',
      segmented: false,
    });
    expect(
      defaultReWindow({ ...attempt, attemptStartedAt: '2026-10-20T10:00:00.000Z' }, now)?.segmented,
    ).toBe(true);
  });

  it('extends to the last transition plus margin only once the attempt is older than a day', () => {
    expect(
      defaultReWindow(
        { ...attempt, attemptStartedAt: '2026-10-21T10:00:00.000Z', timeline: [{ ...attempt.timeline[0], transitionAt: '2026-10-21T10:10:00.000Z' }] },
        now,
      ),
    ).toEqual({ from: '2026-10-21T09:45:00.000Z', to: '2026-10-21T10:25:00.000Z', segmented: false });
  });

  it('requires explicit input for absent, future, invalid or incoherent history', () => {
    expect(defaultReWindow({ ...attempt, attemptStartedAt: null }, now)).toBeNull();
    expect(
      defaultReWindow({ ...attempt, attemptStartedAt: '2026-10-24T10:00:00.000Z' }, now),
    ).toBeNull();
    expect(
      defaultReWindow(
        {
          ...attempt,
          timeline: [{ ...attempt.timeline[0], transitionAt: '2026-10-22T10:00:00Z' }],
        },
        now,
      ),
    ).toBeNull();
  });
});

describe('positionReWindow', () => {
  const now = Date.parse('2026-10-23T12:00:00.000Z');
  const attempt = (attemptId: string, attemptStartedAt: string | null, basis = 'SOURCE_EVENT' as const) => ({
    attemptId,
    attemptStartedAt,
    startTimestampBasis: basis,
  });

  it('starts one hour before the earliest attempt, so token-less verifyPaymentNotice calls are in range', () => {
    expect(
      positionReWindow(
        [attempt('late', '2026-10-23T11:00:00.000Z'), attempt('early', '2026-10-23T10:00:00.000Z')],
        now,
      ),
    ).toEqual({
      attemptId: 'early',
      window: { from: '2026-10-23T09:00:00.000Z', to: '2026-10-23T12:00:00.000Z' },
    });
  });

  it('is limited to 24 hours and never goes beyond now', () => {
    expect(positionReWindow([attempt('old', '2026-10-20T10:00:00.000Z')], now)?.window).toEqual({
      from: '2026-10-20T09:00:00.000Z',
      to: '2026-10-21T09:00:00.000Z',
    });
  });

  it('requires an attempt with a valid start', () => {
    expect(positionReWindow([], now)).toBeNull();
    expect(positionReWindow([attempt('a', null)], now)).toBeNull();
    expect(positionReWindow([attempt('a', '2026-10-23T10:00:00.000Z', 'ANOMALY' as never)], now)).toBeNull();
    expect(positionReWindow([attempt('a', '2026-10-24T10:00:00.000Z')], now)).toBeNull();
  });
});
