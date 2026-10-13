import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n';
import { createTestQueryClient, testUser } from '@/test/auth';

import { AccountMenu } from './account-menu';

const AVATAR = 'https://avatars.example.com/alice.png';

let avatarUrl: string | null = null;

const server = setupServer(
  http.get('/api/v1/me', () =>
    HttpResponse.json({
      id: testUser.id,
      email: testUser.email,
      display_name: testUser.display,
      avatar_url: avatarUrl,
      locale: 'vi',
      theme: 'system',
    }),
  ),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  avatarUrl = null;
});
afterAll(() => {
  server.close();
});

function renderMenu(): HTMLElement {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole('button', { name: i18n.t('account.menu') });
}

describe('AccountMenu', () => {
  it('shows the profile avatar when there is one', async () => {
    avatarUrl = AVATAR;
    const trigger = renderMenu();
    await waitFor(() => {
      expect(trigger.querySelector('img')).toHaveAttribute('src', AVATAR);
    });
    expect(trigger).not.toHaveTextContent('A');
  });

  it('shows the initial without an avatar', async () => {
    const trigger = renderMenu();
    await waitFor(() => {
      expect(trigger).toHaveTextContent('A');
    });
    expect(trigger.querySelector('img')).toBeNull();
  });

  it('falls back to the initial when the avatar fails to load', async () => {
    avatarUrl = AVATAR;
    const trigger = renderMenu();
    await waitFor(() => {
      expect(trigger.querySelector('img')).not.toBeNull();
    });
    fireEvent.error(trigger.querySelector('img') ?? trigger);
    expect(trigger.querySelector('img')).toBeNull();
    expect(trigger).toHaveTextContent('A');
  });
});
