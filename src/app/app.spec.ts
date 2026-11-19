import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { version } from '../../package.json';
import { App } from './app';
import { SessionService } from './core/auth/session.service';
import { FakeMsal, provideFakeMsal, testAccount } from './core/auth/testing/fake-msal';

describe('App shell', () => {
  let fake: FakeMsal;

  beforeEach(async () => {
    fake = new FakeMsal();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideFakeMsal(fake)],
    }).compileComponents();
  });

  it('hides navigation and user controls when signed out', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const content = fixture.nativeElement as HTMLElement;
    expect(content.querySelector('nav[aria-label="Navigazione principale"]')).toBeNull();
    expect(content.textContent).not.toContain('Esci');
  });

  it('shows the package.json version in the footer', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer');
    expect(footer?.textContent).toContain(`Versione ${version}`);
  });

  it('renders the shell navigation with the Entra ID user and logs out', async () => {
    fake.accounts = [testAccount()];
    await TestBed.inject(SessionService).initialize();
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance.auth.session()).toEqual({
      id: 'mario.rossi@example.com',
      authentication: 'ENTRA_ID',
    });
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectNone((request) => request.url.endsWith('/api/me'));
    const content = fixture.nativeElement as HTMLElement;
    expect(content.textContent).toContain('Mario Rossi');
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
    const logout = Array.from(content.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Esci');
    logout?.click();
    await fixture.whenStable();
    expect(fake.logoutRequests).toHaveLength(1);
    expect(content.textContent).not.toContain('Mario Rossi');
  });
});
