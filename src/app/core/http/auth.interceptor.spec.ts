import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../auth/session.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  const session = { acquireToken: vi.fn(), handleUnauthorized: vi.fn() };

  beforeEach(() => {
    session.acquireToken.mockReset().mockResolvedValue('entra.id.token');
    session.handleUnauthorized.mockReset().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: session },
      ],
    });
  });

  it('sends the Entra ID token as bearer with a correlation id', async () => {
    const http = TestBed.inject(HttpTestingController);
    const result = firstValueFrom(TestBed.inject(HttpClient).get('/api/me'));
    const request = await vi.waitFor(() => http.expectOne('/api/me'));
    expect(request.request.headers.get('Authorization')).toBe('Bearer entra.id.token');
    expect(request.request.headers.get('X-Correlation-ID')).toBeTruthy();
    request.flush({});
    await expect(result).resolves.toEqual({});
    expect(session.handleUnauthorized).not.toHaveBeenCalled();
  });

  it('drops the session when the backend answers 401', async () => {
    const http = TestBed.inject(HttpTestingController);
    const result = firstValueFrom(TestBed.inject(HttpClient).get('/api/me'));
    const request = await vi.waitFor(() => http.expectOne('/api/me'));
    request.flush({ code: 'UNAUTHENTICATED' }, { status: 401, statusText: 'Unauthorized' });
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(session.handleUnauthorized).toHaveBeenCalledTimes(1);
  });
});
