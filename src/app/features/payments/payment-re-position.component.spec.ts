import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { RE_FIELDS, ReEvent, ReEventsResponse, ReWindow } from '../../models/re-event';
import { PaymentRePositionComponent } from './payment-re-position.component';

const window: ReWindow = { from: '2026-11-02T08:58:31.172Z', to: '2026-11-02T11:00:00.000Z' };

function event(patch: Partial<ReEvent> = {}): ReEvent {
  const fields = Object.fromEntries(RE_FIELDS.map((field) => [field, null])) as unknown as ReEvent;
  return {
    ...fields,
    payload: null,
    payloadDecoded: { status: 'ABSENT', text: null, reason: null },
    payloadOmitted: false,
    payloadSourceBytes: null,
    insertedTimestamp: '2026-11-02T09:50:00.000000Z',
    categoriaEvento: 'INTERFACCIA',
    sottoTipoEvento: 'REQ',
    tipoEvento: 'verifyPaymentNotice',
    idDominio: '15376371009',
    noticeNumber: '302057861437229855',
    ...patch,
  };
}

function response(events: ReEvent[], patch: Partial<ReEventsResponse> = {}): ReEventsResponse {
  return {
    attemptId: 'att_1',
    source: 'RE',
    retrievedAt: '2026-11-02T10:00:00.000Z',
    window,
    coverage: 'WINDOW_ONLY',
    events,
    nextCursor: null,
    truncated: false,
    warnings: ['POSITION_SCOPE'],
    ...patch,
  };
}

describe('PaymentRePositionComponent', () => {
  const reEvents = vi.fn();

  beforeEach(() => {
    reEvents.mockReset();
    TestBed.configureTestingModule({
      imports: [PaymentRePositionComponent],
      providers: [
        { provide: ObservabilityApi, useValue: { reEvents } },
        { provide: TimezoneService, useValue: { zone: () => 'UTC' } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  async function create(win: ReWindow | null = window) {
    const fixture = TestBed.createComponent(PaymentRePositionComponent);
    fixture.componentRef.setInput('paFiscalCode', '15376371009');
    fixture.componentRef.setInput('noticeNumber', '302057861437229855');
    fixture.componentRef.setInput('attemptId', 'att_1');
    fixture.componentRef.setInput('window', win);
    await fixture.whenStable();
    return fixture;
  }

  const click = async (fixture: Awaited<ReturnType<typeof create>>) => {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')?.click();
    await fixture.whenStable();
  };

  it('does not query the RE until the operator asks for it', async () => {
    const fixture = await create();
    expect(reEvents).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Consulta RE');
    fixture.destroy();
  });

  it('asks for the whole position and shows token-less calls such as verifyPaymentNotice', async () => {
    reEvents.mockReturnValue(
      of(
        response([
          event(),
          event({ sottoTipoEvento: 'RESP', payloadDecoded: { status: 'DECODED', text: '<ok/>', reason: null } }),
          event({ tipoEvento: 'activatePaymentNotice', paymentToken: 'TOKEN-1' }),
        ]),
      ),
    );
    const fixture = await create();
    await click(fixture);
    const host: HTMLElement = fixture.nativeElement;

    expect(reEvents).toHaveBeenCalledExactlyOnceWith('att_1', { ...window, scope: 'POSITION' });
    const table = host.querySelector('table');
    expect(table?.textContent).toContain('verifyPaymentNotice');
    expect(table?.textContent).toContain('senza token');
    expect(table?.textContent).toContain('TOKEN-1');
    expect(table?.textContent).toContain('✓ OK');
    expect(host.querySelector('.summary')?.textContent).toContain('2 senza');
    fixture.destroy();
  });

  it('shows the KO outcome and fault code of a response', async () => {
    reEvents.mockReturnValue(
      of(
        response([
          event({
            sottoTipoEvento: 'RESP',
            payloadDecoded: {
              status: 'DECODED',
              text: '<fault><faultCode>PPT_PAGAMENTO_IN_CORSO</faultCode></fault>',
              reason: null,
            },
          }),
        ]),
      ),
    );
    const fixture = await create();
    await click(fixture);
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('table')?.textContent).toContain('✗ KO');
    expect(host.textContent).toContain('PPT_PAGAMENTO_IN_CORSO');
    expect(host.textContent).toContain('Risposte KO');
    fixture.destroy();
  });

  it('rejects rows of a different position', async () => {
    reEvents.mockReturnValue(of(response([event({ noticeNumber: '399999999999999999' })])));
    const fixture = await create();
    await click(fixture);
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('posizione diversa');
    expect(host.querySelector('table')).toBeNull();
    fixture.destroy();
  });

  it('does not claim absence when the RE returns nothing, and is not retriggered by a moving window', async () => {
    reEvents.mockReturnValue(of(response([])));
    const fixture = await create();
    await click(fixture);
    fixture.componentRef.setInput('window', { ...window, to: '2026-11-02T11:05:00.000Z' });
    await fixture.whenStable();

    expect(reEvents).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('non dimostra');
    fixture.destroy();
  });

  it('cannot be consulted without a usable window', async () => {
    const fixture = await create(null);
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button');
    expect(button?.disabled).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Intervallo non proponibile');
    fixture.destroy();
  });
});
