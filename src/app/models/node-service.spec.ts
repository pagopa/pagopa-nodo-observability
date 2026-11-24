import { cacheAlignment, cacheTimestampInstant, isDbUp, toNodeServicesCheck } from './node-service';

describe('toNodeServicesCheck', () => {
  const node = {
    node: 'NDP001', target: 'NDP001DEV', outcome: 'OK', dbStatus: 'UP', cacheId: '2575664583527662',
    version: '3.40.4', environment: 'ND', serviceIdentifier: 'NDP001DEV',
  };
  const cache = {
    outcome: 'OK', cacheId: '2575664583527662', version: 'GZIP_JSON-0.10.2',
    timestamp: '2026-11-24T09:53:25.633178+01:00[Europe/Rome]', environment: 'dev', serviceIdentifier: 'CACHE',
  };

  it('accepts the cache version payload', () => {
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [node], cache }))
      .toEqual({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [node], cache });
  });

  it('keeps a missing cache block as null and fills absent cache fields with null', () => {
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [] })?.cache).toBeNull();
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [], cache: { outcome: 'UNAVAILABLE' } })?.cache)
      .toEqual({ outcome: 'UNAVAILABLE', cacheId: null, version: null, timestamp: null, environment: null, serviceIdentifier: null });
  });

  it('fills absent optional fields with null', () => {
    const result = toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [{ serviceIdentifier: 'NDP004IT' }] });
    expect(result?.nodes[0]).toEqual({
      node: '', target: '', outcome: '', dbStatus: null, cacheId: null, version: null, environment: null,
      serviceIdentifier: 'NDP004IT',
    });
  });

  it('rejects invalid payloads', () => {
    expect(toNodeServicesCheck(null)).toBeNull();
    expect(toNodeServicesCheck({ checkedAt: 'ieri', nodes: [] })).toBeNull();
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z' })).toBeNull();
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [{ ...node, serviceIdentifier: ' ' }] })).toBeNull();
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [{ ...node, version: 3 }] })).toBeNull();
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [], cache: 'OK' })).toBeNull();
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [], cache: { ...cache, cacheId: 1 } })).toBeNull();
  });
});

describe('isDbUp', () => {
  it('recognises only UP as healthy', () => {
    expect(isDbUp('UP')).toBe(true);
    expect(isDbUp('DOWN')).toBe(false);
    expect(isDbUp(null)).toBe(false);
  });
});

describe('cacheTimestampInstant', () => {
  it('parses a ZonedDateTime with zone id and microseconds', () => {
    expect(cacheTimestampInstant('2026-11-24T09:53:25.633178+01:00[Europe/Rome]')).toBe('2026-11-24T08:53:25.633Z');
    expect(cacheTimestampInstant('2026-11-24T08:53:25Z')).toBe('2026-11-24T08:53:25.000Z');
  });

  it('returns null for missing or unparsable values', () => {
    expect(cacheTimestampInstant(null)).toBeNull();
    expect(cacheTimestampInstant('ieri')).toBeNull();
  });
});

describe('cacheAlignment', () => {
  const node = {
    node: 'NDP001', target: 'NDP001DEV', outcome: 'OK', dbStatus: 'UP', cacheId: '1',
    version: '3.40.4', environment: 'ND', serviceIdentifier: 'NDP001DEV',
  };
  const cache = { outcome: 'OK', cacheId: '1', version: null, timestamp: null, environment: 'dev', serviceIdentifier: 'CACHE' };

  it('compares the node cache id with the configuration cache', () => {
    expect(cacheAlignment(node, cache)).toBe(true);
    expect(cacheAlignment({ ...node, cacheId: '2' }, cache)).toBe(false);
  });

  it('cannot compare without a successful cache check or both ids', () => {
    expect(cacheAlignment(node, null)).toBeNull();
    expect(cacheAlignment(node, { ...cache, outcome: 'UNAVAILABLE' })).toBeNull();
    expect(cacheAlignment(node, { ...cache, cacheId: null })).toBeNull();
    expect(cacheAlignment({ ...node, cacheId: null }, cache)).toBeNull();
  });
});
