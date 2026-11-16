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
    clientId: 'b1081b7e-7c1e-4342-8c09-34c2cbcac224',
    redirectUri: 'http://localhost:3000',
    // scopes: ['api://pagopa-d-nodo-observability-ui/user_impersonation'],
    scopes: ['api://pagopa-d-shared-toolbox/user_impersonation'],
  },
};
