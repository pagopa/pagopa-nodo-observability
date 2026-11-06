import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('renders the shell navigation with a local demo session and no session request', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance.auth.session()).toEqual({
      id: 'demo-operator',
      authentication: 'LOCAL_DEMO_ONLY',
    });
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectNone((request) => request.url.endsWith('/api/me'));
    const content = fixture.nativeElement as HTMLElement;
    expect(content.textContent).toContain('Operatore autorizzato');
    expect(content.textContent).toContain('Dashboard');
    expect(content.textContent).toContain('Pagamenti');
    expect(content.textContent).toContain('Enti creditori');
    const logoLink = content.querySelector<HTMLAnchorElement>('a.logo');
    const logoImage = logoLink?.querySelector<HTMLImageElement>('img');
    expect(logoImage?.getAttribute('src')).toBe('/assets/payment-observability-logo.jpeg');
    expect(logoImage?.getAttribute('alt')).toBe('');
    expect(logoLink?.getAttribute('aria-label')).toBe('Osservabilità pagamenti, dashboard');
    expect(logoLink?.textContent?.trim()).toBe('');
    http.verify();
  });
});
