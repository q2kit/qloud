import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
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
import { SharingPanel } from './sharing-panel';

const drive = new FakeDrive();
const folder = drive.folder('Projects');
const node = drive.file('plan.txt', folder.id);
const OWNER = { id: 'owner-id', display_name: 'Bao Tran' };

const grant = (id: string, nodeId: string, email: string, role = 'viewer') => ({
  id,
  node_id: nodeId,
  grantee: { id: `user-${id}`, email, display_name: '' },
  role,
  created_by_id: OWNER.id,
  created_at: '2026-10-12T12:00:00Z',
  updated_at: '2026-10-12T12:00:00Z',
});
const link = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  node_id: node.id,
  token: `token-${id}`,
  role: 'viewer',
  expires_at: null,
  revoked_at: null,
  revoked_by_id: null,
  revoke_reason: '',
  created_by_id: OWNER.id,
  created_at: '2026-10-12T12:00:00Z',
  updated_at: '2026-10-12T12:00:00Z',
  ...fields,
});

let role: 'owner' | 'editor' | 'viewer';
let sharesFail: boolean;
const ok = <T,>(data: T) => ({ data, response: new Response() });
const page = <T,>(results: T[]) => ok({ results, next: null, previous: null });
const requested = (fragment: string) =>
  vi
    .mocked(api.GET)
    .mock.calls.filter((call) => String(call[0]).includes(fragment));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  role = 'owner';
  sharesFail = false;
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    await Promise.resolve();
    switch (path) {
      case '/api/v1/me':
        return ok({
          id: role === 'owner' ? OWNER.id : testUser.id,
          email: testUser.email,
          display_name: role === 'owner' ? OWNER.display_name : '',
          avatar_url: null,
          locale: 'en',
          theme: 'system',
          root_folder_id: 'root',
          is_superuser: false,
        });
      case '/api/v1/nodes/{node_id}':
        return ok({
          ...node,
          owner: OWNER,
          breadcrumb: [{ id: folder.id, name: 'Projects' }],
          capabilities: {
            can_edit: role !== 'viewer',
            can_share: role !== 'viewer',
            can_trash: role !== 'viewer',
            can_delete_versions: role === 'owner',
          },
        });
      case '/api/v1/nodes/{node_id}/shares':
        if (sharesFail)
          return {
            error: { error: { code: 'error', message: 'boom', details: {} } },
            response: new Response(null, { status: 500 }),
          };
        return page([
          grant('direct', node.id, 'chi@example.com', 'editor'),
          grant('inherited', folder.id, 'dung@example.com'),
        ]);
      case '/api/v1/nodes/{node_id}/links':
        return page([
          link('active'),
          link('revoked', { revoked_at: '2026-10-12T13:00:00Z' }),
          link('expired', { expires_at: '2020-01-01T00:00:00Z' }),
        ]);
      default:
        return page([]);
    }
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  useDriveStore.getState().select(null);
});

function setup(panel = false) {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        {panel ? (
          <DetailPanel
            isOpen
            triggerRef={React.createRef<HTMLButtonElement>()}
            onClose={() => undefined}
            onOpenChange={() => undefined}
          />
        ) : (
          <SharingPanel node={node} />
        )}
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('sharing tab', () => {
  it('shows the owner, direct and inherited access, and active links to the owner', async () => {
    setup();
    expect(await screen.findByText('Bao Tran (you)')).toBeVisible();
    const people = screen.getByRole('region', { name: 'People with access' });
    expect(within(people).getByText('chi@example.com')).toBeVisible();
    expect(within(people).getByText('Editor')).toBeVisible();
    expect(
      within(people).getByText('Access from the folder Projects'),
    ).toBeVisible();
    expect(within(people).getAllByText(/Access from/)).toHaveLength(1);

    const links = screen.getByRole('region', { name: 'Public links' });
    // Revoked and expired links are left to the Share dialog.
    expect(
      within(links).getAllByRole('button', { name: 'Copy link' }),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Manage access' })).toBeVisible();
    expect(requested('/shares')[0]?.[1]).toMatchObject({
      params: { query: { include_inherited: true } },
    });
  });

  it('copies the public link', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/s/token-active`,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Link copied');
  });

  it('shows editors who has access, but leaves public links to the owner', async () => {
    role = 'editor';
    setup();
    expect(await screen.findByText('Bao Tran')).toBeVisible();
    expect(screen.getByText('You can edit this item.')).toBeVisible();
    expect(screen.getByText('chi@example.com')).toBeVisible();
    expect(
      screen.getByText('Only the owner can manage public links.'),
    ).toBeVisible();
    expect(requested('/links')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Manage access' })).toBeVisible();
  });

  it('shows viewers only the owner and their own access', async () => {
    role = 'viewer';
    setup();
    expect(await screen.findByText('Bao Tran')).toBeVisible();
    expect(screen.getByText('You can view this item.')).toBeVisible();
    expect(screen.queryByText('People with access')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Manage access' }),
    ).not.toBeInTheDocument();
    expect(requested('/shares')).toHaveLength(0);
    expect(requested('/links')).toHaveLength(0);
  });

  it('offers a retry when access cannot be loaded', async () => {
    const user = userEvent.setup();
    sharesFail = true;
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load sharing details.",
    );
    sharesFail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('chi@example.com')).toBeVisible();
  });
});

describe('sharing tab in the details panel', () => {
  beforeEach(() => {
    setMediaQuery('(min-width: 1280px)', true);
  });

  it('opens lazily, moves with the arrow keys and resets when the selection changes', async () => {
    const user = userEvent.setup();
    useDriveStore.getState().select(node);
    setup(true);
    expect(requested('/shares')).toHaveLength(0);
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    await user.keyboard('{ArrowLeft}');
    const sharing = screen.getByRole('tab', { name: 'Sharing' });
    expect(sharing).toHaveFocus();
    expect(sharing).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('chi@example.com')).toBeVisible();

    act(() => {
      useDriveStore.getState().select({ ...node, id: 'other' });
    });
    expect(screen.getByRole('tab', { name: 'Info' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('skips the disabled versions tab for a folder', async () => {
    const user = userEvent.setup();
    useDriveStore.getState().select(folder);
    setup(true);
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Sharing' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Info' })).toHaveFocus();
  });

  it('is off for several items, trashed items and the root folder', () => {
    setup(true);
    act(() => {
      useDriveStore.getState().selectAll([node, folder]);
    });
    expect(screen.getByRole('tab', { name: 'Sharing' })).toBeDisabled();
    act(() => {
      useDriveStore.getState().select({
        ...node,
        trashed_at: '2026-10-12T12:00:00Z',
      } as typeof node);
    });
    expect(screen.getByRole('tab', { name: 'Sharing' })).toBeDisabled();
    act(() => {
      useDriveStore.getState().select({ ...folder, is_root: true });
    });
    expect(screen.getByRole('tab', { name: 'Sharing' })).toBeDisabled();
  });
});
