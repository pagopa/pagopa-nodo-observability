import type { PrimitiveCount } from './domain';
import { primitiveNature, primitiveNatureTotals } from './primitive-nature';

const row = (primitive: string, requests: number, warnings = 0): PrimitiveCount => ({
  serviceIdentifier: 'svc',
  primitive,
  direction: 'UNKNOWN',
  requests,
  responses: requests - warnings,
  warnings,
});

describe('primitive nature', () => {
  it('classifies by original name, ignoring case and the V2 suffix', () => {
    expect(primitiveNature('verifyPaymentNotice')).toBe('inquiry');
    expect(primitiveNature('paVerifyPaymentNotice')).toBe('inquiry');
    expect(primitiveNature('checkPosition')).toBe('inquiry');
    expect(primitiveNature('activatePaymentNoticeV2')).toBe('payment');
    expect(primitiveNature('closePayment-v2')).toBe('payment');
    expect(primitiveNature('paSendRTV2')).toBe('payment');
    expect(primitiveNature('paGetPaymentV2')).toBe('payment');
    expect(primitiveNature('somethingNew')).toBe('other');
  });

  it('totals requests, responses and warnings per nature and hides empty "other"', () => {
    const totals = primitiveNatureTotals([
      row('verifyPaymentNotice', 57),
      row('checkPosition', 34),
      row('activatePaymentNoticeV2', 1),
      row('paSendRTV2', 1, 1),
    ]);
    expect(
      totals.map((total) => [total.nature, total.requests, total.responses, total.warnings]),
    ).toEqual([
      ['inquiry', 91, 91, 0],
      ['payment', 2, 1, 1],
    ]);
    expect(totals.map((total) => Math.round(total.share))).toEqual([98, 2]);
    expect(totals[0].primitives.map((entry) => [entry.primitive, entry.requests])).toEqual([
      ['verifyPaymentNotice', 57],
      ['checkPosition', 34],
    ]);
  });

  it('merges the same primitive across services and lists the most called first', () => {
    const [inquiry] = primitiveNatureTotals([
      { ...row('checkPosition', 12), serviceIdentifier: 'A' },
      { ...row('checkPosition', 22), serviceIdentifier: 'B' },
      { ...row('verifyPaymentNotice', 40), serviceIdentifier: 'B' },
    ]);
    expect(inquiry.primitives.map((entry) => [entry.primitive, entry.requests])).toEqual([
      ['verifyPaymentNotice', 40],
      ['checkPosition', 34],
    ]);
  });

  it('keeps the main natures visible, with no primitives, when nothing was called', () => {
    const totals = primitiveNatureTotals([]);
    expect(
      totals.map((total) => [total.nature, total.requests, total.share, total.primitives.length]),
    ).toEqual([
      ['inquiry', 0, 0, 0],
      ['payment', 0, 0, 0],
    ]);
    expect(primitiveNatureTotals([row('mystery', 3)]).map((total) => total.nature)).toEqual([
      'inquiry',
      'payment',
      'other',
    ]);
  });

  it('splits each nature by direction, keeping rows without a known direction as unknown', () => {
    const inbound: PrimitiveCount = { ...row('verifyPaymentNotice', 5), direction: 'INBOUND' };
    const outbound: PrimitiveCount = { ...row('paVerifyPaymentNotice', 2, 1), direction: 'OUTBOUND' };
    const legacy = { ...row('checkPosition', 3), direction: undefined } as unknown as PrimitiveCount;
    const [inquiry] = primitiveNatureTotals([inbound, outbound, legacy]);
    expect(
      inquiry.directions.map((part) => [part.direction, part.requests, part.warnings, part.primitives.map((entry) => entry.primitive)]),
    ).toEqual([
      ['INBOUND', 5, 0, ['verifyPaymentNotice']],
      ['OUTBOUND', 2, 1, ['paVerifyPaymentNotice']],
      ['UNKNOWN', 3, 0, ['checkPosition']],
    ]);
  });
});
