import { environment } from '../../../../environments/environment';

/** Expected request pathname for an API path, including any prefix configured in `apiBaseUrl`. */
export function apiPath(path: string): string {
  const basePath = new URL(environment.apiBaseUrl || '/', location.origin).pathname.replace(
    /\/+$/,
    '',
  );
  return `${basePath}${path}`;
}
