import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import {
  cursorOf,
  driveKeys,
  refreshDriveQueries,
  type DriveNode,
  type DriveNodeDetail,
} from '@/features/drive/api';
import { useDriveStore } from '@/features/drive/store';
import { refreshStorage } from '@/features/storage/api';

export type FileVersion = components['schemas']['FileVersion'];
type Page = components['schemas']['PaginatedFileVersionList'];
type History = InfiniteData<Page, string | undefined>;
export const versionKey = (id: string) => ['versions', id] as const;

export function useVersions(id: string) {
  return useInfiniteQuery({
    queryKey: versionKey(id),
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}/versions', {
          params: { path: { node_id: id }, query: { cursor: pageParam } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
    retry: false,
  });
}

export async function refreshVersionNode(
  client: QueryClient,
  node: DriveNode,
  updated?: DriveNode,
) {
  const parents = new Set([node.parent_id, updated?.parent_id]);
  await Promise.all([
    refreshDriveQueries(client, versionKey(node.id)),
    refreshDriveQueries(client, driveKeys.node(node.id)),
    refreshDriveQueries(client, driveKeys.recent),
    refreshDriveQueries(client, ['drive', 'preview', node.id]),
    refreshDriveQueries(client, ['sharing', 'shared']),
    refreshDriveQueries(client, ['search']),
    refreshStorage(client),
    ...[...parents]
      .filter((id): id is string => Boolean(id))
      .map((id) => refreshDriveQueries(client, driveKeys.children(id))),
  ]);
}

export function useVersionChange(node: DriveNode) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      action,
      version,
    }: {
      action: 'restore' | 'delete';
      version: FileVersion;
    }) => {
      const params = { path: { node_id: node.id, version_id: version.id } };
      if (action === 'restore')
        return unwrap(
          await api.POST(
            '/api/v1/nodes/{node_id}/versions/{version_id}/restore',
            { params },
          ),
        );
      unwrap(
        await api.DELETE('/api/v1/nodes/{node_id}/versions/{version_id}', {
          params,
        }),
      );
      return undefined;
    },
    onMutate: async ({ action, version }) => {
      if (action !== 'delete') return undefined;
      await client.cancelQueries({ queryKey: versionKey(node.id) });
      const snapshot = client.getQueryData<History>(versionKey(node.id));
      client.setQueryData<History>(
        versionKey(node.id),
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              results: page.results.filter((item) => item.id !== version.id),
            })),
          },
      );
      return snapshot;
    },
    onError: (_error, variables, snapshot) => {
      if (variables.action === 'delete' && snapshot)
        client.setQueryData(versionKey(node.id), snapshot);
    },
    onSuccess: (updated) => {
      if (!updated) return;
      useDriveStore.getState().update([updated]);
      client.setQueryData<DriveNodeDetail>(
        driveKeys.node(node.id),
        (previous) => previous && { ...previous, ...updated },
      );
    },
    onSettled: (updated) => refreshVersionNode(client, node, updated),
  });
}

export async function downloadVersion(nodeId: string, versionId: string) {
  const link = unwrap(
    await api.GET('/api/v1/nodes/{node_id}/versions/{version_id}/download', {
      params: { path: { node_id: nodeId, version_id: versionId } },
    }),
  );
  window.location.assign(link.url);
}

export function useVersionRetention(nodeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (version: FileVersion) =>
      unwrap(
        await api.PATCH('/api/v1/nodes/{node_id}/versions/{version_id}', {
          params: { path: { node_id: nodeId, version_id: version.id } },
          body: { keep_forever: !version.keep_forever },
        }),
      ),
    onSuccess: (updated) => {
      client.setQueryData<History>(
        versionKey(nodeId),
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              results: page.results.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            })),
          },
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: versionKey(nodeId) }),
  });
}
