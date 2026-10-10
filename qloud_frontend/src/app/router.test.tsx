import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '@/test/auth';

import { ThemeProvider } from './theme-provider';
import { appRoutes } from './router';

function renderRouter(
  memoryRouter: ReturnType<typeof createMemoryRouter>,
): void {
  const queryClient = createTestQueryClient();

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={memoryRouter} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('routing', () => {
  it('renders the 404 page for an unknown route', () => {
    renderRouter(
      createMemoryRouter(appRoutes, { initialEntries: ['/missing-page'] }),
    );

    expect(
      screen.getByRole('heading', {
        name: /Không tìm thấy trang|Page not found/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Về Drive|Back to Drive/ }),
    ).toHaveAttribute('href', '/drive');
  });

  it('renders the localized error page when a route throws', async () => {
    // React and React Router report the caught error to the console.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const [root] = appRoutes;
    function BrokenPage(): React.JSX.Element {
      throw new Error('render failed');
    }
    const memoryRouter = createMemoryRouter(
      [
        {
          // The app's own root boundary, plus one route that fails to render.
          ErrorBoundary: root?.ErrorBoundary,
          children: [
            ...(root?.children ?? []),
            { path: '/broken', Component: BrokenPage },
          ],
        },
      ],
      { initialEntries: ['/broken'] },
    );
    const user = userEvent.setup();

    renderRouter(memoryRouter);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /Đã xảy ra lỗi|Something went wrong/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Tải lại trang|Reload page/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();

    // Navigating away clears the error and brings the shell back.
    await user.click(
      screen.getByRole('link', { name: /Về Drive|Back to Drive/ }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('navigation', {
        name: /Điều hướng chính|Main navigation/,
      }),
    ).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
