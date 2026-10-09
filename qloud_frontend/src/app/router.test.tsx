import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from './theme-provider';
import { appRoutes } from './router';

describe('routing', () => {
  it('renders the 404 page for an unknown route', () => {
    const memoryRouter = createMemoryRouter(appRoutes, {
      initialEntries: ['/missing-page'],
    });
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={memoryRouter} />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole('heading', {
        name: /Không tìm thấy trang|Page not found/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Về Drive|Back to Drive/ }),
    ).toHaveAttribute('href', '/');
  });
});
