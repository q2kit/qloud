import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { renderApp } from '@/test/render-app';

import { AUTH_BASE } from './api';

const server = setupServer(
  // Shell widgets that are not under test.
  http.get('/api/v1/health', () =>
    HttpResponse.json({ status: 'ok', checks: {} }),
  ),
  // Turnstile off, as when the backend has no secret key.
  http.get('/api/v1/config', () =>
    HttpResponse.json({ turnstile_site_key: null }),
  ),
  http.get(`${AUTH_BASE}/config`, () =>
    HttpResponse.json({
      status: 200,
      data: {
        socialaccount: { providers: [{ id: 'github', name: 'GitHub' }] },
      },
    }),
  ),
);

function authenticated(): Response {
  return HttpResponse.json({
    status: 200,
    data: { user: testUser, methods: [] },
    meta: { is_authenticated: true },
  });
}

function failure(status: number, errors: object[] = []): Response {
  return HttpResponse.json({ status, errors }, { status });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(async () => {
  document.cookie = 'csrftoken=token';
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe('route protection', () => {
  it('sends visitors to the login page with the requested path as next', async () => {
    const router = renderApp('/trash?sort=name');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(router.state.location.search).toBe(
      `?next=${encodeURIComponent('/trash?sort=name')}`,
    );
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
  });

  it('lets signed-in users through and keeps them away from login', async () => {
    const router = renderApp('/login?next=%2Ftrash', testUser);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/trash');
    });
  });

  it('ignores next targets on other sites', async () => {
    const router = renderApp(
      '/login?next=https%3A%2F%2Fevil.example',
      testUser,
    );
    await waitFor(() => {
      // `/` itself sends on to the Drive root (S-05).
      expect(router.state.location.pathname).toBe('/drive');
    });
  });
});

describe('login (S-01)', () => {
  it('signs in and continues to next', async () => {
    let body: unknown;
    server.use(
      http.post(`${AUTH_BASE}/auth/login`, async ({ request }) => {
        body = await request.json();
        return authenticated();
      }),
    );
    const user = userEvent.setup();
    const router = renderApp('/login?next=%2Frecent');

    await user.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-pass');
    await user.click(screen.getByLabelText('Remember me'));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/recent');
    });
    expect(body).toEqual({
      email: 'alice@example.com',
      password: 'secret-pass',
      remember: true,
    });
  });

  it.each([
    [
      failure(400, [
        { code: 'email_password_mismatch', message: 'x', param: 'password' },
      ]),
      'The email or password is incorrect.',
    ],
    [failure(429), 'Too many attempts. Please wait a minute and try again.'],
    [failure(401), 'This account cannot be signed in to.'],
  ])('explains a failed login', async (response, message) => {
    server.use(http.post(`${AUTH_BASE}/auth/login`, () => response.clone()));
    const user = userEvent.setup();
    renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('shows OAuth outcomes and the enabled providers', async () => {
    renderApp('/login?error=cancelled');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign in with this account.',
    );
    expect(
      await screen.findByRole('button', { name: 'Continue with GitHub' }),
    ).toBeInTheDocument();
  });
});

describe('signup (S-02)', () => {
  it('creates the account, confirms the email was sent, then opens Drive', async () => {
    let body: unknown;
    server.use(
      http.post(`${AUTH_BASE}/auth/signup`, async ({ request }) => {
        body = await request.json();
        return authenticated();
      }),
    );
    const user = userEvent.setup();
    const router = renderApp('/signup');

    await user.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'qloud-test-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(
      await screen.findByRole('heading', { name: 'Check your inbox' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
    expect(body).toEqual({
      email: 'alice@example.com',
      password: 'qloud-test-password',
      turnstile_token: '',
    });

    await user.click(screen.getByRole('button', { name: 'Go to Drive' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/drive');
    });
  });

  it('shows field errors next to their input', async () => {
    server.use(
      http.post(`${AUTH_BASE}/auth/signup`, () =>
        failure(400, [
          { code: 'email_taken', message: 'x', param: 'email' },
          {
            code: 'password_too_common',
            message: 'This password is too common.',
            param: 'password',
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderApp('/signup');

    await user.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByLabelText('Email')).toHaveAccessibleDescription(
      'This email is already used by another account.',
    );
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'This password is too common.',
    );
  });

  it('explains closed signup', async () => {
    server.use(http.post(`${AUTH_BASE}/auth/signup`, () => failure(403)));
    const user = userEvent.setup();
    renderApp('/signup');

    await user.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'qloud-test-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-up is not open at the moment.',
    );
  });
});

describe('email verification (S-03)', () => {
  it('verifies the key from the link once', async () => {
    const keys: unknown[] = [];
    server.use(
      http.get(`${AUTH_BASE}/auth/session`, () => failure(401)),
      http.post(`${AUTH_BASE}/auth/email/verify`, async ({ request }) => {
        keys.push(await request.json());
        return failure(401);
      }),
    );
    renderApp('/verify-email/MQ:abc');

    expect(
      await screen.findByRole('heading', { name: 'Email verified' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(keys).toEqual([{ key: 'MQ:abc' }]);
  });

  it('explains an invalid or expired link', async () => {
    server.use(
      http.post(`${AUTH_BASE}/auth/email/verify`, () =>
        failure(400, [
          { code: 'invalid_or_expired_key', message: 'x', param: 'key' },
        ]),
      ),
    );
    renderApp('/verify-email/bad', testUser);

    expect(
      await screen.findByRole('heading', {
        name: 'Could not verify your email',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /already used, or expired\. If you verified your email before/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to Drive' }),
    ).toBeInTheDocument();
  });
});

describe('password reset (S-04)', () => {
  it('confirms a reset request without revealing whether the email exists', async () => {
    server.use(
      http.post(`${AUTH_BASE}/auth/password/request`, () =>
        HttpResponse.json({ status: 200 }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/password/reset');

    await user.type(
      await screen.findByLabelText('Email'),
      'nobody@example.com',
    );
    await user.click(screen.getByRole('button', { name: 'Send link' }));

    expect(
      await screen.findByRole('heading', { name: 'Check your inbox' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/If nobody@example.com has a Qloud account/),
    ).toBeInTheDocument();
  });

  it('sets the new password from the emailed key', async () => {
    let body: unknown;
    server.use(
      http.post(`${AUTH_BASE}/auth/password/reset`, async ({ request }) => {
        body = await request.json();
        return failure(401);
      }),
    );
    const user = userEvent.setup();
    renderApp('/password/reset/key-1');

    await user.type(
      await screen.findByLabelText('New password'),
      'qloud-new-password',
    );
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(
      await screen.findByRole('heading', { name: 'Password changed' }),
    ).toBeInTheDocument();
    expect(body).toEqual({ key: 'key-1', password: 'qloud-new-password' });
  });

  it('blocks the form when the link is no longer valid', async () => {
    server.use(
      http.post(`${AUTH_BASE}/auth/password/reset`, () =>
        failure(400, [
          { code: 'invalid_password_reset', message: 'x', param: 'key' },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderApp('/password/reset/used');

    await user.type(
      await screen.findByLabelText('New password'),
      'qloud-new-password',
    );
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is invalid or has expired.',
    );
    expect(screen.getByLabelText('New password')).toBeDisabled();
    expect(
      screen.getByRole('link', { name: 'Send a new link' }),
    ).toHaveAttribute('href', '/password/reset');
  });
});

describe('account menu', () => {
  it('signs out and returns to the login page', async () => {
    server.use(http.delete(`${AUTH_BASE}/auth/session`, () => failure(401)));
    const user = userEvent.setup();
    const router = renderApp('/', testUser);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
  });
});
