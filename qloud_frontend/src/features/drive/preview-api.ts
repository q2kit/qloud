import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';

import type { DriveNode } from './api';

export type PreviewLink = components['schemas']['PreviewLink'];
export const previewKey = (node: Pick<DriveNode, 'id' | 'updated_at'>) =>
  ['drive', 'preview', node.id, node.updated_at] as const;

export function refreshDelay(link: PreviewLink): number | false {
  if (!link.expires_at) return false;
  return Math.max(1000, Date.parse(link.expires_at) - Date.now() - 30_000);
}

export function usePreview(
  node: DriveNode | undefined,
  enabled = true,
  thumbnailOnly = false,
) {
  const trashed = Boolean(node && 'trashed_at' in node && node.trashed_at);
  return useQuery({
    queryKey: node
      ? trashed
        ? [...previewKey(node), 'trash-thumbnail']
        : previewKey(node)
      : ['drive', 'preview', ''],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}/preview', {
          params: {
            path: { node_id: node?.id ?? '' },
            query: trashed ? { trashed_thumbnail: true } : undefined,
          },
          signal,
        }),
      ),
    enabled: enabled && node?.kind === 'file' && (!trashed || thumbnailOnly),
    staleTime: 210_000,
    retry: 1,
    refetchInterval: (query) => {
      const link = query.state.data;
      if (!link) return false;
      if (thumbnailOnly && !link.thumbnail) return false;
      return refreshDelay(
        thumbnailOnly
          ? { ...link, expires_at: link.thumbnail?.expires_at ?? null }
          : link,
      );
    },
  });
}
