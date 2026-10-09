import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';

export type HealthResponse = components['schemas']['Health'];

async function getHealth(): Promise<HealthResponse> {
  return unwrap(await api.GET('/api/v1/health'));
}

export function useHealth(): UseQueryResult<HealthResponse> {
  return useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    retry: false,
    staleTime: 30_000,
  });
}
