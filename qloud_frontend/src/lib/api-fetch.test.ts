import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from './api-fetch';

describe('apiFetch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('includes credentials without a CSRF header for safe methods', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null));

    await apiFetch('/api/v1/health');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).has('X-CSRFToken')).toBe(false);
  });

  it('reads the CSRF cookie for unsafe methods', async () => {
    document.cookie = 'csrftoken=token%20value';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null));

    await apiFetch('/api/v1/items', { method: 'POST' });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-CSRFToken')).toBe('token value');
  });

  it('preserves an explicitly supplied CSRF header and credentials', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null));

    await apiFetch('/api/v1/items', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'X-CSRFToken': 'explicit' },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('X-CSRFToken')).toBe('explicit');
  });
});
