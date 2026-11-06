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

export interface NodeServicesCheck {
  checkedAt: string;
  nodes: NodeService[];
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

/** Validates the payload and fills absent optional fields with null. */
export function toNodeServicesCheck(value: unknown): NodeServicesCheck | null {
  if (
    !isRecord(value) ||
    typeof value['checkedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(value['checkedAt'])) ||
    !Array.isArray(value['nodes']) ||
    !value['nodes'].every(isNodeService)
  ) {
    return null;
  }
  const text = (item: unknown): string | null => (typeof item === 'string' ? item : null);
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
  };
}

/** Database status reported as healthy by the service. */
export const isDbUp = (status: string | null): boolean => status === 'UP';
