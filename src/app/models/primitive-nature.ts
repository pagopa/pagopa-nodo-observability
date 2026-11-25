import { PRIMITIVE_DIRECTIONS, type PrimitiveCount, type PrimitiveDirection } from './domain';

/**
 * Nature of a primitive, to keep call volumes comparable with payments and attempts: only primitives
 * that move a payment (`payment`) relate to those counts, while inquiries (`inquiry`) are traffic that
 * creates no payment. Classification is by the original primitive name (`tipoEvento`, case-insensitive,
 * ignoring a trailing `V2`); anything not listed stays visible as `other` instead of being guessed.
 */
export type PrimitiveNature = 'inquiry' | 'payment' | 'other';

export interface PrimitiveNatureInfo {
  readonly nature: PrimitiveNature;
  readonly label: string;
}

export const PRIMITIVE_NATURES: readonly PrimitiveNatureInfo[] = [
  { nature: 'inquiry', label: 'Consultazione' },
  { nature: 'payment', label: 'Pagamento' },
  { nature: 'other', label: 'Altre' },
];

const INQUIRY = new Set(['verifypaymentnotice', 'paverifypaymentnotice', 'checkposition']);
const PAYMENT = new Set([
  'activatepaymentnotice',
  'closepayment',
  'sendpaymentoutcome',
  'pagetpayment',
  'pasendrt',
  'pspnotifypayment',
  'nodoinviarpt',
  'paattivarpt',
]);

export function primitiveNature(primitive: string): PrimitiveNature {
  const name = primitive.toLowerCase().replace(/[-_]?v2$/, '');
  if (INQUIRY.has(name)) return 'inquiry';
  if (PAYMENT.has(name)) return 'payment';
  return 'other';
}

/** One primitive (original name) summed over every service, inside a nature. */
export interface PrimitiveNatureEntry {
  readonly primitive: string;
  readonly requests: number;
  readonly responses: number;
  readonly warnings: number;
}

/** The primitives of one nature that share a direction relative to the Nodo. */
export interface PrimitiveDirectionGroup {
  readonly direction: PrimitiveDirection;
  readonly label: string;
  readonly hint: string;
  readonly requests: number;
  readonly warnings: number;
  readonly primitives: readonly PrimitiveNatureEntry[];
}

export interface PrimitiveNatureTotal extends PrimitiveNatureInfo {
  readonly requests: number;
  readonly responses: number;
  readonly warnings: number;
  /** Share of all requests in the window, in [0, 100]. */
  readonly share: number;
  /** The primitives actually called in the window, most called first. */
  readonly primitives: readonly PrimitiveNatureEntry[];
  /** The same primitives split by direction; only directions with calls, `UNKNOWN` last. */
  readonly directions: readonly PrimitiveDirectionGroup[];
}

/** A row without a recognised direction (older backend) stays visible as `UNKNOWN` instead of being dropped. */
const directionOf = (row: PrimitiveCount): PrimitiveDirection =>
  PRIMITIVE_DIRECTIONS.some((info) => info.direction === row.direction) ? row.direction : 'UNKNOWN';

function sumByName(rows: readonly PrimitiveCount[]): PrimitiveNatureEntry[] {
  const byName = new Map<string, PrimitiveNatureEntry>();
  for (const row of rows) {
    const known = byName.get(row.primitive);
    byName.set(row.primitive, {
      primitive: row.primitive,
      requests: (known?.requests ?? 0) + row.requests,
      responses: (known?.responses ?? 0) + row.responses,
      warnings: (known?.warnings ?? 0) + row.warnings,
    });
  }
  return [...byName.values()].sort(
    (a, b) => b.requests - a.requests || a.primitive.localeCompare(b.primitive),
  );
}

/** Totals per nature; `other` is listed only when it has requests, the two main natures always. */
export function primitiveNatureTotals(rows: readonly PrimitiveCount[]): PrimitiveNatureTotal[] {
  const whole = rows.reduce((sum, row) => sum + row.requests, 0);
  return PRIMITIVE_NATURES.map((info) => {
    const own = rows.filter((row) => primitiveNature(row.primitive) === info.nature);
    const primitives = sumByName(own);
    const directions = PRIMITIVE_DIRECTIONS.map((direction) => {
      const entries = sumByName(own.filter((row) => directionOf(row) === direction.direction));
      return {
        ...direction,
        requests: entries.reduce((sum, entry) => sum + entry.requests, 0),
        warnings: entries.reduce((sum, entry) => sum + entry.warnings, 0),
        primitives: entries,
      };
    }).filter((group) => group.primitives.length > 0);
    const requests = primitives.reduce((sum, entry) => sum + entry.requests, 0);
    return {
      ...info,
      requests,
      responses: primitives.reduce((sum, entry) => sum + entry.responses, 0),
      warnings: primitives.reduce((sum, entry) => sum + entry.warnings, 0),
      share: whole > 0 ? (requests / whole) * 100 : 0,
      primitives,
      directions,
    };
  }).filter((total) => total.nature !== 'other' || total.requests > 0);
}
