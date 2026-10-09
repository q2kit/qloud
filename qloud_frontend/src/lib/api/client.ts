import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './schema';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

export function getCookie(name: string): string | undefined {
  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

// Django reads the CSRF token from this header on unsafe methods.
export const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (
      SAFE_METHODS.has(request.method) ||
      request.headers.has('X-CSRFToken')
    ) {
      return request;
    }
    const token = getCookie('csrftoken');
    if (token) request.headers.set('X-CSRFToken', token);
    return request;
  },
};

/**
 * Typed API client generated from qloud_backend/openapi.yaml.
 * Regenerate types with `pnpm api:generate` after backend API changes.
 */
export const api = createClient<paths>({
  // FE and API share an origin (ADR-0006); an absolute base keeps Request() valid in tests.
  baseUrl: window.location.origin,
  credentials: 'include',
  // Look fetch up per call so test interceptors (MSW) installed later still apply.
  fetch: (request) => globalThis.fetch(request),
});
api.use(csrfMiddleware);
