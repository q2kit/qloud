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
} from 'vitest';

import type { DriveNodeDetail } from '@/features/drive/api';
import { folderPath } from '@/features/drive/paths';
import type { Me } from '@/features/settings/use-me';
import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive, ROOT_ID } from '@/test/drive-server';
import { renderApp } from '@/test/render-app';
import { isUploadBlocked, storageLevel, type StorageUsage } from './api';

const server = setupServer();
let drive: FakeDrive;
let storageRequests: number;
let trashed: string[][];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});
beforeEach(async () => {
  drive = new FakeDrive();
  storageRequests = 0;
  trashed = [];
  server.use(
    http.get('/api/v1/me/storage', () => {
      storageRequests += 1;
      return HttpResponse.json(drive.storage);
    }),
    http.post('/api/v1/nodes/trash', async ({ request }) => {
      const { node_ids } = (await request.json()) as { node_ids: string[] };
      trashed.push(node_ids);
      const nodes = node_ids.map((id) => drive.nodes.get(id));
      for (const id of node_ids) drive.nodes.delete(id);
      return HttpResponse.json({ nodes });
    }),
    ...drive.handlers(),
  );
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function usage(used: number, quota = 1000): StorageUsage {
  return { ...new FakeDrive().storage, used_bytes: used, quota_bytes: quota };
}

function fill(used: number, quota = 5_000_000_000) {
  drive.storage = { ...drive.storage, used_bytes: used, quota_bytes: quota };
}

describe('storage levels', () => {
  it('warns from 80%, alerts from 95% and is full at or above the quota', () => {
    expect(storageLevel(usage(799))).toBe('normal');
    expect(storageLevel(usage(800))).toBe('warning');
    expect(storageLevel(usage(950))).toBe('critical');
    expect(storageLevel(usage(1000))).toBe('full');
    // A quota lowered below what is stored still counts as full.
    expect(storageLevel(usage(1500))).toBe('full');
    expect(storageLevel(usage(0, 0))).toBe('full');
  });

  it('blocks uploads only into the own Drive once full', () => {
    const me = { root_folder_id: ROOT_ID } as Me;
    const folder = (breadcrumb: string[], id = 'f') =>
      ({
        id,
        breadcrumb: breadcrumb.map((crumb) => ({ id: crumb, name: crumb })),
      }) as DriveNodeDetail;
    const full = usage(1000);

    expect(isUploadBlocked(full, me, folder([], ROOT_ID))).toBe(true);
    expect(isUploadBlocked(full, me, folder([ROOT_ID, 'sub']))).toBe(true);
    // Someone else's shared folder uses their quota.
    expect(isUploadBlocked(full, me, folder(['shared-top']))).toBe(false);
    expect(isUploadBlocked(usage(999), me, folder([], ROOT_ID))).toBe(false);
    expect(isUploadBlocked(undefined, me, folder([], ROOT_ID))).toBe(false);
  });
});

describe('Sidebar meter', () => {
  it('shows used and quota and links to the storage page', async () => {
    const user = userEvent.setup();
    const router = renderApp('/drive', testUser);

    const meter = await screen.findByRole('progressbar', {
      name: 'Storage used',
    });
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(meter).toHaveAttribute('aria-valuetext', '1 MB of 5 GB used');
    await user.click(screen.getByRole('link', { name: /Storage/ }));
    expect(router.state.location.pathname).toBe('/settings/storage');
  });

  it.each([
    [4_000_000_000, 'bg-warning', '80'],
    [4_800_000_000, 'bg-destructive', '96'],
  ])('colors %d bytes with %s', async (used, color, percent) => {
    fill(used);
    renderApp('/drive', testUser);

    const meter = await screen.findByRole('progressbar', {
      name: 'Storage used',
    });
    expect(meter).toHaveAttribute('aria-valuenow', percent);
    expect(meter.firstElementChild).toHaveClass(color);
  });
});

describe('Storage page (S-14)', () => {
  it('shows the breakdown and the largest files, which can be trashed', async () => {
    const user = userEvent.setup();
    const folder = drive.folder('Videos');
    const big = drive.file('movie.mp4', folder.id, 3_000_000, 'video/mp4');
    drive.file('notes.txt', ROOT_ID, 2_000, 'text/plain');
    drive.storage = {
      ...drive.storage,
      breakdown: { ...drive.storage.breakdown, video: 3_000_000, trash: 5 },
    };
    const router = renderApp('/settings/storage', testUser);

    const breakdown = await screen.findByRole('region', {
      name: 'By file type',
    });
    expect(within(breakdown).getByText('Videos')).toBeInTheDocument();
    expect(within(breakdown).getByText('3 MB')).toBeInTheDocument();
    expect(within(breakdown).getByText('5 B')).toBeInTheDocument();
    expect(
      within(breakdown).getByRole('link', { name: 'Open trash' }),
    ).toHaveAttribute('href', '/trash');

    const largest = screen.getByRole('region', { name: 'Largest files' });
    const rows = await within(largest).findAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('movie.mp4');
    expect(rows[1]).toHaveTextContent('notes.txt');

    const before = storageRequests;
    await user.click(
      within(largest).getByRole('button', {
        name: 'Move movie.mp4 to trash',
      }),
    );
    await waitFor(() => {
      expect(trashed).toEqual([[big.id]]);
    });
    await waitFor(() => {
      expect(storageRequests).toBeGreaterThan(before);
    });
    await waitFor(() => {
      expect(within(largest).queryByText('movie.mp4')).not.toBeInTheDocument();
    });

    await user.click(
      within(largest).getByRole('button', {
        name: 'Show notes.txt in its folder',
      }),
    );
    expect(router.state.location.pathname + router.state.location.search).toBe(
      folderPath(
        ROOT_ID,
        [...drive.nodes.values()].find((n) => n.name === 'notes.txt')?.id,
      ),
    );
  });

  it('highlights a group and shows its share on hover or focus', async () => {
    const user = userEvent.setup();
    drive.storage = {
      ...drive.storage,
      breakdown: {
        ...drive.storage.breakdown,
        document: 1_000,
        video: 3_000,
      },
    };
    renderApp('/settings/storage', testUser);

    const breakdown = await screen.findByRole('region', {
      name: 'By file type',
    });
    expect(within(breakdown).getByText('4 KB stored in total')).toBeVisible();
    const videos = within(breakdown)
      .getAllByRole('listitem')
      .find((row) => row.textContent.includes('Videos'));
    if (!videos) throw new Error('missing Videos row');
    expect(videos).toHaveTextContent('75%');
    await user.hover(videos);
    expect(videos).toHaveClass('bg-accent');
    expect(within(breakdown).getByText('3 KB · 75%')).toBeInTheDocument();
    await user.unhover(videos);
    expect(within(breakdown).queryByText('3 KB · 75%')).not.toBeInTheDocument();

    // An empty group is not a keyboard stop.
    const audio = within(breakdown)
      .getAllByRole('listitem')
      .find((row) => row.textContent.includes('Audio'));
    expect(audio).not.toHaveAttribute('tabindex');
  });

  it('offers a retry when the usage cannot be loaded', async () => {
    let fail = true;
    server.use(
      http.get('/api/v1/me/storage', () =>
        fail
          ? HttpResponse.json(
              { error: { code: 'error', message: 'x', details: {} } },
              { status: 500 },
            )
          : HttpResponse.json(drive.storage),
      ),
    );
    const user = userEvent.setup();
    renderApp('/settings/storage', testUser);

    expect(
      await screen.findByText('Storage usage could not be loaded.'),
    ).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('region', { name: 'By file type' }),
    ).toBeInTheDocument();
  });
});

describe('Full storage', () => {
  it('shows a banner and disables uploads while creating folders still works', async () => {
    const user = userEvent.setup();
    fill(5_000_000_000);
    renderApp('/drive', testUser);

    expect(
      await screen.findByText('Your storage is full.', { exact: false }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: 'Upload files' }),
      ).toHaveAttribute('aria-disabled', 'true');
    });
    expect(
      screen.getByRole('menuitem', { name: 'Upload folder' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('menuitem', { name: 'New folder' }),
    ).not.toHaveAttribute('aria-disabled');
    expect(
      screen.getByText('Your storage is full. Free up space to upload.'),
    ).toBeInTheDocument();
  });

  it('leaves uploads into a folder shared by someone else to the server', async () => {
    const user = userEvent.setup();
    fill(5_000_000_000);
    const shared = drive.folder('Team');
    // As seen by a recipient: the owner's root is not part of the path.
    drive.nodes.set(shared.id, { ...shared, parent_id: null, is_root: false });
    renderApp(folderPath(shared.id), testUser);

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: 'Upload files' }),
      ).not.toHaveAttribute('aria-disabled');
    });
  });
});
