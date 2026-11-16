/**
 * Forma dei parametri di backend esposti tramite environment.
 *
 * NOTA: i valori finiscono nel bundle del browser. Inserire solo parametri
 * NON sensibili (URL, flag). Nessun segreto o token.
 */
/**
 * Registrazione SPA di Azure Entra ID usata da MSAL (`@azure/msal-browser`).
 * Client ID e tenant ID sono identificativi pubblici, non segreti.
 */
export interface EntraIdConfig {
  /** Directory (tenant) ID: authority `https://login.microsoftonline.com/<tenantId>`. */
  readonly tenantId: string;
  /** Application (client) ID della registrazione SPA; è anche l'audience dell'ID token. */
  readonly clientId: string;
  /**
   * Redirect URI registrato come piattaforma "Single-page application".
   * Stringa vuota = URL base dell'app (`document.baseURI`, es. `https://<host>/ui/`).
   */
  readonly redirectUri: string;
  /** Scope aggiuntivi chiesti al login; MSAL aggiunge sempre `openid`, `profile`, `offline_access`. */
  readonly scopes: readonly string[];
}

export interface Environment {
  /** `true` nelle build di produzione, `false` in sviluppo. */
  readonly production: boolean;
  /**
   * Base URL del backend di osservabilità, usata come prefisso per tutte
   * le chiamate REST e per lo stream SSE degli eventi.
   *
   * - In produzione: origin assoluta del backend, es. `https://nodo-observability.pagopa.it`.
   * - In sviluppo: origin del worker locale (`http://localhost:8080`), con CORS
   *   abilitato lato backend; in alternativa stringa vuota + proxy same-origin
   *   (vedi `proxy.conf.cjs`).
   */
  readonly apiBaseUrl: string;
  /** Autenticazione Azure Entra ID (deploy: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_REDIRECT_URI`, `ENTRA_SCOPES`). */
  readonly entra: EntraIdConfig;
}
