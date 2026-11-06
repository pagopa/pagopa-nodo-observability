import { Environment } from './environment.model';

/**
 * Environment di default (produzione).
 *
 * `environment.development.ts` sovrascrive questi valori in `ng serve`
 * tramite il `fileReplacements` definito in `angular.json`.
 */
export const environment: Environment = {
  production: true,
  apiBaseUrl: '',
};
