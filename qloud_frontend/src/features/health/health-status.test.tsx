import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '@/lib/i18n';

import { HealthStatus } from './health-status';

const server = setupServer(
  http.get('/api/v1/health', () =>
    HttpResponse.json({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok' },
    }),
  ),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function renderStatus(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <HealthStatus />
    </QueryClientProvider>,
  );
}

describe('HealthStatus', () => {
  it('shows the pending state and then the healthy state', async () => {
    renderStatus();
    expect(screen.getByRole('status')).toHaveTextContent(
      /Đang kiểm tra|Checking/,
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /Hoạt động bình thường|All systems operational/,
      );
    });
  });

  it('shows an error when the health request fails', async () => {
    server.use(
      http.get('/api/v1/health', () => new HttpResponse(null, { status: 503 })),
    );
    renderStatus();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /Không thể kết nối|Unable to connect/,
      );
    });
  });
});
