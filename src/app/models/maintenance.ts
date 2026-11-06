export interface MaintenanceCreditor {
  businessName: string;
  code: string;
}

/** One scheduled maintenance window of the stations of a broker. */
export interface Maintenance {
  brokerCode: string;
  brokerName: string;
  startDateTime: string;
  endDateTime: string;
  stations: string[];
  creditorInstitutions: MaintenanceCreditor[];
}

export interface Maintenances {
  /** Last successful load from the configuration service. */
  fetchedAt: string;
  windowFrom: string;
  windowTo: string;
  /** True when the last daily refresh failed and the previous data is shown. */
  stale: boolean;
  items: Maintenance[];
}

const isRecord = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null;
const isInstant = (item: unknown): item is string => typeof item === 'string' && Number.isFinite(Date.parse(item));
const isStrings = (item: unknown): boolean => Array.isArray(item) && item.every((entry) => typeof entry === 'string');

const isCreditor = (item: unknown): boolean =>
  isRecord(item) && typeof item['businessName'] === 'string' && typeof item['code'] === 'string';

const isMaintenance = (item: unknown): boolean =>
  isRecord(item) &&
  typeof item['brokerCode'] === 'string' &&
  typeof item['brokerName'] === 'string' &&
  isInstant(item['startDateTime']) &&
  isInstant(item['endDateTime']) &&
  isStrings(item['stations']) &&
  Array.isArray(item['creditorInstitutions']) &&
  item['creditorInstitutions'].every(isCreditor);

export function isMaintenances(value: unknown): value is Maintenances {
  return (
    isRecord(value) &&
    isInstant(value['fetchedAt']) &&
    isInstant(value['windowFrom']) &&
    isInstant(value['windowTo']) &&
    typeof value['stale'] === 'boolean' &&
    Array.isArray(value['items']) &&
    value['items'].every(isMaintenance)
  );
}

export type MaintenanceStatus = 'ongoing' | 'upcoming' | 'past';

export const maintenanceStatusOf = (item: Maintenance, nowMs: number): MaintenanceStatus =>
  nowMs < Date.parse(item.startDateTime) ? 'upcoming' : nowMs < Date.parse(item.endDateTime) ? 'ongoing' : 'past';

/** Compact Italian duration, e.g. `2 h 30 min` or `1 g 3 h`. */
export function formatMaintenanceDuration(item: Pick<Maintenance, 'startDateTime' | 'endDateTime'>): string {
  const minutes = Math.max(0, Math.round((Date.parse(item.endDateTime) - Date.parse(item.startDateTime)) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} g ${hours} h` : `${days} g`;
  if (hours > 0) return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
  return `${rest} min`;
}
