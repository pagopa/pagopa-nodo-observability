import { DOCUMENT, Location } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type {
  AccountInfo,
  AuthenticationResult,
  IPublicClientApplication,
} from '@azure/msal-browser';
import { Session } from '../../models/domain';
import { ENTRA_CONFIG, MSAL_LOADER, entraRedirectUri, isEntraConfigured } from './msal';

export interface SessionUser {
  readonly name: string;
  readonly username: string;
}

/** Refresh the ID token when it expires within this window. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/** Accepts only in-app absolute paths, so the post-login redirect cannot leave the console. */
export function safeCallbackUrl(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return null;
  return value.startsWith('/login') ? null : value;
}

/**
 * Single access point to the Azure Entra ID session (MSAL). The bearer sent to the backend is the
 * MSAL ID token (aud = client ID), always obtained through {@link acquireToken}.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly loadMsal = inject(MSAL_LOADER);
  private readonly config = inject(ENTRA_CONFIG);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  // MSAL returns a new AccountInfo object for every token: compare by content so that a silent renewal
  // does not look like an identity change to the views (which would reload and request a token again).
  private readonly account = signal<AccountInfo | null>(null, { equal: sameAccount });
  private readonly errorMessage = signal<string | null>(null);

  private msal: IPublicClientApplication | null = null;

  readonly configured = isEntraConfigured(this.config);
  readonly error = this.errorMessage.asReadonly();
  readonly user = computed<SessionUser | null>(() => {
    const account = this.account();
    return account
      ? { name: account.name?.trim() || account.username, username: account.username }
      : null;
  });
  readonly session = computed<Session | null>(() => {
    const account = this.account();
    return account
      ? { id: account.username || account.homeAccountId, authentication: 'ENTRA_ID' }
      : null;
  });
  /**
   * Identity key of the signed-in account ('' when signed out): views use it to restart streams and
   * discard in-flight lookups when the identity changes. It is not the bearer token.
   */
  readonly token = computed(() => this.account()?.homeAccountId ?? '');
  readonly isAuthenticated = computed(() => this.account() !== null);

  /** App initializer: completes a pending redirect and restores the cached account. */
  async initialize(): Promise<void> {
    try {
      this.msal ??= await this.loadMsal();
      if (!this.msal) return;
      await this.msal.initialize();
      const result = await this.msal.handleRedirectPromise({ navigateToLoginRequestUrl: false });
      const account =
        result?.account ?? this.msal.getActiveAccount() ?? this.msal.getAllAccounts()[0] ?? null;
      this.setAccount(account);
      const callbackUrl = safeCallbackUrl(result?.state);
      if (account && callbackUrl) this.location.replaceState(callbackUrl);
    } catch (error) {
      this.setAccount(null);
      this.errorMessage.set('Accesso con Microsoft non riuscito. Riprova.');
      console.error('Entra ID sign-in failed', describe(error));
    }
  }

  async login(callbackUrl?: string | null): Promise<void> {
    if (!this.msal) return;
    this.errorMessage.set(null);
    await this.msal.loginRedirect({
      scopes: [],
      prompt: 'select_account',
      redirectUri: this.redirectUri(),
      state: safeCallbackUrl(callbackUrl) ?? '/overview',
    });
  }

  async logout(): Promise<void> {
    const account = this.account();
    this.setAccount(null);
    if (!this.msal) return;
    await this.msal.logoutRedirect({ account, postLogoutRedirectUri: this.redirectUri() });
  }

  /** Returns a valid ID token, refreshing it silently; falls back to the interactive login. */
  async acquireToken(): Promise<string> {
    const account = this.account();
    if (!this.msal || !account) throw new Error('Entra ID session not available');
    const request = { scopes: [...this.config.scopes], account, redirectUri: this.redirectUri() };
    try {
      let result: AuthenticationResult = await this.msal.acquireTokenSilent(request);
      if (isExpiring(result))
        result = await this.msal.acquireTokenSilent({ ...request, forceRefresh: true });
      if (result.account) this.setAccount(result.account);
      return result.idToken;
    } catch (error) {
      if (requiresInteractiveLogin(error)) {
        void this.login(this.router.url).catch(() => this.handleUnauthorized());
      }
      throw error;
    }
  }

  /** Backend answered 401: drop the local session and go back to the login page. */
  async handleUnauthorized(): Promise<void> {
    const callbackUrl = safeCallbackUrl(this.router.url);
    const account = this.account();
    this.setAccount(null);
    if (this.msal && account) {
      await this.msal.clearCache({ account }).catch(() => undefined);
    }
    this.errorMessage.set('Sessione scaduta o non autorizzata. Accedi di nuovo.');
    await this.router.navigate(['/login'], { queryParams: callbackUrl ? { callbackUrl } : {} });
  }

  private setAccount(account: AccountInfo | null): void {
    this.msal?.setActiveAccount(account);
    this.account.set(account);
  }

  private redirectUri(): string {
    return entraRedirectUri(this.config, this.document.baseURI);
  }
}

function sameAccount(a: AccountInfo | null, b: AccountInfo | null): boolean {
  return a === b || (a !== null && b !== null
    && a.homeAccountId === b.homeAccountId && a.username === b.username && a.name === b.name);
}

function isExpiring(result: AuthenticationResult): boolean {
  const exp =
    result.idTokenClaims && 'exp' in result.idTokenClaims ? result.idTokenClaims.exp : undefined;
  return typeof exp === 'number' && exp * 1000 - Date.now() < EXPIRY_MARGIN_MS;
}

/**
 * Silent renewal cannot recover: Entra ID asks for interaction, or the hidden iframe never answered
 * (e.g. Entra ID showed an error page in it). Name checks instead of `instanceof` keep the MSAL
 * runtime out of the initial bundle.
 */
function requiresInteractiveLogin(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'InteractionRequiredAuthError') return true;
  return error.name === 'BrowserAuthError' && 'errorCode' in error && error.errorCode === 'timed_out';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
