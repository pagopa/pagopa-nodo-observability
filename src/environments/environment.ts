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
  // Placeholder: nelle build di deploy i valori arrivano da ENTRA_* (scripts/deployment-environment.mjs).
  entra: {
    tenantId: 'REPLACE_WITH_ENTRA_TENANT_ID',
    clientId: 'REPLACE_WITH_ENTRA_CLIENT_ID',
    redirectUri: '',
    scopes: [],
  },
};
