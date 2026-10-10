import { QueryClient } from '@tanstack/react-query';

import type { AuthSession, AuthUser } from '@/features/auth/api';
import { sessionQueryKey } from '@/features/auth/use-auth';

export const testUser: AuthUser = {
  id: '0190c0de-0000-7000-8000-000000000001',
  display: 'Alice Nguyen',
  email: 'alice@example.com',
  has_usable_password: true,
};

/** A query client with a session already cached, as after signing in. */
export function createTestQueryClient(
  user: AuthUser | null = testUser,
): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData<AuthSession>(sessionQueryKey, { user, flows: [] });
  return queryClient;
}
