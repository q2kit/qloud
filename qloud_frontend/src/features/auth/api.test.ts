import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  AUTH_BASE,
  AuthApiError,
  fetchProviders,
  fetchSession,
  login,
  logout,
  redirectToProvider,
  resetPassword,
  signup,
  verifyEmail,
} from './api';

const server = setupServer();
const user = {
  id: 'u1',
  display: 'Alice',
  email: 'alice@example.com',
  has_usable_password: true,
};

function clearCookies(): void {
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  clearCookies();
});
afterAll(() => {
  server.close();
});

describe('auth api', () => {
  it('reads a signed-in and a signed-out session', async () => {
    server.use(
      http.get(`${AUTH_BASE}/auth/session`, () =>
        HttpResponse.json({
          status: 200,
          data: { user },
          meta: { is_authenticated: true },
        }),
      ),
    );
    expect(await fetchSession()).toEqual({ user, flows: [] });

    server.use(
      http.get(`${AUTH_BASE}/auth/session`, () =>
        HttpResponse.json(
          {
            status: 401,
            data: { flows: [{ id: 'provider_signup', is_pending: true }] },
            meta: { is_authenticated: false },
          },
          { status: 401 },
        ),
      ),
    );
    expect(await fetchSession()).toEqual({
      user: null,
      flows: [{ id: 'provider_signup', is_pending: true }],
    });
  });

  it('fetches a CSRF cookie before the first write and sends it back', async () => {
    const seen: Request[] = [];
    server.use(
      http.get(`${AUTH_BASE}/config`, () => {
        document.cookie = 'csrftoken=token-123';
        return HttpResponse.json({ status: 200, data: {} });
      }),
      http.post(`${AUTH_BASE}/auth/login`, ({ request }) => {
        seen.push(request.clone());
        return HttpResponse.json({
          status: 200,
          data: { user },
          meta: { is_authenticated: true },
        });
      }),
    );

    const session = await login({
      email: 'alice@example.com',
      password: 'secret',
      remember: true,
    });

    expect(session.user).toEqual(user);
    const [request] = seen;
    expect(request?.headers.get('X-CSRFToken')).toBe('token-123');
    expect(request?.headers.get('Accept-Language')).toMatch(/^(vi|en)$/);
    expect(await request?.json()).toEqual({
      email: 'alice@example.com',
      password: 'secret',
      remember: true,
    });
  });

  it('turns allauth errors into AuthApiError', async () => {
    document.cookie = 'csrftoken=token';
    server.use(
      http.post(`${AUTH_BASE}/auth/signup`, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [{ code: 'email_taken', message: 'Taken', param: 'email' }],
          },
          { status: 400 },
        ),
      ),
    );

    const error = await signup({
      email: 'a@example.com',
      password: 'p',
      turnstileToken: 't',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'email_taken',
      errors: [{ code: 'email_taken', message: 'Taken', param: 'email' }],
    });
  });

  it('reports a rate limit with its own code', async () => {
    document.cookie = 'csrftoken=token';
    server.use(
      http.post(`${AUTH_BASE}/auth/login`, () =>
        HttpResponse.json({ status: 429 }, { status: 429 }),
      ),
    );
    await expect(
      login({ email: 'a@example.com', password: 'p', remember: false }),
    ).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('treats 401 as success where allauth signs no one in', async () => {
    document.cookie = 'csrftoken=token';
    const unauthenticated = (): Response =>
      HttpResponse.json({ status: 401 }, { status: 401 });
    server.use(
      http.delete(`${AUTH_BASE}/auth/session`, unauthenticated),
      http.post(`${AUTH_BASE}/auth/email/verify`, unauthenticated),
      http.post(`${AUTH_BASE}/auth/password/reset`, unauthenticated),
    );
    await expect(logout()).resolves.toBeUndefined();
    await expect(verifyEmail('key')).resolves.toBeUndefined();
    await expect(resetPassword('key', 'new')).resolves.toBeUndefined();
  });

  it('lists the enabled OAuth providers', async () => {
    server.use(
      http.get(`${AUTH_BASE}/config`, () =>
        HttpResponse.json({
          status: 200,
          data: {
            socialaccount: { providers: [{ id: 'github', name: 'GitHub' }] },
          },
        }),
      ),
    );
    expect(await fetchProviders()).toEqual([{ id: 'github', name: 'GitHub' }]);
  });

  it('starts OAuth with a form POST carrying the CSRF token', async () => {
    document.cookie = 'csrftoken=token-9';
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    await redirectToProvider('github', '/login?next=%2Ftrash');

    const form = submit.mock.contexts[0] as HTMLFormElement;
    expect(form.method).toBe('post');
    expect(form.action).toContain(`${AUTH_BASE}/auth/provider/redirect`);
    expect(Object.fromEntries(new FormData(form))).toEqual({
      provider: 'github',
      callback_url: '/login?next=%2Ftrash',
      process: 'login',
      csrfmiddlewaretoken: 'token-9',
    });
    form.remove();
    submit.mockRestore();
  });
});
