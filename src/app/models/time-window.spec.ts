import { convertToParamMap } from '@angular/router';
import { rangeStart, readTimeWindow, resolveTimeWindow } from './time-window';

describe('time windows', () => {
  const end = new Date('2026-10-21T17:00:00.000Z');

  it.each([
    ['5m', 5],
    ['15m', 15],
    ['30m', 30],
    ['1h', 60],
    ['24h', 1440],
    ['7d', 10080],
    ['60d', 86400],
  ] as const)('resolves %s to exactly %i minutes', (range, minutes) => {
    const selection = readTimeWindow(convertToParamMap({ window: range }));
    expect(selection.range).toBe(range);
    expect(rangeStart(range, end).getTime()).toBe(end.getTime() - minutes * 60_000);
    expect(resolveTimeWindow(selection, end)).toEqual({
      bounds: { from: rangeStart(range, end).toISOString(), to: end.toISOString() },
      error: null,
    });
  });

  it('preserves the existing one-hour default for absent or unknown presets', () => {
    for (const window of [undefined, 'unknown']) {
      expect(readTimeWindow(convertToParamMap({ window })).range).toBe('1h');
    }
  });

  it('preserves fixed UTC bounds independently of the current time', () => {
    const bounds = { from: '2026-10-20T13:04:05.123Z', to: '2026-10-20T13:19:05.123Z' };
    const selection = readTimeWindow(convertToParamMap({ window: 'custom', ...bounds }));
    expect(resolveTimeWindow(selection, end)).toEqual({ bounds, error: null });
    expect(resolveTimeWindow(selection, new Date('2026-11-01T00:00:00Z'))).toEqual({
      bounds,
      error: null,
    });
  });

  it.each([
    ['', ''],
    ['invalid', '2026-10-21T17:00:00.000Z'],
    ['2026-02-30T00:00:00.000Z', '2026-03-02T01:00:00.000Z'],
    ['2026-10-21T17:00:00', '2026-10-21T18:00:00.000Z'],
    ['2026-10-21T17:00:00.000Z', '2026-10-21T17:00:00.000Z'],
    ['2026-10-21T18:00:00.000Z', '2026-10-21T17:00:00.000Z'],
    ['2026-08-01T00:00:00.000Z', '2026-10-21T17:00:00.000Z'],
  ])('rejects invalid custom bounds %s / %s without a fallback', (from, to) => {
    const result = resolveTimeWindow({ range: 'custom', from, to }, end);
    expect(result.bounds).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('allows exactly 60 days but rejects even one millisecond more', () => {
    const from = rangeStart('60d', end).toISOString();
    expect(resolveTimeWindow({ range: 'custom', from, to: end.toISOString() }).error).toBeNull();
    expect(
      resolveTimeWindow({
        range: 'custom',
        from,
        to: new Date(end.getTime() + 1).toISOString(),
      }).bounds,
    ).toBeNull();
  });
});
