import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MaintenanceComponent } from './maintenance.component';

const payload = (items: unknown[], stale = false) => ({
  fetchedAt: '2026-11-04T00:00:00.000Z', windowFrom: '2026-11-04T00:00:00.000Z',
  windowTo: '2026-11-11T00:00:00.000Z', stale, items,
});
const item = {
  brokerCode: 'B1', brokerName: 'Broker Uno', startDateTime: '2026-11-05T08:00:00.000Z',
  endDateTime: '2026-11-05T10:00:00.000Z', stations: ['B1_01'], creditorInstitutions: [],
};

describe('MaintenanceComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(MaintenanceComponent);
    fixture.detectChanges();
    const request = TestBed.inject(HttpTestingController).expectOne(r => new URL(r.url).pathname === '/api/apiconfig/maintenances');
    return { fixture, request, text: () => (fixture.nativeElement as HTMLElement).textContent ?? '' };
  }

  it('shows the loading state, then the maintenances', async () => {
    const { fixture, request, text } = setup();
    expect(text()).toContain('Caricamento delle manutenzioni programmate');
    request.flush(payload([item]));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Broker Uno');
    expect(text()).toContain('B1_01');
    expect(text()).toContain('Nessun ente impattato');
  });

  it('shows the empty state', async () => {
    const { fixture, request, text } = setup();
    request.flush(payload([]));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Nessuna manutenzione programmata');
  });

  it('warns when the data is stale', async () => {
    const { fixture, request, text } = setup();
    request.flush(payload([item], true));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('non è riuscito');
  });

  it('shows an error when the backend fails', async () => {
    const { fixture, request, text } = setup();
    request.flush({ code: 'MAINTENANCE_UNAVAILABLE' }, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Impossibile recuperare le manutenzioni programmate');
  });
});
