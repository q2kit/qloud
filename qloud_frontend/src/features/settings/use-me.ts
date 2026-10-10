import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';

export type Me = components['schemas']['Me'];
export type MeUpdate = components['schemas']['PatchedMeRequest'];

export const meQueryKey = ['me'] as const;

export function useMe(enabled = true): UseQueryResult<Me> {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => unwrap(await api.GET('/api/v1/me')),
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdateMe(): UseMutationResult<Me, Error, MeUpdate> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body) => unwrap(await api.PATCH('/api/v1/me', { body })),
    onSuccess: (me) => {
      queryClient.setQueryData(meQueryKey, me);
      // The session carries the display name shown in the account menu.
      void queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });
}
