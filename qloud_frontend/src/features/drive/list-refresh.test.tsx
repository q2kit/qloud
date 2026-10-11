import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { api } from '@/lib/api/client';
import { FakeDrive } from '@/test/drive-server';

import {
  driveKeys,
  refreshDriveQueries,
  useChildren,
  useMove,
  useRecent,
  type ChildrenPage,
} from './api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it.each(['children', 'recent'] as const)(
  'discards the initial %s response captured before upload completion',
  async (kind) => {
    const drive = new FakeDrive();
    const folder = drive.folder('Target');
    const file = drive.file('new.txt', folder.id);
    const stale = deferred<{ data: ChildrenPage; response: Response }>();
    let firstSignal: AbortSignal | undefined;
    const get = vi
      .spyOn(api, 'GET')
      .mockImplementationOnce((_path, options) => {
        firstSignal = (options as { signal?: AbortSignal }).signal;
        return stale.promise;
      })
      .mockResolvedValue({
        data: { next: null, previous: null, results: [file] },
        response: new Response(),
      });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () =>
        kind === 'children' ? useChildren(folder.id, 'name') : useRecent(),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await refreshDriveQueries(
        client,
        kind === 'children' ? driveKeys.children(folder.id) : driveKeys.recent,
      );
    });
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => {
      expect(view.result.current.data?.pages[0]?.results).toEqual([file]);
    });
    await act(async () => {
      stale.resolve({
        data: { next: null, previous: null, results: [] },
        response: new Response(),
      });
      await stale.promise;
    });
    expect(view.result.current.data?.pages[0]?.results).toEqual([file]);
    expect(get).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  },
);

it('refetches the destination first fetch when a move commits during navigation', async () => {
  const drive = new FakeDrive();
  const target = drive.folder('Target');
  const node = drive.folder('Moved');
  const moved = { ...node, parent_id: target.id };
  const stale = deferred<{ data: ChildrenPage; response: Response }>();
  const commit = deferred<{
    data: { nodes: (typeof node)[] };
    response: Response;
  }>();
  const get = vi
    .spyOn(api, 'GET')
    .mockImplementationOnce(() => stale.promise)
    .mockResolvedValue({
      data: { next: null, previous: null, results: [moved] },
      response: new Response(),
    });
  const post = vi.spyOn(api, 'POST').mockImplementation(() => commit.promise);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = renderHook(
    () => ({ children: useChildren(target.id, 'name'), move: useMove() }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => {
    expect(get).toHaveBeenCalledTimes(1);
  });
  act(() => {
    view.result.current.move.mutate({ nodes: [node], targetId: target.id });
  });
  await waitFor(() => {
    expect(post).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    commit.resolve({ data: { nodes: [moved] }, response: new Response() });
    await commit.promise;
  });
  await waitFor(() => {
    expect(view.result.current.children.data?.pages[0]?.results).toEqual([
      moved,
    ]);
  });
  await act(async () => {
    stale.resolve({
      data: { next: null, previous: null, results: [] },
      response: new Response(),
    });
    await stale.promise;
  });
  expect(view.result.current.children.data?.pages[0]?.results).toEqual([moved]);
  view.unmount();
  client.clear();
});

it('marks inactive folder caches stale without fetching unrelated queries', async () => {
  const client = new QueryClient();
  const target = driveKeys.childrenSorted('target', 'name');
  const other = driveKeys.childrenSorted('other', 'name');
  const publicKey = ['public', 'token', 'children'];
  for (const key of [target, other, publicKey])
    client.setQueryData(key, { pages: [], pageParams: [] });
  await refreshDriveQueries(client, driveKeys.children('target'));
  expect(client.getQueryState(target)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  expect(client.getQueryState(publicKey)?.isInvalidated).toBe(false);
  client.clear();
});
