import { applyAggregateRows } from './aggregate-rows';
import { CountRow } from '../../models/domain';

describe('aggregate row deltas', () => {
  it('adds a signed delta once when creating, removing, and recreating a row', () => {
    let rows = applyAggregateRows<CountRow>([], [{ state: 'PAID', count: 1 }], ['state'], ['count'], true);
    expect(rows).toEqual([{ state: 'PAID', count: 1 }]);

    rows = applyAggregateRows(rows, [{ state: 'PAID', count: -1 }], ['state'], ['count']);
    expect(rows).toEqual([]);

    rows = applyAggregateRows(rows, [{ state: 'PAID', count: 2 }], ['state'], ['count']);
    expect(rows).toEqual([{ state: 'PAID', count: 2 }]);
  });

  it('keeps recipient retries separate by station and entity, including null stations', () => {
    const rows = applyAggregateRows(
      [
        { value: null, state: 'NOTICE_SENT', count: 1 },
        { value: 'STAZ-1', state: 'NOTICE_SENT', count: 2 },
      ],
      [
        { value: 'STAZ-1', state: 'NOTICE_SENT', count: -1 },
        { value: 'STAZ-1', state: 'NOTICE_PENDING', count: 1 },
      ],
      ['value', 'state'],
      ['count'],
    );
    expect(rows).toEqual([
      { value: null, state: 'NOTICE_SENT', count: 1 },
      { value: 'STAZ-1', state: 'NOTICE_SENT', count: 1 },
      { value: 'STAZ-1', state: 'NOTICE_PENDING', count: 1 },
    ]);
    expect(applyAggregateRows(
      [{ entity: 'attempt', state: 'NOTICE_SENT', count: 1 }],
      [{ entity: 'recipient', state: 'NOTICE_SENT', count: 1 }],
      ['entity', 'state'], ['count'],
    )).toHaveLength(2);
  });
});
