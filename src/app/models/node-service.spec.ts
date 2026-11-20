import { isDbUp, toNodeServicesCheck } from './node-service';

describe('toNodeServicesCheck', () => {
  const node = {
    node: 'NDP001', target: 'NDP001DEV', outcome: 'OK', dbStatus: 'UP', cacheId: '2575664583527662',
    version: '3.40.4', environment: 'ND', serviceIdentifier: 'NDP001DEV',
  };

  it('accepts the cache version payload', () => {
    expect(toNodeServicesCheck({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [node] }))
      .toEqual({ checkedAt: '2026-11-04T13:10:36.723Z', nodes: [node] });
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
  });
});

describe('isDbUp', () => {
  it('recognises only UP as healthy', () => {
    expect(isDbUp('UP')).toBe(true);
    expect(isDbUp('DOWN')).toBe(false);
    expect(isDbUp(null)).toBe(false);
  });
});
