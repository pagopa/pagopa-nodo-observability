import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TimezoneService } from '../../core/timezone.service';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { RE_FIELDS, ReEvent, ReEventsResponse, ReWindow } from '../../models/re-event';
import { AttemptReTraceComponent } from './attempt-re-trace.component';

const window: ReWindow = {
  from: '2026-11-02T09:43:31.172Z',
  to: '2026-11-02T10:13:31.770Z',
};

function event(patch: Partial<ReEvent> = {}): ReEvent {
  const fields = Object.fromEntries(RE_FIELDS.map((field) => [field, null])) as unknown as ReEvent;
  return {
    ...fields,
    payload: null,
    payloadDecoded: { status: 'ABSENT', text: null, reason: null },
    payloadOmitted: false,
    payloadSourceBytes: null,
    insertedTimestamp: '2026-11-02T09:58:31.727000Z',
    categoriaEvento: 'INTERFACCIA',
    sottoTipoEvento: 'RESP',
    tipoEvento: 'paSendRTV2',
    idDominio: '15376371009',
    noticeNumber: '302057861437229855',
    paymentToken: 'SYNTHETIC-TOKEN',
    esito: 'RICEVUTA',
    ...patch,
  };
}

function response(events: ReEvent[], patch: Partial<ReEventsResponse> = {}): ReEventsResponse {
  return {
    attemptId: 'att_0632811ee9e44285',
    source: 'RE',
    retrievedAt: '2026-11-02T10:00:00.000Z',
    window,
    coverage: 'WINDOW_ONLY',
    events,
    nextCursor: null,
    truncated: false,
    warnings: [],
    ...patch,
  };
}

describe('AttemptReTraceComponent', () => {
  const reEvents = vi.fn();

  beforeEach(() => {
    reEvents.mockReset();
    TestBed.configureTestingModule({
      imports: [AttemptReTraceComponent],
      providers: [
        { provide: ObservabilityApi, useValue: { reEvents } },
        { provide: TimezoneService, useValue: { zone: () => 'UTC' } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  async function create(token = 'SYNTHETIC-TOKEN', suggested: ReWindow | null = window) {
    const fixture = TestBed.createComponent(AttemptReTraceComponent);
    fixture.componentRef.setInput('attemptId', 'att_0632811ee9e44285');
    fixture.componentRef.setInput('paFiscalCode', '15376371009');
    fixture.componentRef.setInput('noticeNumber', '302057861437229855');
    fixture.componentRef.setInput('paymentToken', token);
    fixture.componentRef.setInput('suggestedWindow', suggested);
    await fixture.whenStable();
    return fixture;
  }

  it('loads every primitive of the attempt on its own, not only paSendRT', async () => {
    reEvents.mockReturnValue(
      of(
        response([
          event({ tipoEvento: 'activatePaymentNotice', sottoTipoEvento: 'REQ', sessionId: 's1' }),
          event({ tipoEvento: 'activatePaymentNotice', sottoTipoEvento: 'RESP', sessionId: 's1' }),
          event({
            tipoEvento: 'activatePaymentNotice',
            categoriaEvento: 'INTERNO',
            sottoTipoEvento: 'INTERN',
            status: 'payment_PAYING',
          }),
          event({ tipoEvento: 'sendPaymentOutcomeV2', sottoTipoEvento: 'REQ', sessionId: 's2' }),
          event({ tipoEvento: 'sendPaymentOutcomeV2', sottoTipoEvento: 'RESP', sessionId: 's2' }),
        ]),
      ),
    );
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;

    expect(reEvents).toHaveBeenCalledExactlyOnceWith('att_0632811ee9e44285', window);
    const table = host.querySelector('table');
    expect(table?.textContent).toContain('activatePaymentNotice');
    expect(table?.textContent).toContain('sendPaymentOutcomeV2');
    expect(table?.textContent).toContain('Richiesta');
    expect(table?.textContent).toContain('Risposta');
    expect(table?.textContent).toContain('Tentativo:');
    expect(table?.textContent).toContain('payment_PAYING');
    expect(host.textContent).toContain('Ultimo evento ricevuto');
    expect(host.textContent).not.toContain('senza risposta');
    fixture.destroy();
  });

  it('derives OK/KO from the decoded payload of each response', async () => {
    reEvents.mockReturnValue(
      of(
        response([
          event({
            tipoEvento: 'paGetPayment',
            sottoTipoEvento: 'RESP',
            sessionId: 's1',
            payloadDecoded: { status: 'DECODED', text: '<ok/>', reason: null },
          }),
          event({
            tipoEvento: 'activatePaymentNotice',
            sottoTipoEvento: 'RESP',
            sessionId: 's2',
            payloadDecoded: {
              status: 'DECODED',
              text: '<faultCode>PPT_ERRORE</faultCode>',
              reason: null,
            },
          }),
        ]),
      ),
    );
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('table')?.textContent).toContain('✓ OK');
    expect(host.querySelector('table')?.textContent).toContain('✗ KO');
    const alert = [...host.querySelectorAll('.note.warn')].find((item) =>
      item.textContent?.includes('Risposte KO'),
    );
    expect(alert?.textContent).toContain('activatePaymentNotice');
    expect(alert?.textContent).toContain('PPT_ERRORE');
    expect(alert?.textContent).not.toContain('paGetPayment');
    fixture.destroy();
  });

  it('shows a PA error text as a KO "risposta non SOAP" whose body is in a collapsed accordion, never as OK', async () => {
    const mocker = 'No valid mock resource is registered as: HTTP Method [post] - URL [/org/node-for-pa/]';
    reEvents.mockReturnValue(
      of(
        response([
          event({
            tipoEvento: 'paSendRTV2',
            sottoTipoEvento: 'RESP',
            sessionId: 's1',
            payloadDecoded: { status: 'DECODED', text: mocker, reason: null },
          }),
        ]),
      ),
    );
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    const table = host.querySelector('table')?.textContent;

    expect(table).toContain('✗ KO');
    expect(table).toContain('risposta non SOAP');
    expect(table).not.toContain('✓ OK');
    const details = host.querySelector<HTMLDetailsElement>('tbody details');
    expect(details?.querySelector('summary')?.textContent?.trim()).toBe('risposta non SOAP');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('pre')?.textContent).toBe(mocker);
    details?.querySelector('summary')?.click();
    expect(details?.open).toBe(true);
    const alert = [...host.querySelectorAll('.note.warn')].find((item) =>
      item.textContent?.includes('Risposte KO'),
    );
    expect(alert?.textContent).toContain('paSendRTV2');
    expect(alert?.textContent).toContain('risposta non SOAP');
    fixture.destroy();
  });

  it('groups repeated KO answers of the same primitive into a single entry with a count', async () => {
    const body = 'No valid mock resource is registered';
    reEvents.mockReturnValue(
      of(
        response(
          ['s1', 's2', 's3'].map((sessionId) =>
            event({
              tipoEvento: 'paSendRTV2',
              sottoTipoEvento: 'RESP',
              sessionId,
              payloadDecoded: { status: 'DECODED', text: body, reason: null },
            }),
          ),
        ),
      ),
    );
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    const alert = [...host.querySelectorAll('.note.warn')].find((item) =>
      item.textContent?.includes('Risposte KO'),
    );

    expect(alert?.querySelectorAll('code')).toHaveLength(1);
    expect(alert?.textContent).toContain('×3');
    expect(host.querySelectorAll('tbody tr.fault')).toHaveLength(3);
    fixture.destroy();
  });

  it('shows a closePayment answered with outcome KO as KO with its description, not as OK', async () => {
    reEvents.mockReturnValue(
      of(
        response([
          event({
            tipoEvento: 'closePayment-v2',
            sottoTipoEvento: 'RESP',
            sessionId: 's1',
            payloadDecoded: {
              status: 'DECODED',
              text: '{"outcome": "KO", "description": "Unacceptable outcome when token has expired"}',
              reason: null,
            },
          }),
        ]),
      ),
    );
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;
    const table = host.querySelector('table')?.textContent;

    expect(table).toContain('✗ KO');
    expect(table).toContain('Unacceptable outcome when token has expired');
    expect(table).not.toContain('✓ OK');
    expect(host.textContent).toContain('Risposte KO');
    fixture.destroy();
  });

  it('flags a request without a response, e.g. pspNotifyPayment that never got an answer', async () => {
    reEvents.mockReturnValue(
      of(
        response([
          event({ tipoEvento: 'closePayment', sottoTipoEvento: 'RESP', sessionId: 's1' }),
          event({ tipoEvento: 'closePayment', sottoTipoEvento: 'REQ', sessionId: 's1' }),
          event({ tipoEvento: 'pspNotifyPayment', sottoTipoEvento: 'REQ', sessionId: 's1' }),
        ]),
      ),
    );
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;

    const alert = host.querySelector('.note.warn[role="status"]');
    expect(alert?.textContent).toContain('Richieste senza risposta');
    expect(alert?.textContent).toContain('pspNotifyPayment');
    expect(alert?.textContent).not.toContain('closePayment');
    expect(host.querySelectorAll('.flag')).toHaveLength(1);
    expect(host.querySelector('.summary')?.textContent).toContain('pspNotifyPayment');
    fixture.destroy();
  });

  it('follows the cursor so no page of the consultation is left out', async () => {
    reEvents
      .mockReturnValueOnce(
        of(response([event({ tipoEvento: 'paGetPayment' })], { nextCursor: 'cursor-1' })),
      )
      .mockReturnValueOnce(of(response([event({ tipoEvento: 'paSendRT' })])));
    const fixture = await create();

    expect(reEvents).toHaveBeenCalledTimes(2);
    expect(reEvents).toHaveBeenLastCalledWith('att_0632811ee9e44285', { ...window, cursor: 'cursor-1' });
    const text = (fixture.nativeElement as HTMLElement).querySelector('table')?.textContent;
    expect(text).toContain('paGetPayment');
    expect(text).toContain('paSendRT');
    fixture.destroy();
  });

  it('sends only from and to to the strict API, dropping the UI-only fields of the suggested window', async () => {
    reEvents.mockReturnValue(of(response([])));
    const fixture = await create('SYNTHETIC-TOKEN', { ...window, segmented: true } as ReWindow);

    expect(reEvents).toHaveBeenCalledExactlyOnceWith('att_0632811ee9e44285', {
      from: window.from,
      to: window.to,
    });
    fixture.destroy();
  });

  it('does not claim the call never happened when the RE returns nothing', async () => {
    reEvents.mockReturnValue(of(response([])));
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.textContent).toContain('Nessun evento RE');
    expect(host.textContent).toContain('non dimostra');
    expect(host.querySelector('table')).toBeNull();
    fixture.destroy();
  });

  it('rejects RE rows whose PA, notice number or token does not match the attempt', async () => {
    reEvents.mockReturnValue(of(response([event({ paymentToken: 'OTHER-TOKEN' })])));
    const fixture = await create();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('contesto');
    expect(host.querySelector('table')).toBeNull();
    fixture.destroy();
  });

  it('does not query the RE without a usable token or window', async () => {
    const masked = await create('••••');
    expect(masked.nativeElement.textContent).toContain('Cronologia non caricabile');
    masked.destroy();
    const noWindow = await create('SYNTHETIC-TOKEN', null);
    expect(noWindow.nativeElement.textContent).toContain('Intervallo RE non proponibile');
    noWindow.destroy();
    expect(reEvents).not.toHaveBeenCalled();
  });

  it('refreshes on demand', async () => {
    reEvents.mockReturnValue(of(response([event({ tipoEvento: 'paGetPayment' })])));
    const fixture = await create();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button');
    button?.click();
    await fixture.whenStable();
    expect(reEvents).toHaveBeenCalledTimes(2);
    fixture.destroy();
  });
});
