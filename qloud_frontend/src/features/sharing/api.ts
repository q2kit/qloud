import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import { cursorOf, type Ordering } from '@/features/drive/api';

export type ShareRole = components['schemas']['ShareRoleEnum'];
export const sharingKeys = {
  all: ['sharing'] as const,
  shares: (id: string) => ['sharing', 'shares', id] as const,
  links: (id: string) => ['sharing', 'links', id] as const,
  access: (id: string) => ['sharing', 'access', id] as const,
};
export function useShares(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: sharingKeys.shares(id),
    enabled,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}/shares', {
          params: { path: { node_id: id }, query: { cursor: pageParam } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
    retry: false,
  });
}
/** Grants on the node and on the ancestors the caller can see (M8-10 tab). */
export function useAccess(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: sharingKeys.access(id),
    enabled,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}/shares', {
          params: {
            path: { node_id: id },
            query: { cursor: pageParam, include_inherited: true },
          },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
    retry: false,
  });
}
export function useLinks(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: sharingKeys.links(id),
    enabled,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}/links', {
          params: { path: { node_id: id }, query: { cursor: pageParam } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
    retry: false,
  });
}
type Change =
  | { kind: 'add'; email: string; role: ShareRole }
  | { kind: 'role'; id: string; role: ShareRole }
  | { kind: 'remove'; id: string }
  | { kind: 'link'; expires_at: string | null }
  | { kind: 'revoke'; id: string };
export function useSharingChange(nodeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change) => {
      switch (change.kind) {
        case 'add':
          return unwrap(
            await api.POST('/api/v1/nodes/{node_id}/shares', {
              params: { path: { node_id: nodeId } },
              body: { email: change.email, role: change.role },
            }),
          );
        case 'role':
          return unwrap(
            await api.PATCH('/api/v1/shares/{share_id}', {
              params: { path: { share_id: change.id } },
              body: { role: change.role },
            }),
          );
        case 'remove': {
          unwrap(
            await api.DELETE('/api/v1/shares/{share_id}', {
              params: { path: { share_id: change.id } },
            }),
          );
          return;
        }
        case 'link':
          return unwrap(
            await api.POST('/api/v1/nodes/{node_id}/links', {
              params: { path: { node_id: nodeId } },
              body: { expires_at: change.expires_at },
            }),
          );
        case 'revoke': {
          unwrap(
            await api.DELETE('/api/v1/links/{link_id}', {
              params: { path: { link_id: change.id } },
            }),
          );
          return;
        }
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: sharingKeys.all });
      await client.invalidateQueries({ queryKey: ['drive'] });
    },
  });
}
export function useShared(ordering: Ordering) {
  return useInfiniteQuery({
    queryKey: ['sharing', 'shared', ordering],
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/shared-with-me', {
          params: { query: { ordering, cursor: pageParam, page_size: 100 } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
  });
}
export function usePublicChildren(
  token: string,
  folderId: string | undefined,
  ordering: Ordering,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ['public', token, 'children', folderId, ordering],
    enabled,
    queryFn: async ({ pageParam, signal }) => {
      const page = unwrap(
        await api.GET('/api/v1/public/links/{token}/children', {
          params: {
            path: { token },
            query: {
              folder_id: folderId,
              ordering,
              cursor: pageParam,
              page_size: 100,
            },
          },
          signal,
        }),
      );
      return {
        ...page,
        results: page.results.map((node) => ({ ...node, is_root: false })),
      };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
    retry: false,
  });
}
