import { Environment } from './environment.model';

/**
 * Environment di sviluppo (`ng serve`, FE sulla porta 4201).
 *
 * `apiBaseUrl` punta direttamente al worker locale su `http://localhost:8080`.
 * Il backend abilita CORS per l'origine `http://localhost:4201` (profilo `%dev`),
 * quindi le chiamate REST e lo stream SSE raggiungono il worker senza proxy.
 * In alternativa si può usare `apiBaseUrl: ''` + proxy same-origin
 * (vedi `proxy.conf.cjs`, target `http://127.0.0.1:8080`).
 */
export const environment: Environment = {
  production: false,
  // apiBaseUrl: 'http://localhost:8080',
  apiBaseUrl: 'https://api.dev.platform.pagopa.it/nodo/observability/v1',
  // Placeholder: impostare tenant e client ID della registrazione SPA (redirect URI http://localhost:4201/).
  entra: {
    tenantId: '7788edaf-0346-4068-9d79-c868aed15b3d',
    clientId: '37cf8cca-a086-4828-a115-26367dd4c00f',
    redirectUri: 'http://localhost:4201/',
    // Only the ID token (aud = client ID) is used: no custom API scope is needed.
    scopes: [],
  },
};
