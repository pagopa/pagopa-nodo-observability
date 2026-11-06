import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { DbCheck } from '../../models/db-check';
import { AttemptDbCheckComponent } from './attempt-db-check.component';

const result: DbCheck = {
  attemptId: 'attempt-1',
  paFiscalCode: '00000000001',
  noticeNumber: '300000000000000001',
  serviceIdentifier: 'svc-1',
  projectionRevision: 4,
  source: 'NODO_ONLINE',
  checkedAt: '2026-10-23T10:00:00.000Z',
  observed: { logicalState: 'PAYING', attemptState: 'PAYMENT_UNKNOWN' },
  database: { logicalState: 'PAYING', attemptState: 'PAID' },
};

describe('AttemptDbCheckComponent', () => {
  const checkDb = vi.fn();

  function checkButton(host: HTMLElement): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Check DB per il tentativo "]',
    );
    if (!button) throw new Error('Pulsante Check DB non trovato.');
    return button;
  }

  function paragraphContaining(host: HTMLElement, text: string): HTMLParagraphElement | null {
    return (
      [...host.querySelectorAll('p')].find((paragraph) => paragraph.textContent?.includes(text)) ??
      null
    );
  }

  function expectOutputAfterActionGroup(host: HTMLElement, output: Element | null): void {
    const group = host.querySelector(
      '[role="group"][aria-label="Azioni diagnostiche del tentativo"]',
    );
    expect(group).not.toBeNull();
    expect(output).not.toBeNull();
    if (!group || !output) return;
    expect(group.contains(output)).toBe(false);
    expect(group.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }

  async function create() {
    TestBed.configureTestingModule({
      imports: [AttemptDbCheckComponent],
      providers: [{ provide: ObservabilityApi, useValue: { checkDb } }],
    });
    const fixture = TestBed.createComponent(AttemptDbCheckComponent);
    fixture.componentRef.setInput('attemptId', result.attemptId);
    fixture.componentRef.setInput('paFiscalCode', result.paFiscalCode);
    fixture.componentRef.setInput('noticeNumber', result.noticeNumber);
    fixture.componentRef.setInput('serviceIdentifier', result.serviceIdentifier);
    fixture.componentRef.setInput('projectionRevision', result.projectionRevision);
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => checkDb.mockReset());
  afterEach(() => TestBed.resetTestingModule());

  it('only checks on click and displays independent comparisons and the nodo-online provenance', async () => {
    checkDb.mockReturnValue(of(result));
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Check DB e consultazione RE del tentativo',
    );
    expect(checkDb).not.toHaveBeenCalled();
    checkButton(host).click();
    await fixture.whenStable();
    expect(checkDb).toHaveBeenCalledExactlyOnceWith('attempt-1');
    const resultOutput = host.querySelector('[aria-live="polite"]');
    expectOutputAfterActionGroup(host, resultOutput);
    expect(host.textContent).toContain('Sorgente: nodo-online');
    expect(host.textContent).not.toContain('Simulazione');
    const paymentRow = [...host.querySelectorAll('tbody tr')].find((row) =>
      row.querySelector('th[scope="row"]')?.textContent?.includes('Pagamento'),
    );
    const attemptRow = [...host.querySelectorAll('tbody tr')].find((row) =>
      row.querySelector('th[scope="row"]')?.textContent?.includes('Tentativo'),
    );
    expect(paymentRow?.textContent).toContain('Coincidente');
    expect(attemptRow?.textContent).toContain('Discordante');
    expect(attemptRow?.textContent).toContain('PAYMENT_UNKNOWN');
    expect(attemptRow?.textContent).toContain('PAID');
    expect(host.textContent).toContain('svc-1');
    expect(host.textContent).toContain('23 ott 2026');
  });

  it('does not interpret missing database records as a successful validation', async () => {
    checkDb.mockReturnValue(
      of({
        ...result,
        source: 'NODO_ONLINE',
        database: { logicalState: null, attemptState: null },
      }),
    );
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    checkButton(host).click();
    await fixture.whenStable();
    expect(host.textContent).not.toContain('Simulazione');
    expect(host.textContent).not.toContain('Coincidente');
    expect(host.textContent).toContain('Record non trovato');
    expect(host.textContent).toContain('Non verificabile');
  });

  it('prevents duplicate requests and marks results stale after live updates, including during a request', async () => {
    const pending = new Subject<DbCheck>();
    checkDb.mockReturnValue(pending);
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    checkButton(host).click();
    TestBed.tick();
    expect(checkButton(host).disabled).toBe(true);
    const loadingStatus = host.querySelector('[role="status"]');
    expect(loadingStatus?.textContent).toContain('Controllo in corso');
    expectOutputAfterActionGroup(host, loadingStatus);
    fixture.componentRef.setInput('projectionRevision', 5);
    TestBed.tick();
    pending.next(result);
    pending.complete();
    await fixture.whenStable();
    expect(host.textContent).toContain('da ripetere');
    expect(checkDb).toHaveBeenCalledTimes(1);
    checkDb.mockReturnValue(of({ ...result, projectionRevision: 5 }));
    checkButton(host).click();
    await fixture.whenStable();
    expect(host.textContent).not.toContain('da ripetere');
    fixture.componentRef.setInput('projectionRevision', 6);
    await fixture.whenStable();
    expect(host.textContent).toContain('da ripetere');
  });

  it('shows local errors and supports retry', async () => {
    checkDb.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    checkButton(host).click();
    await fixture.whenStable();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('non disponibile');
    expectOutputAfterActionGroup(host, alert);
    checkDb.mockReturnValue(of(result));
    checkButton(host).click();
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expectOutputAfterActionGroup(host, host.querySelector('[aria-live="polite"]'));
    expect(host.textContent).toContain('Coincidente');
  });

  it('disables checks with an explicit explanation when the service is missing', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('serviceIdentifier', null);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(checkButton(host).disabled).toBe(true);
    const missingService = paragraphContaining(host, 'serviceIdentifier non disponibile');
    expect(missingService?.textContent).toContain('serviceIdentifier non disponibile');
    expectOutputAfterActionGroup(host, missingService);
    expect(checkDb).not.toHaveBeenCalled();
  });

  it.each([
    ['attemptId', 'attempt-2'],
    ['paFiscalCode', '00000000002'],
    ['noticeNumber', '300000000000000002'],
    ['serviceIdentifier', 'svc-2'],
  ])('cancels and hides results when %s changes', async (input, value) => {
    const pending = new Subject<DbCheck>();
    checkDb.mockReturnValue(pending);
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    checkButton(host).click();
    TestBed.tick();
    expect(pending.observed).toBe(true);
    fixture.componentRef.setInput(input, value);
    TestBed.tick();
    expect(pending.observed).toBe(false);
    expect(host.querySelector('table')).toBeNull();
    expect(checkButton(host).disabled).toBe(false);
  });

  it('cancels a pending check when the attempt is removed from the view', async () => {
    const pending = new Subject<DbCheck>();
    checkDb.mockReturnValue(pending);
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    checkButton(host).click();
    TestBed.tick();
    expect(pending.observed).toBe(true);
    fixture.destroy();
    expect(pending.observed).toBe(false);
  });

  it.each([
    [0, 'non raggiungibile'],
    [401, 'non autorizza'],
    [403, 'non autorizza'],
    [404, 'retention'],
    [422, 'non configurato'],
    [500, 'HTTP 500'],
  ])('explains HTTP %s without presenting a comparison', async (status, message) => {
    checkDb.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    checkButton(host).click();
    await fixture.whenStable();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(message);
    expectOutputAfterActionGroup(host, alert);
    expect(host.querySelector('table')).toBeNull();
  });

  it('rejects a response belonging to a different service or payment', async () => {
    checkDb.mockReturnValue(of({ ...result, serviceIdentifier: 'other-service' }));
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    checkButton(host).click();
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('contesto');
    expect(host.querySelector('table')).toBeNull();
  });
});
