import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { RE_FIELDS, ReEvent, ReEventsResponse } from '../../models/re-event';
import { AttemptReDetailComponent } from './attempt-re-detail.component';

describe('Attempt RE diagnostic dialog', () => {
  const window = { from: '2026-10-23T10:00:00.000Z', to: '2026-10-23T11:00:00.000Z' };
  let requests: Subject<ReEventsResponse>[];
  let api: { reEvents: ReturnType<typeof vi.fn> };
  let closed: Subject<void>;
  const response = (patch: Partial<ReEventsResponse> = {}): ReEventsResponse => ({
    attemptId: 'attempt-1',
    source: 'RE',
    retrievedAt: window.to,
    window,
    events: [],
    coverage: 'WINDOW_ONLY',
    nextCursor: null,
    truncated: false,
    warnings: [],
    ...patch,
  });
  const event = (patch: Partial<ReEvent> = {}): ReEvent =>
    ({
      ...Object.fromEntries(RE_FIELDS.map((field) => [field, null])),
      idDominio: '00000000001',
      noticeNumber: '300000000000000001',
      paymentToken: 'SYNTHETIC-TOKEN-1',
      payload: null,
      payloadDecoded: { status: 'ABSENT', text: null, reason: null },
      payloadOmitted: false,
      payloadSourceBytes: null,
      ...patch,
    }) as ReEvent;
  beforeEach(() => {
    requests = [];
    closed = new Subject<void>();
    api = {
      reEvents: vi.fn(() => {
        const request = new Subject<ReEventsResponse>();
        requests.push(request);
        return request;
      }),
    };
    TestBed.configureTestingModule({
      imports: [AttemptReDetailComponent],
      providers: [
        { provide: ObservabilityApi, useValue: api },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            attemptId: 'attempt-1',
            paFiscalCode: '00000000001',
            noticeNumber: '300000000000000001',
            paymentToken: 'SYNTHETIC-TOKEN-1',
            suggestedWindow: { ...window, segmented: false },
          },
        },
        { provide: MatDialogRef, useValue: { close: vi.fn(), beforeClosed: () => closed } },
      ],
    });
  });

  it('loads only on demand and shows UTC context, loading and empty coverage limitations', async () => {
    const fixture = TestBed.createComponent(AttemptReDetailComponent);
    await fixture.whenStable();
    expect(api.reEvents).not.toHaveBeenCalled();
    fixture.componentInstance.retrieve();
    TestBed.tick();
    expect(api.reEvents).toHaveBeenCalledWith('attempt-1', window);
    expect(fixture.nativeElement.textContent).toContain('Caricamento');
    requests[0].next(response());
    requests[0].complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('SYNTHETIC-TOKEN-1');
    expect(fixture.nativeElement.textContent).toContain('UTC');
    expect(fixture.nativeElement.textContent).toContain('Nessun evento');
    expect(fixture.nativeElement.textContent).toContain('non dimostra');
  });

  it('shows all original fields and renders hostile payload and Unicode only as text', async () => {
    const fixture = TestBed.createComponent(AttemptReDetailComponent);
    fixture.componentInstance.retrieve();
    TestBed.tick();
    const payload = '<script>window.executed=true</script><img src="https://invalid.example/a"> è';
    requests[0].next(
      response({
        events: [
          {
            ...Object.fromEntries(RE_FIELDS.map((field) => [field, null])),
            insertedTimestamp: '2026-10-23T10:00:00.1234567',
            idDominio: '00000000001',
            noticeNumber: '300000000000000001',
            paymentToken: 'SYNTHETIC-TOKEN-1',
            payload: 'c3ludGhldGlj',
            payloadDecoded: { status: 'DECODED', text: payload, reason: null },
            payloadOmitted: false,
            payloadSourceBytes: 12,
          } as ReEventsResponse['events'][number],
        ],
      }),
    );
    requests[0].complete();
    await fixture.whenStable();
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('pre')?.textContent).toBe(payload);
    expect(dom.querySelector('script,img')).toBeNull();
    expect(dom.querySelectorAll('[aria-label="Campi sorgente RE"] dt').length).toBe(33);
    expect(dom.textContent).toContain('2026-10-23T10:00:00.1234567');
    expect(dom.textContent).toContain('null');
  });

  it('cancels on edits and close, ignores late results and retries explicit errors', async () => {
    const fixture = TestBed.createComponent(AttemptReDetailComponent);
    fixture.componentInstance.retrieve();
    TestBed.tick();
    expect(requests[0].observed).toBe(true);
    fixture.componentInstance.changeFrom('2026-10-23T10:01:00');
    await fixture.whenStable();
    expect(requests[0].observed).toBe(false);
    requests[0].next(response());
    expect(fixture.componentInstance.result()).toBeNull();
    fixture.componentInstance.retrieve();
    TestBed.tick();
    requests[1].error(new HttpErrorResponse({ status: 503 }));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('configurata');
    fixture.componentInstance.retrieve();
    TestBed.tick();
    expect(requests[2].observed).toBe(true);
    closed.next();
    await fixture.whenStable();
    expect(requests[2].observed).toBe(false);
  });

  it('paginates only on demand using the original window and cancels a page when reloading', async () => {
    const fixture = TestBed.createComponent(AttemptReDetailComponent);
    fixture.componentInstance.retrieve();
    TestBed.tick();
    requests[0].next(response({ nextCursor: 'opaque' }));
    requests[0].complete();
    await fixture.whenStable();
    fixture.componentInstance.nextPage();
    TestBed.tick();
    expect(api.reEvents).toHaveBeenLastCalledWith('attempt-1', { ...window, cursor: 'opaque' });
    fixture.componentInstance.retrieve();
    TestBed.tick();
    expect(requests[1].observed).toBe(false);
    expect(api.reEvents).toHaveBeenLastCalledWith('attempt-1', window);
  });

  it('rejects invalid or more than 24 hour windows before making an HTTP request', async () => {
    const fixture = TestBed.createComponent(AttemptReDetailComponent);
    fixture.componentInstance.changeFrom('2026-10-20T00:00:00');
    fixture.componentInstance.retrieve();
    await fixture.whenStable();
    expect(api.reEvents).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('24 ore');
  });

  it('accepts exact-minute UTC ranges normalized by native date-time inputs', async () => {
    const fixture = TestBed.createComponent(AttemptReDetailComponent);
    await fixture.whenStable();
    const inputs: NodeListOf<HTMLInputElement> = fixture.nativeElement.querySelectorAll('input');
    inputs[0].value = '2026-10-23T10:00:00.000';
    inputs[1].value = '2026-10-23T11:00:00.000';
    inputs.forEach((input) => input.dispatchEvent(new Event('input')));
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    TestBed.tick();
    expect(api.reEvents).toHaveBeenCalledWith('attempt-1', window);
    requests[0]?.next(response());
    requests[0]?.complete();
    await fixture.whenStable();
  });

  it.each([
    ['ABSENT', 'Payload assente'],
    ['INVALID_BASE64', 'Base64 non valido'],
    ['INVALID_UTF8', 'UTF-8 non valido'],
    ['TOO_LARGE', 'Base64 sorgente omessi'],
  ] as const)(
    'explicitly explains payload status %s without fallback text',
    async (status, label) => {
      const fixture = TestBed.createComponent(AttemptReDetailComponent);
      fixture.componentInstance.retrieve();
      TestBed.tick();
      requests[0].next(
        response({
          events: [
            event({
              payloadDecoded: { status, text: null, reason: null },
              payloadOmitted: status === 'TOO_LARGE',
              payloadSourceBytes: status === 'TOO_LARGE' ? 400000 : null,
            }),
          ],
        }),
      );
      requests[0].complete();
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(label);
      expect(fixture.nativeElement.querySelector('pre')).toBeNull();
    },
  );

  it('rejects events for different keys instead of rendering another attempt', async () => {
    const fixture = TestBed.createComponent(AttemptReDetailComponent);
    fixture.componentInstance.retrieve();
    TestBed.tick();
    requests[0].next(response({ events: [event({ paymentToken: 'WRONG-TOKEN' })] }));
    requests[0].complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('contesto');
    expect(fixture.nativeElement.textContent).not.toContain('WRONG-TOKEN');
    expect(fixture.componentInstance.result()).toBeNull();
  });

  it('rejects changed page windows and repeated cursors', async () => {
    const fixture = TestBed.createComponent(AttemptReDetailComponent);
    fixture.componentInstance.retrieve();
    TestBed.tick();
    requests[0].next(response({ nextCursor: 'opaque' }));
    requests[0].complete();
    await fixture.whenStable();
    fixture.componentInstance.nextPage();
    TestBed.tick();
    requests[1].next(response({ nextCursor: 'opaque' }));
    requests[1].complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('pagina non validi');
  });
});
