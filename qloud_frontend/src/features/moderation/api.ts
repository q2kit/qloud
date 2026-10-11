import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import { cursorOf } from '@/features/drive/api';

export type ReportReason = components['schemas']['ReportReasonEnum'];
export type ReportStatus = components['schemas']['ReportStatusEnum'];
export type ReportAction = components['schemas']['ModerationActionEnum'];
export type ReportDetail = components['schemas']['ReportDetail'];
export const reasons: ReportReason[] = [
  'illegal',
  'copyright',
  'malware',
  'abuse',
  'other',
];
export const actions: ReportAction[] = [
  'revoke_link',
  'revoke_node',
  'suspend_owner',
  'dismiss',
];
export function useCreateReport(token: string, nodeId: string) {
  return useMutation({
    mutationFn: async (
      body: Omit<components['schemas']['CreateReportRequest'], 'node_id'>,
    ) =>
      unwrap(
        await api.POST('/api/v1/public/links/{token}/reports', {
          params: { path: { token } },
          body: { ...body, node_id: nodeId },
        }),
      ),
  });
}
export function useReports(
  status: ReportStatus | undefined,
  enabled: boolean,
  nodeId?: string,
) {
  return useInfiniteQuery({
    queryKey: ['moderation', 'list', status, nodeId],
    enabled,
    retry: false,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/moderation/reports', {
          params: { query: { status, node_uuid: nodeId, cursor: pageParam } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
  });
}
export function useReport(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['moderation', 'detail', id],
    enabled: enabled && Boolean(id),
    retry: false,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/moderation/reports/{report_id}', {
          params: { path: { report_id: id ?? '' } },
          signal,
        }),
      ),
  });
}
export function useResolveReport(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: components['schemas']['ResolveReportRequest']) =>
      unwrap(
        await api.POST('/api/v1/moderation/reports/{report_id}/resolve', {
          params: { path: { report_id: id } },
          body,
        }),
      ),
    onSuccess: async (report) => {
      client.setQueryData(['moderation', 'detail', id], report);
      await client.invalidateQueries({ queryKey: ['moderation', 'list'] });
    },
  });
}
