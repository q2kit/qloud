import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { DetailPanel } from '@/app/detail-panel';
import { setMediaQuery } from '@/test/match-media';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '@/lib/i18n';
import { api } from '@/lib/api/client';
import { FakeDrive } from '@/test/drive-server';
import { createTestQueryClient } from '@/test/auth';
import { driveKeys } from '@/features/drive/api';
import { useDriveStore } from '@/features/drive/store';
import { VersionPanel } from './version-panel';
import { versionKey, type FileVersion } from './api';

const node = new FakeDrive().file('report.txt');
const first: FileVersion = {
  id: 'old',
  version_number: 1,
  size: 3,
  mime_type: 'text/plain',
  original_name: 'report.txt',
  created_at: '2026-10-12T12:00:00Z',
  uploaded_by: null,
  keep_forever: false,
  is_current: false,
};
const current: FileVersion = {
  ...first,
  id: 'current',
  version_number: 2,
  is_current: true,
  keep_forever: true,
};
let role: 'owner' | 'editor' | 'viewer';
let items: FileVersion[];
let detailNode = node;
const ok = <T,>(data: T) => ({ data, response: new Response() });

beforeEach(async () => {
  await i18n.changeLanguage('vi');
  role = 'owner';
  detailNode = node;
  items = [current, first];
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    await Promise.resolve();
    if (path === '/api/v1/nodes/{node_id}')
      return ok({
        ...detailNode,
        breadcrumb: [],
        capabilities: {
          can_edit: role !== 'viewer',
          can_share: role !== 'viewer',
          can_trash: role !== 'viewer',
          can_delete_versions: role === 'owner',
        },
      });
    return ok({ results: items, next: null, previous: null });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function setup(panel = false) {
  const client = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <>
          {panel ? (
            <DetailPanel
              isOpen
              triggerRef={React.createRef<HTMLButtonElement>()}
              onClose={() => undefined}
              onOpenChange={() => undefined}
            />
          ) : (
            <VersionPanel node={node} />
          )}
        </>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

describe('version panel', () => {
  it.each(['owner', 'editor', 'viewer'] as const)(
    'shows only permitted %s actions',
    async (value) => {
      role = value;
      setup();
      expect(await screen.findByText('Hiện tại')).toBeVisible();
      expect(screen.getAllByText('Đã khóa').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Tài khoản đã bị xóa')).toHaveLength(2);
      expect(
        screen.getByRole('button', { name: 'Tải phiên bản 1' }),
      ).toBeEnabled();
      expect(
        Boolean(
          screen.queryByRole('button', { name: 'Khôi phục phiên bản 1' }),
        ),
      ).toBe(value !== 'viewer');
      expect(
        Boolean(screen.queryByRole('button', { name: 'Xóa phiên bản 1' })),
      ).toBe(value === 'owner');
      expect(
        screen.queryByRole('button', { name: 'Khôi phục phiên bản 2' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Xóa phiên bản 2' }),
      ).not.toBeInTheDocument();
    },
  );

  it('confirms restore, refreshes affected caches and keeps another selected file', async () => {
    const user = userEvent.setup();
    const newer = { ...node, size: 3, updated_at: '2026-10-12T13:00:00Z' };
    const post = vi.spyOn(api, 'POST').mockImplementation(async () => {
      await Promise.resolve();
      items = [
        { ...first, id: 'restored', version_number: 3, is_current: true },
        { ...current, is_current: false },
        first,
      ];
      detailNode = newer;
      return ok(newer);
    });
    const { client } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const other = { ...node, id: 'another' };
    useDriveStore.getState().select(other);
    await user.click(
      await screen.findByRole('button', { name: 'Khôi phục phiên bản 1' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Khôi phục phiên bản 1?',
    });
    expect(post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Khôi phục' }));
    expect(await screen.findByText('Phiên bản 3')).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(useDriveStore.getState().selected[0]?.id).toBe(other.id);
    expect(client.getQueryData(driveKeys.node(node.id))).toMatchObject(newer);
    for (const key of [
      versionKey(node.id),
      driveKeys.node(node.id),
      driveKeys.recent,
      ['drive', 'preview', node.id],
      ['sharing', 'shared'],
      ['search'],
      driveKeys.children(node.parent_id ?? ''),
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
  });

  it('cancels delete and rolls back an optimistic deletion on a network error', async () => {
    const user = userEvent.setup();
    let reject: ((reason: Error) => void) | undefined;
    const remove = vi.spyOn(api, 'DELETE').mockImplementation(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    setup();
    await user.click(
      await screen.findByRole('button', { name: 'Xóa phiên bản 1' }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy' }),
    );
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Xóa phiên bản 1' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Xóa',
      }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('listitem', { name: 'Phiên bản 1' }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled();
    act(() => {
      reject?.(new Error('offline'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không thể thực hiện thao tác',
    );
    expect(
      await screen.findByRole('listitem', { name: 'Phiên bản 1' }),
    ).toBeVisible();
  });

  it('retries an unavailable list and renders its empty state', async () => {
    vi.mocked(api.GET).mockResolvedValueOnce({
      error: { error: { code: 'not_found', message: 'hidden', details: {} } },
      response: new Response(null, { status: 404 }),
    });
    items = [];
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'không còn tồn tại',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Chưa có phiên bản nào.')).toBeVisible();
  });

  it('loads more using only the cursor from the server link', async () => {
    const get = vi.mocked(api.GET);
    get.mockImplementation(async (path, options) => {
      await Promise.resolve();
      if (path === '/api/v1/nodes/{node_id}')
        return ok({
          ...node,
          breadcrumb: [],
          capabilities: {
            can_edit: false,
            can_share: false,
            can_trash: false,
            can_delete_versions: false,
          },
        });
      const cursor = (
        options as { params?: { query?: { cursor?: string } } } | undefined
      )?.params?.query?.cursor;
      return ok({
        results: cursor ? [first] : [current],
        next: cursor ? null : 'http://localhost/versions?cursor=next',
        previous: null,
      });
    });
    setup();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Tải thêm' }),
    );
    expect(
      await screen.findByRole('listitem', { name: 'Phiên bản 1' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Tải thêm' }),
    ).not.toBeInTheDocument();
  });
});

it('loads history lazily, supports arrow keys and resets when selection changes away and back', async () => {
  setMediaQuery('(min-width: 1280px)', true);
  useDriveStore.getState().select(node);
  setup(true);
  const user = userEvent.setup();
  const info = screen.getByRole('tab', { name: 'Thông tin' });
  await user.click(info);
  expect(
    vi
      .mocked(api.GET)
      .mock.calls.some((call) => String(call[0]).includes('/versions')),
  ).toBe(false);
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Phiên bản' })).toHaveFocus();
  expect(await screen.findByText('Hiện tại')).toBeVisible();
  act(() => {
    useDriveStore.getState().select({ ...node, id: 'folder', kind: 'folder' });
  });
  expect(screen.getByRole('tab', { name: 'Phiên bản' })).toBeDisabled();
  act(() => {
    useDriveStore.getState().select(node);
  });
  expect(screen.getByRole('tab', { name: 'Thông tin' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.queryByText('Hiện tại')).not.toBeInTheDocument();
});

it('aborts a pending history read when the selected file changes', async () => {
  setMediaQuery('(min-width: 1280px)', true);
  useDriveStore.getState().select(node);
  let signal: AbortSignal | undefined;
  vi.mocked(api.GET).mockImplementation((path, options) => {
    if (String(path).includes('/versions')) {
      signal = (options as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise(() => undefined);
    }
    return Promise.resolve(
      ok({
        ...node,
        breadcrumb: [],
        capabilities: {
          can_edit: false,
          can_trash: false,
          can_share: false,
          can_delete_versions: false,
        },
      }),
    );
  });
  setup(true);
  await userEvent.click(screen.getByRole('tab', { name: 'Phiên bản' }));
  expect(
    await screen.findByRole('status', { name: 'Đang tải lịch sử phiên bản…' }),
  ).toBeVisible();
  act(() => {
    useDriveStore.getState().select({ ...node, id: 'other' });
  });
  expect(signal?.aborted).toBe(true);
});

it('refreshes current markers after a 409 restore conflict', async () => {
  vi.spyOn(api, 'POST').mockImplementation(async () => {
    await Promise.resolve();
    items = [
      { ...first, is_current: true },
      { ...current, is_current: false },
    ];
    return {
      error: {
        error: { code: 'current_version', message: 'current', details: {} },
      },
      response: new Response(null, { status: 409 }),
    };
  });
  setup();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Khôi phục phiên bản 1' }),
  );
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Khôi phục',
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Đây là phiên bản hiện tại',
  );
  await waitFor(() => {
    expect(
      screen.queryByRole('button', { name: 'Khôi phục phiên bản 1' }),
    ).not.toBeInTheDocument();
  });
});

it('owner toggles current and old retention only after success and handles errors', async () => {
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockImplementation(async (_path, options) => {
      await Promise.resolve();
      const request = options as {
        params: { path: { version_id: string } };
        body: { keep_forever: boolean };
      };
      const selected = items.find(
        (item) => item.id === request.params.path.version_id,
      );
      if (!selected) throw new Error('Missing version');
      const updated = {
        ...selected,
        keep_forever: request.body.keep_forever,
      };
      items = items.map((item) => (item.id === updated.id ? updated : item));
      return ok(updated);
    });
  setup();
  const user = userEvent.setup();
  const old = await screen.findByRole('button', {
    name: 'Khóa phiên bản 1',
  });
  expect(old).toHaveAttribute('aria-pressed', 'false');
  expect(old).toHaveTextContent('Khóa');
  expect(old).toHaveAttribute('title', i18n.t('versions.keepTitle'));
  await user.click(old);
  await waitFor(() => expect(old).toHaveAttribute('aria-pressed', 'true'));
  expect(old).toHaveTextContent('Bỏ khóa');
  expect(old).toHaveAttribute('title', i18n.t('versions.unkeepTitle'));
  await user.click(screen.getByRole('button', { name: 'Khóa phiên bản 2' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Khóa phiên bản 2' }),
    ).toHaveAttribute('aria-pressed', 'false'),
  );
  expect(patch).toHaveBeenCalledWith(
    '/api/v1/nodes/{node_id}/versions/{version_id}',
    expect.objectContaining({ body: { keep_forever: false } }),
  );
  patch.mockRejectedValueOnce(new Error('offline'));
  await user.click(old);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Không thể thực hiện thao tác',
  );
  expect(old).toHaveAttribute('aria-pressed', 'true');
});

it.each(['viewer', 'editor'] as const)(
  '%s cannot toggle retention',
  async (value) => {
    role = value;
    setup();
    await screen.findByText('Hiện tại');
    expect(
      screen.queryByRole('button', { name: 'Khóa phiên bản 1' }),
    ).not.toBeInTheDocument();
  },
);
