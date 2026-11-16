import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { createMsalInstance, entraRedirectUri, isEntraConfigured } from './msal';
import { loginGuard, sessionGuard } from './session.guard';
import { SessionService, safeCallbackUrl } from './session.service';
import {
  FakeMsal,
  TEST_ENTRA_CONFIG,
  provideFakeMsal,
  testAccount,
  tokenResult,
} from './testing/fake-msal';

@Component({ template: 'page' })
class PageStub {}

@Component({ template: 'login' })
class LoginStub {}

function setup(fake: FakeMsal | null = new FakeMsal()) {
  TestBed.configureTestingModule({
    providers: [
      provideFakeMsal(fake),
      provideRouter([
        { path: 'login', component: LoginStub, canActivate: [loginGuard] },
        { path: 'overview', component: PageStub, canActivate: [sessionGuard] },
        { path: 'payments', component: PageStub, canActivate: [sessionGuard] },
      ]),
    ],
  });
  return { fake, session: TestBed.inject(SessionService) };
}

describe('Entra ID configuration', () => {
  it('treats placeholders as not configured and resolves the redirect URI from the base URL', async () => {
    expect(
      isEntraConfigured({ ...TEST_ENTRA_CONFIG, clientId: 'REPLACE_WITH_ENTRA_CLIENT_ID' }),
    ).toBe(false);
    expect(isEntraConfigured(TEST_ENTRA_CONFIG)).toBe(true);
    await expect(
      createMsalInstance(
        { ...TEST_ENTRA_CONFIG, tenantId: 'REPLACE_WITH_ENTRA_TENANT_ID' },
        'https://x.it/ui/',
      ),
    ).resolves.toBeNull();
    expect(
      entraRedirectUri({ ...TEST_ENTRA_CONFIG, redirectUri: '' }, 'https://x.it/ui/payments'),
    ).toBe('https://x.it/ui/');
    expect(entraRedirectUri(TEST_ENTRA_CONFIG, 'https://x.it/ui/')).toBe('http://localhost/');
  });

  it('accepts only in-app callback URLs', () => {
    expect(safeCallbackUrl('/payments?x=1')).toBe('/payments?x=1');
    for (const value of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/login?callbackUrl=/x',
    ]) {
      expect(safeCallbackUrl(value)).toBeNull();
    }
  });
});

describe('SessionService', () => {
  it('restores the cached account and exposes the user and session', async () => {
    const { fake, session } = setup();
    fake!.accounts = [testAccount()];

    await session.initialize();

    expect(session.isAuthenticated()).toBe(true);
    expect(session.user()).toEqual({ name: 'Mario Rossi', username: 'mario.rossi@example.com' });
    expect(session.session()).toEqual({
      id: 'mario.rossi@example.com',
      authentication: 'ENTRA_ID',
    });
    expect(fake!.active).toEqual(testAccount());
  });

  it('completes the login redirect and returns to the requested route', async () => {
    const { fake, session } = setup();
    fake!.redirectResult = { ...tokenResult('t'), state: '/payments?status=PAID' };
    const location = TestBed.inject(Location);

    await session.initialize();

    expect(session.isAuthenticated()).toBe(true);
    expect(location.path()).toBe('/payments?status=PAID');
  });

  it('ignores an unsafe redirect state and reports a failed redirect', async () => {
    const { fake, session } = setup();
    fake!.redirectResult = { ...tokenResult('t'), state: 'https://evil.example' };
    const location = TestBed.inject(Location);
    await session.initialize();
    expect(location.path()).toBe('');

    fake!.redirectError = new Error('boom');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await session.initialize();
    expect(session.isAuthenticated()).toBe(false);
    expect(session.error()).toContain('non riuscito');
  });

  it('starts the redirect login with a safe callback state', async () => {
    const { fake, session } = setup();
    await session.initialize();

    await session.login('/payments');
    await session.login('https://evil.example');

    expect(fake!.loginRequests.map((request) => request.state)).toEqual(['/payments', '/overview']);
    expect(fake!.loginRequests[0]).toMatchObject({
      prompt: 'select_account',
      redirectUri: 'http://localhost/',
    });
  });

  it('acquires the ID token silently and forces a refresh when it is about to expire', async () => {
    const { fake, session } = setup();
    fake!.accounts = [testAccount()];
    await session.initialize();
    fake!.silentResults = [tokenResult('old', 60), tokenResult('fresh')];

    await expect(session.acquireToken()).resolves.toBe('fresh');
    expect(fake!.silentRequests.map((request) => request.forceRefresh)).toEqual([undefined, true]);
    expect(fake!.silentRequests[0].account).toEqual(testAccount());
  });

  it('falls back to the interactive login when silent acquisition requires interaction', async () => {
    const { fake, session } = setup();
    fake!.accounts = [testAccount()];
    await session.initialize();
    fake!.silentResults = [new InteractionRequiredAuthError('login_required', 'test-correlation')];

    await expect(session.acquireToken()).rejects.toBeInstanceOf(InteractionRequiredAuthError);
    expect(fake!.loginRequests).toHaveLength(1);
  });

  it('refuses tokens without a session or configuration', async () => {
    await expect(setup().session.acquireToken()).rejects.toThrow();
    TestBed.resetTestingModule();
    const { session } = setup(null);
    expect(session.configured).toBe(false);
    await session.initialize();
    await expect(session.acquireToken()).rejects.toThrow();
  });

  it('drops the session on 401 and returns to the login page with the current route', async () => {
    const { fake, session } = setup();
    fake!.accounts = [testAccount()];
    await session.initialize();
    const harness = await RouterTestingHarness.create('/payments?status=PAID');

    await session.handleUnauthorized();
    await harness.fixture.whenStable();

    expect(session.isAuthenticated()).toBe(false);
    expect(fake!.clearCacheRequests).toHaveLength(1);
    expect(TestBed.inject(Router).url).toBe('/login?callbackUrl=%2Fpayments%3Fstatus%3DPAID');
    expect(session.error()).toContain('Sessione scaduta');
  });

  it('logs out through Entra ID', async () => {
    const { fake, session } = setup();
    fake!.accounts = [testAccount()];
    await session.initialize();

    await session.logout();

    expect(session.isAuthenticated()).toBe(false);
    expect(fake!.logoutRequests).toEqual([
      { account: testAccount(), postLogoutRedirectUri: 'http://localhost/' },
    ]);
  });
});

describe('session guards', () => {
  it('redirects anonymous users to /login keeping the requested route', async () => {
    setup();
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/payments?status=PAID');

    expect(TestBed.inject(Router).url).toBe('/login?callbackUrl=%2Fpayments%3Fstatus%3DPAID');
  });

  it('lets authenticated users through and keeps them away from /login', async () => {
    const { fake, session } = setup();
    fake!.accounts = [testAccount()];
    await session.initialize();
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/payments');
    expect(TestBed.inject(Router).url).toBe('/payments');
    await harness.navigateByUrl('/login?callbackUrl=%2Foverview');
    expect(TestBed.inject(Router).url).toBe('/overview');
  });
});
