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
  apiBaseUrl: 'http://localhost:8080',
};
