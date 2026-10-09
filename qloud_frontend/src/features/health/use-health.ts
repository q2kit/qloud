import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiFetch } from '@/lib/api-fetch';

export interface HealthResponse {
  status: 'ok';
  checks: {
    database: 'ok';
    redis: 'ok';
  };
}

async function getHealth(): Promise<HealthResponse> {
  const response = await apiFetch('/api/v1/health');
  if (!response.ok) {
    throw new Error(
      `Health request failed with status ${String(response.status)}`,
    );
  }
  return response.json() as Promise<HealthResponse>;
}

export function useHealth(): UseQueryResult<HealthResponse> {
  return useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    retry: false,
    staleTime: 30_000,
  });
}
