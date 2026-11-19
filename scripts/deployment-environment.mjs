import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const generatedEnvironmentPath = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../src/environments/environment.deployment.generated.ts',
);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN = /^(?=.{4,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const SCOPE = /^[A-Za-z0-9._:/-]+$/;

/**
 * Validates the Azure Entra ID SPA settings (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, optional
 * ENTRA_REDIRECT_URI and comma/space separated ENTRA_SCOPES).
 */
export function createEntraConfig({ tenantId, clientId, redirectUri, scopes } = {}) {
  const tenant = typeof tenantId === 'string' ? tenantId.trim() : '';
  if (!tenant) {
    throw new Error('ENTRA_TENANT_ID is not set: provide it to the build environment.');
  }
  if (!GUID.test(tenant) && !TENANT_DOMAIN.test(tenant)) {
    throw new Error('ENTRA_TENANT_ID must be a tenant GUID or a verified domain.');
  }
  const client = typeof clientId === 'string' ? clientId.trim() : '';
  if (!client) {
    throw new Error('ENTRA_CLIENT_ID is not set: provide it to the build environment.');
  }
  if (!GUID.test(client)) {
    throw new Error('ENTRA_CLIENT_ID must be the application (client) GUID.');
  }
  const redirect = typeof redirectUri === 'string' ? redirectUri.trim() : '';
  if (redirect) {
    let url;
    try {
      url = new URL(redirect);
    } catch {
      throw new Error('ENTRA_REDIRECT_URI must be an absolute HTTPS URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[?#]/.test(redirect)) {
      throw new Error('ENTRA_REDIRECT_URI must be an absolute HTTPS URL without credentials, query or fragment.');
    }
  }
  const scopeList = typeof scopes === 'string' ? scopes.split(/[\s,]+/).filter(Boolean) : [];
  if (scopeList.some((scope) => !SCOPE.test(scope))) {
    throw new Error('ENTRA_SCOPES must be a comma or space separated list of scopes.');
  }
  return { tenantId: tenant, clientId: client.toLowerCase(), redirectUri: redirect, scopes: scopeList };
}

export function createDeploymentEnvironment(apiBaseUrl, entraSettings) {
  const entra = createEntraConfig(entraSettings);
  if (typeof apiBaseUrl !== 'string' || !apiBaseUrl.trim()) {
    throw new Error('API_BASE_URL must be a non-empty absolute HTTPS URL.');
  }

  let url;
  try {
    url = new URL(apiBaseUrl.trim());
  } catch {
    throw new Error('API_BASE_URL must be a non-empty absolute HTTPS URL.');
  }

  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error('API_BASE_URL must be a non-empty absolute HTTPS URL.');
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    apiBaseUrl.includes('?') ||
    apiBaseUrl.includes('#')
  ) {
    throw new Error('API_BASE_URL must not contain credentials, query parameters, or a fragment.');
  }

  const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;

  return `import { Environment } from './environment.model';

export const environment: Environment = {
  production: true,
  apiBaseUrl: ${JSON.stringify(baseUrl)},
  entra: {
    tenantId: ${JSON.stringify(entra.tenantId)},
    clientId: ${JSON.stringify(entra.clientId)},
    redirectUri: ${JSON.stringify(entra.redirectUri)},
    scopes: ${JSON.stringify(entra.scopes)},
  },
};
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const environment = createDeploymentEnvironment(process.env.API_BASE_URL, {
    tenantId: process.env.ENTRA_TENANT_ID,
    clientId: process.env.ENTRA_CLIENT_ID,
    redirectUri: process.env.ENTRA_REDIRECT_URI,
    scopes: process.env.ENTRA_SCOPES,
  });
  await writeFile(generatedEnvironmentPath, environment, 'utf8');
}
