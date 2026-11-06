import { ATTEMPT_STATES, AttemptState, LOGICAL_STATES, LogicalState } from './domain';

export interface DbCheck {
  attemptId: string;
  paFiscalCode: string;
  noticeNumber: string;
  serviceIdentifier: string;
  projectionRevision: number;
  source: 'NODO_ONLINE';
  checkedAt: string;
  observed: { logicalState: LogicalState; attemptState: AttemptState };
  database: { logicalState: LogicalState | null; attemptState: AttemptState | null };
}

export function isDbCheck(value: unknown): value is DbCheck {
  const record = (item: unknown): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null;
  if (!record(value) || !record(value['observed']) || !record(value['database'])) return false;
  const observed = value['observed'];
  const database = value['database'];
  return (
    ['attemptId', 'serviceIdentifier'].every(
      (field) => typeof value[field] === 'string' && value[field].trim().length > 0,
    ) &&
    typeof value['paFiscalCode'] === 'string' &&
    /^\d{11}$/.test(value['paFiscalCode']) &&
    typeof value['noticeNumber'] === 'string' &&
    /^\d{18}$/.test(value['noticeNumber']) &&
    typeof value['projectionRevision'] === 'number' &&
    Number.isSafeInteger(value['projectionRevision']) &&
    value['projectionRevision'] > 0 &&
    value['source'] === 'NODO_ONLINE' &&
    typeof value['checkedAt'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value['checkedAt']) &&
    Number.isFinite(Date.parse(value['checkedAt'])) &&
    new Date(value['checkedAt']).toISOString() === value['checkedAt'] &&
    LOGICAL_STATES.some((state) => state === observed['logicalState']) &&
    ATTEMPT_STATES.some((state) => state === observed['attemptState']) &&
    (database['logicalState'] === null ||
      LOGICAL_STATES.some((state) => state === database['logicalState'])) &&
    (database['attemptState'] === null ||
      ATTEMPT_STATES.some((state) => state === database['attemptState']))
  );
}
