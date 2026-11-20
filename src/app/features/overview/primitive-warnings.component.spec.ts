import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ObservabilityApi } from '../../core/api/observability-api.service';
import { TimezoneService } from '../../core/timezone.service';
import { Page, PrimitiveWarning } from '../../models/domain';
import { PrimitiveWarningsComponent } from './primitive-warnings.component';

const warning = (calledAt: string, extra: Partial<PrimitiveWarning> = {}): PrimitiveWarning => ({
  calledAt, psp: 'ABI00001', canale: 'CHANNEL_A', paFiscalCode: '00000000001', stazione: '00000000001_01', ...extra,
});
const page = (items: PrimitiveWarning[], nextCursor: string | null = null): Page<PrimitiveWarning> =>
  ({ items, nextCursor, snapshotRevision: 1 });

describe('PrimitiveWarningsComponent', () => {
  const primitiveWarnings = vi.fn<(filters: Record<string, string | null | undefined>) => Observable<Page<PrimitiveWarning>>>();
  const create = async (): Promise<ComponentFixture<PrimitiveWarningsComponent>> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PrimitiveWarningsComponent],
      providers: [
        { provide: ObservabilityApi, useValue: { primitiveWarnings } },
        { provide: TimezoneService, useValue: { zone: () => 'Europe/Rome' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PrimitiveWarningsComponent);
    fixture.componentRef.setInput('filters', { from: '2026-10-16T09:00:00.000Z', to: '2026-10-16T10:00:00.000Z', psp: 'ABI00001' });
    fixture.componentRef.setInput('serviceIdentifier', 'SERVICE_A');
    fixture.componentRef.setInput('primitive', 'pspNotifyPayment');
    fixture.componentRef.setInput('expected', 3);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  };
  const text = (fixture: ComponentFixture<PrimitiveWarningsComponent>): string =>
    (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
  const button = (fixture: ComponentFixture<PrimitiveWarningsComponent>, label: string): HTMLButtonElement | undefined =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(item => item.textContent?.includes(label));

  beforeEach(() => primitiveWarnings.mockReset());

  it('requests the first page with the overview filters, the service and the primitive', async () => {
    primitiveWarnings.mockReturnValue(of(page([warning('2026-10-16T09:30:15.000Z')])));
    const fixture = await create();
    expect(primitiveWarnings).toHaveBeenCalledWith({
      from: '2026-10-16T09:00:00.000Z', to: '2026-10-16T10:00:00.000Z', psp: 'ABI00001',
      serviceIdentifier: 'SERVICE_A', primitive: 'pspNotifyPayment', cursor: null,
    });
    expect(text(fixture)).toContain('Mostrate 1 di 3 chiamate senza risposta.');
    fixture.destroy();
  });

  it('words the summary for a single call', async () => {
    primitiveWarnings.mockReturnValue(of(page([warning('2026-10-16T09:30:15.000Z')])));
    const fixture = await create();
    fixture.componentRef.setInput('expected', 1);
    await fixture.whenStable();
    expect(text(fixture)).toContain('1 chiamata senza risposta.');
    fixture.destroy();
  });

  it('announces loading while the request is in flight', async () => {
    const pending = new Subject<Page<PrimitiveWarning>>();
    primitiveWarnings.mockReturnValue(pending);
    const fixture = await create();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent).toContain('Caricamento');
    pending.next(page([warning('2026-10-16T09:30:15.000Z')]));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')).toBeNull();
    fixture.destroy();
  });

  it('explains an empty list as expired or resolved data', async () => {
    primitiveWarnings.mockReturnValue(of(page([])));
    const fixture = await create();
    expect(text(fixture)).toContain('Nessun dettaglio disponibile');
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).toBeNull();
    fixture.destroy();
  });

  it('appends the next page on request and hides the control on the last page', async () => {
    primitiveWarnings
      .mockReturnValueOnce(of(page([warning('2026-10-16T09:30:15.000Z')], 'cursor-1')))
      .mockReturnValueOnce(of(page([warning('2026-10-16T09:10:00.000Z', { psp: 'ABI00002' })])));
    const fixture = await create();
    button(fixture, 'Mostra altre chiamate')?.click();
    await fixture.whenStable();
    expect(primitiveWarnings.mock.calls[1][0]).toMatchObject({ cursor: 'cursor-1' });
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(2);
    expect(button(fixture, 'Mostra altre chiamate')).toBeUndefined();
    fixture.destroy();
  });

  it('keeps the loaded rows on a failed page and retries the same cursor', async () => {
    primitiveWarnings
      .mockReturnValueOnce(of(page([warning('2026-10-16T09:30:15.000Z')], 'cursor-1')))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValueOnce(of(page([warning('2026-10-16T09:10:00.000Z')])));
    const fixture = await create();
    button(fixture, 'Mostra altre chiamate')?.click();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('Impossibile caricare');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(1);

    button(fixture, 'Riprova')?.click();
    await fixture.whenStable();
    expect(primitiveWarnings.mock.calls[2][0]).toMatchObject({ cursor: 'cursor-1' });
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(2);
    fixture.destroy();
  });

  it('restarts from the first page when the cursor has expired', async () => {
    primitiveWarnings
      .mockReturnValueOnce(of(page([warning('2026-10-16T09:30:15.000Z')], 'cursor-1')))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 410 })))
      .mockReturnValueOnce(of(page([warning('2026-10-16T09:31:00.000Z')])));
    const fixture = await create();
    button(fixture, 'Mostra altre chiamate')?.click();
    await fixture.whenStable();
    expect(text(fixture)).toContain('L’elenco è cambiato');
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).toBeNull();

    button(fixture, 'Riprova')?.click();
    await fixture.whenStable();
    expect(primitiveWarnings.mock.calls[2][0]).toMatchObject({ cursor: null });
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(1);
    fixture.destroy();
  });
});
