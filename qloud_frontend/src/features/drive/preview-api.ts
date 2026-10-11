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
  return useQuery({
    queryKey: node ? previewKey(node) : ['drive', 'preview', ''],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}/preview', {
          params: { path: { node_id: node?.id ?? '' } },
          signal,
        }),
      ),
    enabled: enabled && node?.kind === 'file',
    staleTime: 210_000,
    retry: 1,
    refetchInterval: (query) => {
      const link = query.state.data;
      if (!link) return false;
      if (
        !link.thumbnail &&
        (link.kind === 'image' ||
          link.kind === 'pdf' ||
          (node?.mime_type?.split(';')[0]?.trim().toLowerCase() ===
            'video/mp4' &&
            link.kind === 'video')) &&
        query.state.dataUpdateCount < 7
      )
        return 5000;
      if (thumbnailOnly && !link.thumbnail) return false;
      return refreshDelay(link);
    },
  });
}
