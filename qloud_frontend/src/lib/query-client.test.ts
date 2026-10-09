import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';

import { createQueryClient, shouldRetryQuery } from './query-client';

describe('shouldRetryQuery', () => {
  it.each([400, 401, 403, 404, 409, 413, 429, 499])(
    'does not retry an ApiError with status %i',
    (status) => {
      expect(shouldRetryQuery(0, new ApiError(status, null))).toBe(false);
    },
  );

  it.each([
    ['a 5xx ApiError', new ApiError(503, null)],
    ['a network error', new TypeError('Failed to fetch')],
    ['an unknown value', 'boom'],
  ])('retries %s up to three times', (_label, error) => {
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(true);
    expect(shouldRetryQuery(3, error)).toBe(false);
  });

  it('is the default retry policy of the app query client', () => {
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(
      shouldRetryQuery,
    );
  });
});
