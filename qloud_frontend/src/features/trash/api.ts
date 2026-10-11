import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import {
  cursorOf,
  driveKeys,
  type ChildrenPage,
  type Ordering,
} from '@/features/drive/api';
import { useTrashNotice } from './notice';

export type TrashNode = components['schemas']['TrashNode'];
export const trashKey = ['trash'] as const;

export function useTrash(ordering: Ordering) {
  return useInfiniteQuery({
    queryKey: [...trashKey, ordering],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/api/v1/trash', {
          params: { query: { ordering, page_size: 100, cursor: pageParam } },
        }),
      ),
    getNextPageParam: (page) => cursorOf(page.next),
  });
}

export function useTrashNodes() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      unwrap(
        await api.POST('/api/v1/nodes/trash', {
          body: { node_ids: ids },
        }),
      ).nodes,
    onMutate: async (ids) => {
      const filter = {
        queryKey: driveKeys.all,
        predicate: (query: { queryKey: readonly unknown[] }) =>
          query.queryKey[1] === 'children' || query.queryKey[1] === 'recent',
      };
      await client.cancelQueries(filter);
      const snapshots =
        client.getQueriesData<InfiniteData<ChildrenPage>>(filter);
      const removed = new Set(ids);
      client.setQueriesData<InfiniteData<ChildrenPage>>(
        filter,
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              results: page.results.filter((node) => !removed.has(node.id)),
            })),
          },
      );
      return { snapshots };
    },
    onError: (_error, _ids, context) => {
      for (const [key, data] of context?.snapshots ?? [])
        client.setQueryData(key, data);
    },
    onSuccess: (roots) => {
      useTrashNotice.getState().show(roots.map((node) => node.id));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: driveKeys.all });
      void client.invalidateQueries({ queryKey: trashKey });
    },
  });
}

export function useRestoreTrash() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      unwrap(
        await api.POST('/api/v1/trash/restore', { body: { node_ids: ids } }),
      ).nodes,
    onSuccess: (_data, ids) => {
      useTrashNotice.getState().forget(ids);
      void client.invalidateQueries({ queryKey: driveKeys.all });
      void client.invalidateQueries({ queryKey: trashKey });
    },
  });
}

export function useDeleteTrash() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | null) => {
      if (ids === null) unwrap(await api.POST('/api/v1/trash/empty'));
      else
        unwrap(
          await api.POST('/api/v1/trash/delete', { body: { node_ids: ids } }),
        );
    },
    onSuccess: (_data, ids) => {
      void client.invalidateQueries({ queryKey: trashKey });
      void client.invalidateQueries({ queryKey: ['me'] });
      if (ids === null) useTrashNotice.getState().clear();
      else useTrashNotice.getState().forget(ids);
    },
  });
}
