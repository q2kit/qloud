import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { csrfMiddleware, getCookie } from './client';
import { ApiError, unwrap } from './errors';

const seen: { method: string; csrf: string | null; credentials: string }[] = [];
const server = setupServer(
  http.all('*/api/v1/echo', ({ request }) => {
    seen.push({
      method: request.method,
      csrf: request.headers.get('X-CSRFToken'),
      credentials: request.credentials,
    });
    return HttpResponse.json({});
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});
afterAll(() => {
  server.close();
});

async function send(init: RequestInit): Promise<void> {
  const request = new Request(`${window.location.origin}/api/v1/echo`, init);
  const prepared = await csrfMiddleware.onRequest?.({
    request,
    schemaPath: '/api/v1/echo',
    params: {},
    options: {} as never,
    id: '1',
  });
  await fetch(prepared instanceof Request ? prepared : request);
}

describe('csrfMiddleware', () => {
  it('does not add a CSRF header to safe methods', async () => {
    document.cookie = 'csrftoken=abc';
    await send({ method: 'GET' });

    expect(seen[0]?.csrf).toBeNull();
  });

  it('adds the CSRF cookie value to unsafe methods', async () => {
    document.cookie = 'csrftoken=token%20value';
    await send({ method: 'POST' });

    expect(seen[0]?.csrf).toBe('token value');
  });

  it('keeps an explicitly supplied CSRF header', async () => {
    document.cookie = 'csrftoken=from-cookie';
    await send({ method: 'DELETE', headers: { 'X-CSRFToken': 'explicit' } });

    expect(seen[0]?.csrf).toBe('explicit');
  });

  it('reads cookies by exact name', () => {
    document.cookie = 'xcsrftoken=wrong';
    document.cookie = 'csrftoken=right';

    expect(getCookie('csrftoken')).toBe('right');
  });
});

describe('unwrap', () => {
  it('returns data for successful responses', () => {
    expect(
      unwrap({ data: { ok: true }, response: new Response(null) }),
    ).toEqual({
      ok: true,
    });
  });

  it('throws ApiError with the unified error code', () => {
    const error = {
      error: {
        code: 'quota_exceeded',
        message: 'Quota exceeded',
        details: { used: 1 },
      },
    };

    expect(() =>
      unwrap({ error, response: new Response(null, { status: 413 }) }),
    ).toThrow(
      expect.objectContaining({
        status: 413,
        code: 'quota_exceeded',
        message: 'Quota exceeded',
        details: { used: 1 },
      }) as ApiError,
    );
  });

  it('falls back to a generic error for unexpected bodies', () => {
    expect(() =>
      unwrap({ error: 'boom', response: new Response(null, { status: 500 }) }),
    ).toThrow(
      expect.objectContaining({ status: 500, code: 'error' }) as ApiError,
    );
  });
});
