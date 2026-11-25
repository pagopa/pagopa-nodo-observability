import { Provider } from '@angular/core';
import type {
  AccountInfo,
  AuthenticationResult,
  ClearCacheRequest,
  EndSessionRequest,
  IPublicClientApplication,
  RedirectRequest,
  SilentRequest,
} from '@azure/msal-browser';
import { EntraIdConfig } from '../../../../environments/environment.model';
import { ENTRA_CONFIG, MSAL_LOADER } from '../msal';

export const TEST_ENTRA_CONFIG: EntraIdConfig = {
  tenantId: '11111111-2222-3333-4444-555555555555',
  clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  redirectUri: 'http://localhost/',
  scopes: [],
};

export function testAccount(overrides: Partial<AccountInfo> = {}): AccountInfo {
  return {
    homeAccountId: 'home-1',
    environment: 'login.microsoftonline.com',
    tenantId: TEST_ENTRA_CONFIG.tenantId,
    username: 'mario.rossi@example.com',
    localAccountId: 'local-1',
    name: 'Mario Rossi',
    ...overrides,
  } as AccountInfo;
}

/** Minimal in-memory stand-in for the MSAL public client, recording the calls made by the app. */
export class FakeMsal {
  accounts: AccountInfo[] = [];
  active: AccountInfo | null = null;
  redirectResult: AuthenticationResult | null = null;
  redirectError: unknown = null;
  silentResults: (AuthenticationResult | Error)[] = [];
  readonly loginRequests: RedirectRequest[] = [];
  readonly logoutRequests: EndSessionRequest[] = [];
  readonly silentRequests: SilentRequest[] = [];
  readonly clearCacheRequests: ClearCacheRequest[] = [];

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  async handleRedirectPromise(): Promise<AuthenticationResult | null> {
    if (this.redirectError) throw this.redirectError;
    return this.redirectResult;
  }

  getAllAccounts(): AccountInfo[] {
    return this.accounts;
  }

  getActiveAccount(): AccountInfo | null {
    return this.active;
  }

  setActiveAccount(account: AccountInfo | null): void {
    this.active = account;
  }

  async loginRedirect(request?: RedirectRequest): Promise<void> {
    this.loginRequests.push(request ?? { scopes: [] });
  }

  async logoutRedirect(request?: EndSessionRequest): Promise<void> {
    this.logoutRequests.push(request ?? {});
  }

  async acquireTokenSilent(request: SilentRequest): Promise<AuthenticationResult> {
    this.silentRequests.push(request);
    const next = this.silentResults.shift();
    if (next instanceof Error) throw next;
    return next ?? tokenResult('id.token.value');
  }

  async clearCache(request?: ClearCacheRequest): Promise<void> {
    this.clearCacheRequests.push(request ?? {});
  }
}

export function tokenResult(
  idToken: string,
  expiresInSeconds = 3600,
  account = testAccount(),
): AuthenticationResult {
  return {
    idToken,
    account,
    idTokenClaims: { exp: Math.floor(Date.now() / 1000) + expiresInSeconds },
  } as AuthenticationResult;
}

export function provideFakeMsal(fake: FakeMsal | null = new FakeMsal()): Provider[] {
  return [
    {
      provide: MSAL_LOADER,
      useValue: () => Promise.resolve(fake as unknown as IPublicClientApplication | null),
    },
    {
      provide: ENTRA_CONFIG,
      useValue: fake
        ? TEST_ENTRA_CONFIG
        : { ...TEST_ENTRA_CONFIG, clientId: 'REPLACE_WITH_ENTRA_CLIENT_ID' },
    },
  ];
}
