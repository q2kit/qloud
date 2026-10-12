import {
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import { cursorOf, type DriveNodeDetail } from '@/features/drive/api';
import { meQueryKey, type Me } from '@/features/settings/use-me';

export type StorageUsage = components['schemas']['StorageUsage'];
export type StorageGroup = keyof StorageUsage['breakdown'];

/** Under `me`, so code refreshing the account also refreshes its storage. */
export const storageKeys = {
  usage: [...meQueryKey, 'storage'] as const,
  largest: [...meQueryKey, 'storage', 'largest'] as const,
};

export const STORAGE_GROUPS = [
  'document',
  'image',
  'video',
  'audio',
  'archive',
  'other',
  'old_versions',
  'trash',
] as const satisfies readonly StorageGroup[];

export const WARNING_RATIO = 0.8;
export const CRITICAL_RATIO = 0.95;
export type StorageLevel = 'normal' | 'warning' | 'critical' | 'full';

/** quota.md: warn from 80%, alert from 95%, block uploads once full. */
export function storageLevel(usage: StorageUsage): StorageLevel {
  if (usage.used_bytes >= usage.quota_bytes) return 'full';
  const ratio = usage.used_bytes / usage.quota_bytes;
  if (ratio >= CRITICAL_RATIO) return 'critical';
  if (ratio >= WARNING_RATIO) return 'warning';
  return 'normal';
}

export function useStorage() {
  return useQuery({
    queryKey: storageKeys.usage,
    queryFn: async () => unwrap(await api.GET('/api/v1/me/storage')),
    staleTime: 30_000,
  });
}

export function useLargestFiles() {
  return useInfiniteQuery({
    queryKey: storageKeys.largest,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/me/storage/largest', {
          params: { query: { cursor: pageParam, page_size: 20 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => cursorOf(page.next),
  });
}

export function refreshStorage(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: storageKeys.usage });
}

/**
 * Uploads into the user's own Drive are blocked once full. A folder someone else
 * shares uses their quota, so the server decides there (413 `quota_exceeded`).
 */
export function isUploadBlocked(
  usage: StorageUsage | undefined,
  me: Me | undefined,
  folder: DriveNodeDetail | undefined,
): boolean {
  if (!usage || !me || !folder || storageLevel(usage) !== 'full') return false;
  const top = folder.breadcrumb[0]?.id ?? folder.id;
  return top === me.root_folder_id;
}
