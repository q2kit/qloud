import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';

export type AppConfig = components['schemas']['PublicConfig'];

/** Runtime settings from GET /api/v1/config (e.g. the Turnstile site key). */
export function useAppConfig(): UseQueryResult<AppConfig> {
  return useQuery({
    queryKey: ['config'],
    queryFn: async () => unwrap(await api.GET('/api/v1/config')),
    staleTime: Infinity,
  });
}
