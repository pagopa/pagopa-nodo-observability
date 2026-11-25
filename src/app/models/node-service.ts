/** One Nodo microservice as reported by the cache version check. */
export interface NodeService {
  node: string;
  target: string;
  outcome: string;
  /** Original value reported by the service (e.g. `UP`); null when the check did not answer. */
  dbStatus: string | null;
  cacheId: string | null;
  version: string | null;
  environment: string | null;
  serviceIdentifier: string;
}

/** Api Config cache, the source of truth of the configuration loaded by the Nodo instances. */
export interface ConfigCache {
  /** Original outcome of the check (`OK`, `UNCONFIGURED`, `UNAVAILABLE`). */
  outcome: string;
  cacheId: string | null;
  version: string | null;
  /** Raw `X-CACHE-TIMESTAMP` value, possibly with a `[Zone]` suffix. */
  timestamp: string | null;
  environment: string | null;
  serviceIdentifier: string | null;
}

export interface NodeServicesCheck {
  checkedAt: string;
  nodes: NodeService[];
  /** Null when the response does not carry the cache block. */
  cache: ConfigCache | null;
}

const isRecord = (item: unknown): item is Record<string, unknown> =>
  typeof item === 'object' && item !== null;

const isOptionalString = (item: unknown): item is string | null | undefined =>
  item === null || item === undefined || typeof item === 'string';

function isNodeService(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['serviceIdentifier'] === 'string' &&
    value['serviceIdentifier'].trim().length > 0 &&
    ['node', 'target', 'outcome', 'dbStatus', 'cacheId', 'version', 'environment'].every((field) =>
      isOptionalString(value[field]),
    )
  );
}

const CACHE_FIELDS = ['outcome', 'cacheId', 'version', 'timestamp', 'environment', 'serviceIdentifier'];

const isConfigCache = (value: unknown): boolean =>
  value === null || value === undefined || (isRecord(value) && CACHE_FIELDS.every(field => isOptionalString(value[field])));

/** Validates the payload and fills absent optional fields with null. */
export function toNodeServicesCheck(value: unknown): NodeServicesCheck | null {
  if (
    !isRecord(value) ||
    typeof value['checkedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(value['checkedAt'])) ||
    !Array.isArray(value['nodes']) ||
    !value['nodes'].every(isNodeService) ||
    !isConfigCache(value['cache'])
  ) {
    return null;
  }
  const text = (item: unknown): string | null => (typeof item === 'string' ? item : null);
  const cache = value['cache'];
  return {
    checkedAt: value['checkedAt'],
    nodes: value['nodes'].filter(isRecord).map((node) => ({
      node: text(node['node']) ?? '',
      target: text(node['target']) ?? '',
      outcome: text(node['outcome']) ?? '',
      dbStatus: text(node['dbStatus']),
      cacheId: text(node['cacheId']),
      version: text(node['version']),
      environment: text(node['environment']),
      serviceIdentifier: String(node['serviceIdentifier']),
    })),
    cache: isRecord(cache)
      ? {
          outcome: text(cache['outcome']) ?? '',
          cacheId: text(cache['cacheId']),
          version: text(cache['version']),
          timestamp: text(cache['timestamp']),
          environment: text(cache['environment']),
          serviceIdentifier: text(cache['serviceIdentifier']),
        }
      : null,
  };
}

/** Check outcome meaning the data was read successfully. */
export const isOutcomeOk = (outcome: string): boolean => outcome === 'OK';

/**
 * Converts a Java `ZonedDateTime` string (e.g. `2026-11-24T09:53:25.633178+01:00[Europe/Rome]`) to an ISO
 * instant; null when it cannot be parsed.
 */
export function cacheTimestampInstant(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})(?:\[[^\]]+\])?$/.exec(value.trim());
  if (!match) return null;
  const millis = (match[2] ?? '').padEnd(3, '0').slice(0, 3);
  const parsed = Date.parse(`${match[1]}.${millis}${match[3]}`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Whether a node loaded the same configuration as the cache; null when they cannot be compared.
 */
export function cacheAlignment(node: NodeService, cache: ConfigCache | null): boolean | null {
  if (!cache || !isOutcomeOk(cache.outcome) || cache.cacheId === null || node.cacheId === null) return null;
  return node.cacheId === cache.cacheId;
}

/** Database status reported as healthy by the service. */
export const isDbUp = (status: string | null): boolean => status === 'UP';
