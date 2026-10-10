import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components, operations } from '@/lib/api/schema';

export type DriveNode = components['schemas']['Node'];
export type DriveNodeDetail = components['schemas']['NodeDetail'];
export type ChildrenPage = components['schemas']['PaginatedNodeList'];
export type Ordering = NonNullable<
  NonNullable<
    operations['nodes_children_list']['parameters']['query']
  >['ordering']
>;

export const ORDERINGS: readonly Ordering[] = [
  'name',
  '-name',
  'updated_at',
  '-updated_at',
  'size',
  '-size',
];
export const PAGE_SIZE = 100;

export const driveKeys = {
  all: ['drive'] as const,
  node: (id: string) => [...driveKeys.all, 'node', id] as const,
  children: (id: string) => [...driveKeys.all, 'children', id] as const,
  childrenSorted: (id: string, ordering: Ordering) =>
    [...driveKeys.children(id), ordering] as const,
};

/** The `cursor` of a `next` link, which is an absolute URL to the same endpoint. */
export function cursorOf(link: string | null | undefined): string | undefined {
  if (!link) return undefined;
  return new URL(link).searchParams.get('cursor') ?? undefined;
}

export function useNode(
  id: string | undefined,
): UseQueryResult<DriveNodeDetail> {
  return useQuery({
    queryKey: driveKeys.node(id ?? ''),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}', {
          params: { path: { node_id: id ?? '' } },
        }),
      ),
    enabled: Boolean(id),
  });
}

export function useChildren(
  folderId: string | undefined,
  ordering: Ordering,
): UseInfiniteQueryResult<InfiniteData<ChildrenPage, string | undefined>> {
  return useInfiniteQuery({
    queryKey: driveKeys.childrenSorted(folderId ?? '', ordering),
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}/children', {
          params: {
            path: { node_id: folderId ?? '' },
            query: { ordering, page_size: PAGE_SIZE, cursor: pageParam },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
    enabled: Boolean(folderId),
  });
}

export function useCreateFolder(): UseMutationResult<
  DriveNode,
  Error,
  { parentId: string; name: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ parentId, name }) =>
      unwrap(
        await api.POST('/api/v1/folders', {
          body: { parent_id: parentId, name },
        }),
      ),
    onSuccess: (folder) => {
      if (folder.parent_id) {
        void queryClient.invalidateQueries({
          queryKey: driveKeys.children(folder.parent_id),
        });
      }
    },
  });
}

type ChildrenData = InfiniteData<ChildrenPage, string | undefined>;

function renameInPages(
  data: ChildrenData | undefined,
  id: string,
  name: string,
) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      results: page.results.map((node) =>
        node.id === id ? { ...node, name } : node,
      ),
    })),
  };
}

interface RenameVariables {
  node: DriveNode;
  name: string;
}

/** Optimistic (ui-ux.md): the new name shows at once and is put back if the API refuses. */
export function useRename(): UseMutationResult<
  DriveNodeDetail,
  Error,
  RenameVariables,
  { snapshot: [readonly unknown[], ChildrenData | undefined][] }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ node, name }) =>
      unwrap(
        await api.PATCH('/api/v1/nodes/{node_id}', {
          params: { path: { node_id: node.id } },
          body: { name },
        }),
      ),
    onMutate: async ({ node, name }) => {
      const key = driveKeys.children(node.parent_id ?? '');
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueriesData<ChildrenData>({
        queryKey: key,
      });
      queryClient.setQueriesData<ChildrenData>({ queryKey: key }, (data) =>
        renameInPages(data, node.id, name),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(driveKeys.node(detail.id), detail);
    },
    onSettled: (_data, _error, { node }) => {
      // The server's order may differ (natural sort, collation): refetch to settle it.
      void queryClient.invalidateQueries({
        queryKey: driveKeys.children(node.parent_id ?? ''),
      });
      // Breadcrumbs below a renamed folder show its name.
      void queryClient.invalidateQueries({
        queryKey: [...driveKeys.all, 'node'],
      });
    },
  });
}

/** Ask for a short-lived link and let the browser download from storage. */
export async function downloadNode(id: string): Promise<void> {
  const link = unwrap(
    await api.GET('/api/v1/nodes/{node_id}/download', {
      params: { path: { node_id: id } },
    }),
  );
  window.location.assign(link.url);
}
