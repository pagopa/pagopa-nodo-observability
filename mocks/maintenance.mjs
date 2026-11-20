// Scheduled station maintenances: read from the apiconfig service once a day at local midnight and kept in memory.
const DAY = 86_400_000;
export const MAINTENANCE_WINDOW_DAYS = 7;
export const DEFAULT_MAINTENANCE_URL =
  'https://api.dev.platform.pagopa.it/apiconfig/auth/api/v1/brokers/station-maintenances/aggregates';

const iso = ms => new Date(ms).toISOString();

/** Next local midnight strictly after `ms`. */
export function nextMidnight(ms) {
  const next = new Date(ms);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

/** Maps the upstream snake_case payload to the API shape; throws when the payload is not usable. */
export function toMaintenances(payload) {
  const list = payload?.station_maintenance_list;
  if (!Array.isArray(list)) throw new Error('Invalid station_maintenance_list');
  const text = value => { if (typeof value !== 'string') throw new Error('Invalid maintenance field'); return value; };
  return list.map(item => ({
    brokerCode: text(item.broker_code),
    brokerName: text(item.broker_name),
    startDateTime: iso(Date.parse(text(item.start_date_time))),
    endDateTime: iso(Date.parse(text(item.end_date_time))),
    stations: (item.stations ?? []).map(text),
    creditorInstitutions: (item.creditor_institutions ?? []).map(entity => ({
      businessName: text(entity.business_name), code: text(entity.creditor_institution_code),
    })),
  })).sort((a, b) => a.startDateTime.localeCompare(b.startDateTime) || a.brokerCode.localeCompare(b.brokerCode));
}

/** Real fetcher: asks the apiconfig service for the maintenances starting in [from, to]. */
export function httpMaintenanceFetcher({ url = DEFAULT_MAINTENANCE_URL, apiKey, fetchImpl = fetch } = {}) {
  return async ({ from, to }) => {
    const target = new URL(url);
    target.searchParams.set('startDateTimeAfter', from);
    target.searchParams.set('endDateTimeBefore', to);
    const response = await fetchImpl(target, {
      headers: { Accept: 'application/json', ...(apiKey ? { 'Ocp-Apim-Subscription-Key': apiKey } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Maintenance service answered HTTP ${response.status}`);
    return response.json();
  };
}

/** Synthetic fetcher used when no upstream is configured (tests, local demo). */
export function syntheticMaintenanceFetcher() {
  return async ({ from }) => {
    const start = Date.parse(from) + 2 * DAY;
    const at = (offset, hours) => new Date(start + offset * DAY + hours * 3_600_000).toISOString();
    return { station_maintenance_list: [
      { broker_code: '99999000013', broker_name: 'EC DEMO DIRECT', start_date_time: at(0, 3), end_date_time: at(0, 5),
        stations: ['99999000013_01'], creditor_institutions: [
          { business_name: 'EC DEMO DIRECT', creditor_institution_code: '99999000013' }] },
      { broker_code: '00264560608', broker_name: 'Comune di Frosinone', start_date_time: at(1, 20), end_date_time: at(2, 2),
        stations: ['00264560608_02', '00264560608_03'], creditor_institutions: [] },
    ], page_info: { page: 0, items_found: 2, total_pages: 1, total_items: 2 } };
  };
}

/**
 * Cache of the next-7-days maintenances. `start()` loads once and then reloads every midnight; a failed
 * reload keeps the previous data (reported as stale) so the console keeps working.
 */
export function createMaintenanceCache({ fetcher, now = Date.now, schedule = true } = {}) {
  let state = null; // { fetchedAt, windowFrom, windowTo, items }
  let lastError = null;
  let timer = null;
  let inflight = null;

  const refresh = () => inflight ??= (async () => {
    const at = now();
    const window = { from: iso(at), to: iso(at + MAINTENANCE_WINDOW_DAYS * DAY) };
    try {
      const items = toMaintenances(await fetcher(window));
      state = { fetchedAt: iso(at), windowFrom: window.from, windowTo: window.to, items };
      lastError = null;
    } catch (error) {
      lastError = error;
    } finally { inflight = null; }
    return state;
  })();

  const arm = () => {
    timer = setTimeout(async () => { await refresh(); arm(); }, Math.max(1000, nextMidnight(now()) - now()));
    timer.unref();
  };

  return {
    refresh,
    start() { const loaded = refresh(); if (schedule) arm(); return loaded; },
    stop() { clearTimeout(timer); },
    /** Cached snapshot (loading it on first use if the startup load has not finished). */
    async get() {
      if (!state) await refresh();
      return state && { ...state, stale: lastError !== null };
    },
  };
}
