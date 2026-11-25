import { InjectionToken } from '@angular/core';
import type { IPublicClientApplication } from '@azure/msal-browser';
import { environment } from '../../../environments/environment';
import { EntraIdConfig } from '../../../environments/environment.model';

const PLACEHOLDER = /^REPLACE_WITH_/;

export function isEntraConfigured(config: EntraIdConfig): boolean {
  return [config.tenantId, config.clientId].every(
    (value) => value.trim() !== '' && !PLACEHOLDER.test(value),
  );
}

/** Redirect URI registered as "Single-page application": explicit value or the app base URL. */
export function entraRedirectUri(config: EntraIdConfig, baseUri: string): string {
  return config.redirectUri.trim() || new URL('.', baseUri).href;
}

export const ENTRA_CONFIG = new InjectionToken<EntraIdConfig>('ENTRA_CONFIG', {
  providedIn: 'root',
  factory: () => environment.entra,
});

export type MsalLoader = () => Promise<IPublicClientApplication | null>;

/**
 * Lazily loads MSAL (kept out of the initial bundle) and creates the instance; resolves to `null`
 * when tenant/client ID are still placeholders.
 */
export const MSAL_LOADER = new InjectionToken<MsalLoader>('MSAL_LOADER', {
  providedIn: 'root',
  factory: () => () => createMsalInstance(environment.entra, document.baseURI),
});

export async function createMsalInstance(
  config: EntraIdConfig,
  baseUri: string,
): Promise<IPublicClientApplication | null> {
  if (!isEntraConfigured(config)) return null;
  const { BrowserCacheLocation, LogLevel, PublicClientApplication } =
    await import('@azure/msal-browser');
  const redirectUri = entraRedirectUri(config, baseUri);
  return new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}`,
      redirectUri,
      postLogoutRedirectUri: redirectUri,
    },
    cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
    system: {
      loggerOptions: {
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
        loggerCallback: (level, message, containsPii) => {
          if (containsPii) return;
          if (level === LogLevel.Error) console.error(message);
          else if (level === LogLevel.Warning) console.warn(message);
        },
      },
    },
  });
}
