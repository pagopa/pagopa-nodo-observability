import { formatMaintenanceDuration, maintenanceStatusOf } from './maintenance';

describe('maintenance presentation', () => {
  const item = {
    brokerCode: 'B', brokerName: 'B', stations: [], creditorInstitutions: [],
    startDateTime: '2026-11-05T10:00:00.000Z', endDateTime: '2026-11-05T12:30:00.000Z',
  };

  it('derives the status from the current time', () => {
    expect(maintenanceStatusOf(item, Date.parse('2026-11-05T09:59:59.000Z'))).toBe('upcoming');
    expect(maintenanceStatusOf(item, Date.parse('2026-11-05T10:00:00.000Z'))).toBe('ongoing');
    expect(maintenanceStatusOf(item, Date.parse('2026-11-05T12:30:00.000Z'))).toBe('past');
  });

  it('formats the duration', () => {
    expect(formatMaintenanceDuration(item)).toBe('2 h 30 min');
    expect(formatMaintenanceDuration({ ...item, endDateTime: '2026-11-05T10:45:00.000Z' })).toBe('45 min');
    expect(formatMaintenanceDuration({ ...item, endDateTime: '2026-11-06T13:00:00.000Z' })).toBe('1 g 3 h');
  });
});
