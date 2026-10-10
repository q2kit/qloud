import { act, screen, waitFor } from '@testing-library/react';
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

import { i18n } from '@/lib/i18n';
import { renderApp } from '@/test/render-app';

import { AUTH_BASE } from '../api';

vi.mock('./turnstile-config', () => ({ turnstileSiteKey: 'site-key' }));

interface RenderOptions {
  sitekey: string;
  theme: string;
  size: string;
  language: string;
  callback: (token: string) => void;
}

const turnstile = {
  render: vi.fn<(container: HTMLElement, options: RenderOptions) => string>(
    () => 'widget-1',
  ),
  reset: vi.fn(),
  remove: vi.fn(),
};

const server = setupServer(
  http.get(`${AUTH_BASE}/config`, () =>
    HttpResponse.json({ status: 200, data: {} }),
  ),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // Pretend Cloudflare's script already loaded: appending it fires onload.
  const append = document.head.append.bind(document.head);
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    append(...nodes);
    for (const node of nodes) {
      if (node instanceof HTMLScriptElement) {
        window.turnstile = turnstile;
        node.onload?.(new Event('load'));
      }
    }
  });
});
beforeEach(async () => {
  document.cookie = 'csrftoken=token';
  await i18n.changeLanguage('en');
  turnstile.render.mockClear();
  turnstile.reset.mockClear();
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function lastOptions(): RenderOptions {
  const options = turnstile.render.mock.lastCall?.[1];
  if (!options) throw new Error('Turnstile was not rendered');
  return options;
}

describe('Turnstile on signup', () => {
  it('renders the widget and waits for its token before submitting', async () => {
    let body: unknown;
    server.use(
      http.post(`${AUTH_BASE}/auth/signup`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          status: 200,
          data: { user: { id: 'u', display: 'a', email: 'a@example.com' } },
          meta: { is_authenticated: true },
        });
      }),
    );
    const user = userEvent.setup();
    renderApp('/signup');

    const submit = await screen.findByRole('button', { name: 'Sign up' });
    await waitFor(() => {
      expect(turnstile.render).toHaveBeenCalled();
    });
    expect(lastOptions()).toMatchObject({
      sitekey: 'site-key',
      theme: 'light',
      // jsdom lays nothing out (width 0), like the narrowest phone.
      size: 'compact',
      language: 'en',
    });
    expect(submit).toBeDisabled();

    act(() => {
      lastOptions().callback('token-1');
    });
    expect(submit).toBeEnabled();
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'qloud-test-password');
    await user.click(submit);

    await screen.findByRole('heading', { name: 'Check your inbox' });
    expect(body).toMatchObject({ turnstile_token: 'token-1' });
  });

  it('asks for a fresh token after the server rejects one', async () => {
    server.use(
      http.post(`${AUTH_BASE}/auth/signup`, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [
              {
                code: 'captcha_invalid',
                message: 'x',
                param: 'turnstile_token',
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp('/signup');

    await waitFor(() => {
      expect(turnstile.render).toHaveBeenCalled();
    });
    act(() => {
      lastOptions().callback('used-token');
    });
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'qloud-test-password');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bot verification failed.',
    );
    expect(turnstile.reset).toHaveBeenCalledWith('widget-1');
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDisabled();
  });
});
