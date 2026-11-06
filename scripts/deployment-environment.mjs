import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const generatedEnvironmentPath = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../src/environments/environment.deployment.generated.ts',
);

export function createDeploymentEnvironment(apiBaseUrl) {
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
};
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const environment = createDeploymentEnvironment(process.env.API_BASE_URL);
  await writeFile(generatedEnvironmentPath, environment, 'utf8');
}
