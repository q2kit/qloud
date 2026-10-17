import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DetailPanel } from '@/app/detail-panel';
import { useDriveStore } from '@/features/drive/store';
import { api } from '@/lib/api/client';
import { i18n } from '@/lib/i18n';
import { createTestQueryClient, testUser } from '@/test/auth';
import { FakeDrive } from '@/test/drive-server';
import { setMediaQuery } from '@/test/match-media';
import { ActivityPanel } from './activity-panel';
import type { ActivityEvent } from './api';

const drive = new FakeDrive();
const folder = drive.folder('Team');
const NOW = new Date('2026-10-18T12:00:00Z').getTime();
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

let n = 0;
const row = (
  action: ActivityEvent['action'],
  fields: Partial<ActivityEvent> = {},
): ActivityEvent => ({
  id: `event-${String((n += 1))}`,
  action,
  created_at: minutesAgo(5),
  actor_kind: 'user',
  actor: { id: 'friend-id', display_name: 'Chi' },
  node: { id: folder.id, name: 'Team', kind: 'folder' },
  metadata: {},
  ...fields,
});

let events: ActivityEvent[];
let failure: number | null;
let paged: boolean;
const ok = <T,>(data: T) => ({ data, response: new Response() });
const requested = () =>
  vi
    .mocked(api.GET)
    .mock.calls.filter((call) => String(call[0]).includes('/activity'));

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  await i18n.changeLanguage('en');
  failure = null;
  paged = false;
  events = [];
  vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
    await Promise.resolve();
    if (path === '/api/v1/me')
      return ok({
        id: testUser.id,
        email: testUser.email,
        display_name: '',
        avatar_url: null,
        locale: 'en',
        theme: 'system',
        root_folder_id: 'root',
        is_superuser: false,
      });
    if (path === '/api/v1/nodes/{node_id}')
      return ok({
        ...folder,
        owner: { id: testUser.id, display_name: '' },
        breadcrumb: [],
        capabilities: {
          can_edit: true,
          can_share: true,
          can_trash: true,
          can_delete_versions: false,
        },
      });
    if (path === '/api/v1/nodes/{node_id}/activity') {
      if (failure)
        return {
          error: { error: { code: 'error', message: 'error', details: {} } },
          response: new Response(null, { status: failure }),
        };
      const cursor = (
        options as { params?: { query?: { cursor?: string } } } | undefined
      )?.params?.query?.cursor;
      if (paged)
        return cursor === 'second'
          ? ok({ results: [row('node.trash')], next: null, previous: null })
          : ok({
              results: [row('node.restore')],
              next: 'http://localhost/api/v1/x?cursor=second',
              previous: null,
            });
      return ok({ results: events, next: null, previous: null });
    }
    return ok({ results: [], next: null, previous: null });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useDriveStore.getState().select(null);
});

function setup(panel = false) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <I18nextProvider i18n={i18n}>
        {panel ? (
          <DetailPanel
            isOpen
            triggerRef={React.createRef<HTMLButtonElement>()}
            onClose={() => undefined}
            onOpenChange={() => undefined}
          />
        ) : (
          <ActivityPanel node={folder} />
        )}
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('activity tab', () => {
  it('describes each kind of event with its actor and time', async () => {
    events = [
      row('node.create', {
        actor: { id: testUser.id, display_name: 'Alice' },
      }),
      row('node.move', {
        node: { id: 'file', name: 'plan.txt', kind: 'file' },
        metadata: {
          from_folder: { id: null, name: null, is_root: false },
          to_folder: { id: folder.id, name: 'Team', is_root: false },
        },
      }),
      row('node.rename', {
        node: { id: 'file', name: 'b.txt', kind: 'file' },
        metadata: { from_name: 'a.txt' },
      }),
      row('share.add', {
        actor: { id: 'friend-id', display_name: '', email: 'chi@example.com' },
        metadata: { grantee: { id: 'g', name: 'Dung' }, role: 'editor' },
      }),
      row('version.expire', {
        actor_kind: 'system',
        actor: null,
        node: { id: 'file', name: 'plan.txt', kind: 'file' },
        metadata: { versions: [1, 2] },
      }),
      row('link.revoke', { actor_kind: 'moderator', actor: null }),
      row('node.purge', { actor: null, created_at: minutesAgo(60 * 24 * 3) }),
    ];
    setup();
    expect(
      await screen.findByText('You created the folder “Team”'),
    ).toBeVisible();
    // A folder the reader cannot open stays unnamed.
    expect(
      screen.getByText('Chi moved “plan.txt” from another folder to Team'),
    ).toBeVisible();
    expect(screen.getByText('Chi renamed “a.txt” to “b.txt”')).toBeVisible();
    // No display name: editors get the email instead.
    expect(
      screen.getByText('chi@example.com shared “Team” with Dung as editor'),
    ).toBeVisible();
    expect(
      screen.getByText('System cleaned up 2 old versions of “plan.txt”'),
    ).toBeVisible();
    expect(
      screen.getByText('An administrator revoked a public link to “Team”'),
    ).toBeVisible();
    expect(
      screen.getByText('A deleted user permanently deleted “Team”'),
    ).toBeVisible();
    const times = screen.getAllByText('5 minutes ago');
    expect(times[0]).toHaveAttribute('dateTime', minutesAgo(5));
    expect(times[0]).toHaveAttribute('title');
    expect(screen.getByText('3 days ago')).toBeVisible();
  });

  it('speaks Vietnamese', async () => {
    await i18n.changeLanguage('vi');
    events = [row('node.trash')];
    setup();
    expect(
      await screen.findByText('Chi đã chuyển “Team” vào thùng rác'),
    ).toBeVisible();
  });

  it('shows an empty state', async () => {
    setup();
    expect(await screen.findByText('No activity yet.')).toBeVisible();
  });

  it('loads more, page by page', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    paged = true;
    setup();
    expect(await screen.findByText('Chi restored “Team”')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(
      await screen.findByText('Chi moved “Team” to the trash'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [500, "Couldn't load activity."],
    [404, 'This item is no longer available.'],
  ])('offers a retry after a %i', async (status, message) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    failure = status;
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    failure = null;
    events = [row('node.restore')];
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Chi restored “Team”')).toBeVisible();
  });
});

describe('activity tab in the details panel', () => {
  beforeEach(() => {
    setMediaQuery('(min-width: 1280px)', true);
  });

  it('loads only when opened and is off where sharing is', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    events = [row('node.create')];
    useDriveStore.getState().select(folder);
    setup(true);
    expect(requested()).toHaveLength(0);
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(
      await screen.findByText('Chi created the folder “Team”'),
    ).toBeVisible();
    act(() => {
      useDriveStore.getState().select({
        ...folder,
        trashed_at: '2026-10-12T12:00:00Z',
      } as typeof folder);
    });
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeDisabled();
    act(() => {
      useDriveStore.getState().select({ ...folder, is_root: true });
    });
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeDisabled();
  });
});
