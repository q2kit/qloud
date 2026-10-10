import { getCookie } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { i18n } from '@/lib/i18n';

/**
 * Client for the allauth headless API (qloud_docs/api.md › Auth).
 *
 * These endpoints are served by allauth, not DRF, so they are absent from
 * openapi.yaml and use allauth's own envelope (`{status, data, meta}` /
 * `{status, errors}`); this module is the one place that talks to them.
 */
export const AUTH_BASE = '/api/auth/browser/v1';

export interface AuthUser {
  id: string;
  display: string;
  email: string;
  has_usable_password: boolean;
}

export interface AuthFlow {
  id: string;
  is_pending?: boolean;
  provider?: { id: string; name: string };
}

export interface AuthSession {
  user: AuthUser | null;
  /** Flows allauth offers next, e.g. a pending `provider_signup` after OAuth. */
  flows: AuthFlow[];
}

export interface AuthProvider {
  id: string;
  name: string;
}

export interface AuthFieldError {
  code: string;
  message: string;
  param?: string;
}

interface AllauthBody {
  status?: number;
  data?: {
    user?: AuthUser;
    flows?: AuthFlow[];
    socialaccount?: { providers?: AuthProvider[] };
  };
  meta?: { is_authenticated?: boolean };
  errors?: AuthFieldError[];
}

/** An auth request failed; `errors` keeps allauth's per-field details. */
export class AuthApiError extends ApiError {
  readonly errors: AuthFieldError[];

  constructor(status: number, errors: AuthFieldError[]) {
    const [first] = errors;
    super(status, {
      error: {
        code: first?.code ?? (status === 429 ? 'rate_limited' : 'error'),
        message:
          first?.message ?? `Request failed with status ${String(status)}`,
        details: {},
      },
    });
    this.name = 'AuthApiError';
    this.errors = errors;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

async function ensureCsrfCookie(): Promise<void> {
  // Django sets the cookie on any allauth GET; the SPA may not have made one yet.
  if (!getCookie('csrftoken')) await request('GET', '/config');
}

async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: AllauthBody }> {
  const headers = new Headers({
    Accept: 'application/json',
    // Server messages (e.g. password rules) and new accounts follow the UI language.
    'Accept-Language': i18n.resolvedLanguage ?? 'vi',
  });
  if (!SAFE_METHODS.has(method)) {
    const token = getCookie('csrftoken');
    if (token) headers.set('X-CSRFToken', token);
  }
  if (body) headers.set('Content-Type', 'application/json');
  const response = await globalThis.fetch(
    new Request(new URL(`${AUTH_BASE}${path}`, window.location.origin), {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as AllauthBody) : {},
  };
}

async function mutate(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  /** Statuses that mean the action succeeded although no one is signed in. */
  alsoOk: number[] = [],
): Promise<AllauthBody> {
  await ensureCsrfCookie();
  const result = await request(method, path, body);
  if (result.status === 200 || alsoOk.includes(result.status)) {
    return result.body;
  }
  throw new AuthApiError(result.status, result.body.errors ?? []);
}

function toSession(body: AllauthBody): AuthSession {
  const user = body.meta?.is_authenticated ? body.data?.user : undefined;
  return { user: user ?? null, flows: body.data?.flows ?? [] };
}

export async function fetchSession(): Promise<AuthSession> {
  const result = await request('GET', '/auth/session');
  // 401: signed out (with the flows on offer); 410: the session just expired.
  if (result.status === 200 || result.status === 401 || result.status === 410) {
    return toSession(result.body);
  }
  throw new AuthApiError(result.status, result.body.errors ?? []);
}

export async function fetchProviders(): Promise<AuthProvider[]> {
  const result = await request('GET', '/config');
  if (result.status !== 200) {
    throw new AuthApiError(result.status, result.body.errors ?? []);
  }
  return result.body.data?.socialaccount?.providers ?? [];
}

export interface LoginInput {
  email: string;
  password: string;
  remember: boolean;
}

export async function login(input: LoginInput): Promise<AuthSession> {
  const body = await mutate('POST', '/auth/login', { ...input });
  return toSession(body);
}

export interface SignupInput {
  email: string;
  password: string;
  turnstileToken: string;
}

export async function signup({
  email,
  password,
  turnstileToken,
}: SignupInput): Promise<AuthSession> {
  const body = await mutate('POST', '/auth/signup', {
    email,
    password,
    turnstile_token: turnstileToken,
  });
  return toSession(body);
}

export async function logout(): Promise<void> {
  // allauth answers a successful logout with 401 (no one is signed in any more).
  await mutate('DELETE', '/auth/session', undefined, [401]);
}

export async function verifyEmail(key: string): Promise<void> {
  // 401: verified, but verifying does not sign the visitor in.
  await mutate('POST', '/auth/email/verify', { key }, [401]);
}

export async function requestPasswordReset(
  email: string,
  turnstileToken: string,
): Promise<void> {
  await mutate('POST', '/auth/password/request', {
    email,
    turnstile_token: turnstileToken,
  });
}

export async function resetPassword(
  key: string,
  password: string,
): Promise<void> {
  // 401: the password changed; the user signs in with it next.
  await mutate('POST', '/auth/password/reset', { key, password }, [401]);
}

/**
 * Start an OAuth login: allauth expects a regular form POST and redirects the
 * browser to the provider, then back to `callbackUrl` (with `?error=` on failure).
 */
export async function redirectToProvider(
  provider: string,
  callbackUrl: string,
): Promise<void> {
  await ensureCsrfCookie();
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${AUTH_BASE}/auth/provider/redirect`;
  const fields = {
    provider,
    callback_url: callbackUrl,
    process: 'login',
    csrfmiddlewaretoken: getCookie('csrftoken') ?? '',
  };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}
