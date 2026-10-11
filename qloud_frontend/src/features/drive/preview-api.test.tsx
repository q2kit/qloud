import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { PublicTokenContext } from '@/features/sharing/public-context';

import { api } from '@/lib/api/client';
import { FakeDrive } from '@/test/drive-server';

import { previewKey, usePreview, type PreviewLink } from './preview-api';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  ['image/png', 'image'],
  ['application/pdf', 'pdf'],
  ['video/mp4', 'video'],
] as const)('does not poll for a missing %s thumbnail', async (mime, kind) => {
  vi.useFakeTimers();
  const node = new FakeDrive().file('file', undefined, 20, mime);
  const link: PreviewLink = {
    kind,
    url: 'https://storage.example/source',
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    thumbnail: null,
  };
  const get = vi.spyOn(api, 'GET').mockResolvedValue({
    data: link,
    response: new Response(),
  });
  const client = new QueryClient();
  client.setQueryData(previewKey(node), link);
  const view = renderHook(() => usePreview(node, true, true), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(get).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});

it('refreshes an open viewer source near expiry even without a thumbnail', async () => {
  vi.useFakeTimers();
  const node = new FakeDrive().file('clip.mp4', undefined, 20, 'video/mp4');
  const link: PreviewLink = {
    kind: 'video',
    url: 'https://storage.example/source',
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    thumbnail: null,
  };
  const get = vi.spyOn(api, 'GET').mockImplementation(() =>
    Promise.resolve({
      data: {
        ...link,
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      },
      response: new Response(),
    }),
  );
  const client = new QueryClient();
  client.setQueryData(previewKey(node), link);
  const view = renderHook(() => usePreview(node), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(269_000);
  });
  expect(get).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(get).toHaveBeenCalledTimes(1);
  view.unmount();
  client.clear();
});

it('refreshes trash thumbnails using their expiry while source expiry is null', async () => {
  vi.useFakeTimers();
  const node = {
    ...new FakeDrive().file('photo.png', undefined, 20, 'image/png'),
    trashed_at: new Date().toISOString(),
  };
  const link: PreviewLink = {
    kind: 'image',
    url: null,
    expires_at: null,
    thumbnail: {
      url: 'https://storage.example/thumb',
      large_url: 'https://storage.example/large',
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    },
  };
  const get = vi
    .spyOn(api, 'GET')
    .mockResolvedValue({ data: link, response: new Response() });
  const client = new QueryClient();
  client.setQueryData([...previewKey(node), 'trash-thumbnail'], link);
  const view = renderHook(() => usePreview(node, true, true), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(269_000);
  });
  expect(get).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith(
    '/api/v1/nodes/{node_id}/preview',
    expect.objectContaining({
      params: {
        path: { node_id: node.id },
        query: { trashed_thumbnail: true },
      },
    }),
  );
  view.unmount();
  client.clear();
});

it('refreshes a public source using its token and keeps it separate from Drive cache', async () => {
  vi.useFakeTimers();
  const node = new FakeDrive().file('Public.mp4', undefined, 20, 'video/mp4');
  const link: PreviewLink = {
    kind: 'video',
    url: 'https://storage.example/public',
    expires_at: new Date(Date.now() + 300000).toISOString(),
    thumbnail: null,
  };
  const get = vi
    .spyOn(api, 'GET')
    .mockResolvedValue({ data: link, response: new Response() });
  const client = new QueryClient();
  client.setQueryData(previewKey(node), {
    ...link,
    url: 'https://storage.example/private',
  });
  client.setQueryData(
    ['public', 'token', 'preview', node.id, node.updated_at],
    link,
  );
  const view = renderHook(() => usePreview(node), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <PublicTokenContext value="token">{children}</PublicTokenContext>
      </QueryClientProvider>
    ),
  });
  expect(view.result.current.data?.url).toBe(link.url);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(270000);
  });
  expect(get).toHaveBeenCalledWith(
    '/api/v1/public/links/{token}/preview',
    expect.objectContaining({
      params: { path: { token: 'token' }, query: { node_id: node.id } },
    }),
  );
  expect(client.getQueryData<PreviewLink>(previewKey(node))?.url).toBe(
    'https://storage.example/private',
  );
  view.unmount();
  client.clear();
});
