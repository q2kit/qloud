import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/errors';

// Same as TanStack Query's default: up to 3 retries after the first failure.
const MAX_QUERY_RETRIES = 3;

/**
 * Retry only failures that may be transient (network, 5xx). A 4xx means the
 * request itself is wrong or not allowed, so repeating it cannot succeed.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: shouldRetryQuery },
    },
  });
}
