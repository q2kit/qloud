import { screen, waitFor, within } from '@testing-library/react';
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
  vi,
} from 'vitest';

import { AUTH_BASE } from '@/features/auth/api';
import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { renderApp } from '@/test/render-app';

const me = {
  id: testUser.id,
  email: testUser.email,
  display_name: 'Alice Nguyen',
  avatar_url: null,
  locale: 'en',
  theme: 'system',
};

const patches: unknown[] = [];

const server = setupServer(
  http.get('/api/v1/health', () =>
    HttpResponse.json({ status: 'ok', checks: {} }),
  ),
  http.get('/api/v1/me', () => HttpResponse.json(me)),
  // Saving the profile refreshes the session (display name in the account menu).
  http.get(`${AUTH_BASE}/auth/session`, () =>
    HttpResponse.json({
      status: 200,
      data: { user: testUser },
      meta: { is_authenticated: true },
    }),
  ),
  http.patch('/api/v1/me', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    patches.push(body);
    return HttpResponse.json({ ...me, ...body });
  }),
  http.get(`${AUTH_BASE}/config`, () =>
    HttpResponse.json({
      status: 200,
      data: {
        socialaccount: {
          providers: [
            { id: 'github', name: 'GitHub' },
            { id: 'google', name: 'Google' },
          ],
        },
      },
    }),
  ),
  http.get(`${AUTH_BASE}/account/providers`, () =>
    HttpResponse.json({
      status: 200,
      data: [
        {
          uid: '42',
          display: 'alice-gh',
          provider: { id: 'github', name: 'GitHub' },
        },
      ],
    }),
  ),
);

function authenticated(hasPassword = true): Response {
  return HttpResponse.json({
    status: 200,
    data: { user: { ...testUser, has_usable_password: hasPassword } },
    meta: { is_authenticated: true },
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(async () => {
  document.cookie = 'csrftoken=token';
  patches.length = 0;
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

async function openSettings(): Promise<void> {
  renderApp('/settings', testUser);
  await screen.findByRole('heading', { name: 'Profile' });
}

describe('settings (S-13)', () => {
  it('shows the profile and saves the display name', async () => {
    const user = userEvent.setup();
    await openSettings();

    expect(
      screen.getByText('alice@example.com', { selector: 'p' }),
    ).toBeInTheDocument();
    const input = screen.getByLabelText('Display name');
    expect(input).toHaveValue('Alice Nguyen');
    await user.clear(input);
    await user.type(input, '  Alice N.  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(patches).toEqual([{ display_name: 'Alice N.' }]);
  });

  it('applies language and theme at once and saves them to the profile', async () => {
    const user = userEvent.setup();
    await openSettings();
    const preferences = screen.getByRole('region', {
      name: 'Language and appearance',
    });

    await user.click(within(preferences).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    await user.click(
      within(preferences).getByRole('radio', { name: 'Tiếng Việt' }),
    );
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('vi');
    });

    await waitFor(() => {
      expect(patches).toEqual([{ theme: 'dark' }, { locale: 'vi' }]);
    });
  });

  it('changes the password and keeps this session', async () => {
    let body: unknown;
    server.use(
      http.post(`${AUTH_BASE}/account/password/change`, async ({ request }) => {
        body = await request.json();
        return authenticated();
      }),
    );
    const user = userEvent.setup();
    await openSettings();

    await user.type(screen.getByLabelText('Current password'), 'old-pass');
    await user.type(
      screen.getByLabelText('New password'),
      'qloud-new-password',
    );
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(
      await screen.findByText('Your password is updated.'),
    ).toBeInTheDocument();
    expect(body).toEqual({
      new_password: 'qloud-new-password',
      current_password: 'old-pass',
    });
    expect(
      screen.getByRole('heading', { name: 'Profile' }),
    ).toBeInTheDocument();
  });

  it('says when the current password is wrong', async () => {
    server.use(
      http.post(`${AUTH_BASE}/account/password/change`, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [
              {
                code: 'enter_current_password',
                message: 'x',
                param: 'current_password',
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    await openSettings();

    await user.type(screen.getByLabelText('Current password'), 'wrong');
    await user.type(
      screen.getByLabelText('New password'),
      'qloud-new-password',
    );
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(
      await screen.findByLabelText('Current password'),
    ).toHaveAccessibleDescription('The current password is incorrect.');
  });

  it('lets an OAuth-only account set a password without the current one', async () => {
    let body: unknown;
    server.use(
      http.get(`${AUTH_BASE}/auth/session`, () => authenticated(false)),
      http.post(`${AUTH_BASE}/account/password/change`, async ({ request }) => {
        body = await request.json();
        return authenticated(true);
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings', { ...testUser, has_usable_password: false });

    expect(
      await screen.findByRole('heading', { name: 'Set a password' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText('New password'),
      'qloud-new-password',
    );
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    await waitFor(() => {
      expect(body).toEqual({ new_password: 'qloud-new-password' });
    });
    expect(
      await screen.findByRole('heading', { name: 'Change password' }),
    ).toBeInTheDocument();
  });

  it('lists linked accounts and unlinks one', async () => {
    let body: unknown;
    server.use(
      http.delete(`${AUTH_BASE}/account/providers`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 200, data: [] });
      }),
    );
    const user = userEvent.setup();
    await openSettings();
    const linked = screen.getByRole('region', { name: 'Linked accounts' });

    expect(await within(linked).findByText('alice-gh')).toBeInTheDocument();
    expect(within(linked).getByText('Not linked')).toBeInTheDocument();
    await user.click(within(linked).getByRole('button', { name: 'Unlink' }));

    await waitFor(() => {
      expect(body).toEqual({ provider: 'github', account: '42' });
    });
  });

  it('explains why the last sign-in method cannot be unlinked', async () => {
    server.use(
      http.delete(`${AUTH_BASE}/account/providers`, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [
              {
                code: 'no_password',
                message: 'Your account has no password set up.',
                param: 'account',
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    await openSettings();
    const linked = screen.getByRole('region', { name: 'Linked accounts' });

    await user.click(
      await within(linked).findByRole('button', { name: 'Unlink' }),
    );

    expect(await within(linked).findByRole('alert')).toHaveTextContent(
      'Your account has no password set up.',
    );
  });

  it('links a provider through the connect flow', async () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    await openSettings();
    const linked = screen.getByRole('region', { name: 'Linked accounts' });

    await within(linked).findByText('alice-gh');
    await user.click(within(linked).getByRole('button', { name: 'Link' }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalled();
    });
    const form = submit.mock.contexts[0] as HTMLFormElement;
    expect(Object.fromEntries(new FormData(form))).toMatchObject({
      provider: 'google',
      callback_url: '/settings',
      process: 'connect',
    });
    form.remove();
    submit.mockRestore();
  });

  it('reports a failed link after the provider sends the user back', async () => {
    renderApp('/settings?error=connect', testUser);
    const linked = await screen.findByRole('region', {
      name: 'Linked accounts',
    });
    expect(within(linked).getByRole('alert')).toHaveTextContent(
      "Couldn't link this account. It may already be linked to someone else.",
    );
  });
});

describe('preference sync', () => {
  it('applies the saved language and theme when a session starts', async () => {
    server.use(
      http.get('/api/v1/me', () =>
        HttpResponse.json({ ...me, locale: 'vi', theme: 'dark' }),
      ),
    );
    renderApp('/', testUser);

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('vi');
    });
    expect(document.documentElement).toHaveClass('dark');
    // Applying the profile does not write it back.
    expect(patches).toEqual([]);
  });
});
