import { useInfiniteQuery } from '@tanstack/react-query';
import { cursorOf } from '@/features/drive/api';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';

export type ActivityEvent = components['schemas']['AuditEvent'];
export type ActivityAction = components['schemas']['AuditEventActionEnum'];

export const activityKey = (id: string) => ['activity', id] as const;

/** The details panel's Activity tab (features/audit-log.md), loaded when it opens. */
export function useActivity(id: string) {
  return useInfiniteQuery({
    queryKey: activityKey(id),
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/nodes/{node_id}/activity', {
          params: { path: { node_id: id }, query: { cursor: pageParam } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
    // Every action writes an event: reopening the tab shows the latest ones.
    refetchOnMount: 'always',
    retry: false,
  });
}
