import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { ThemeProvider } from '@/app/theme-provider';
import { appRoutes } from '@/app/router';
import type { AuthUser } from '@/features/auth/api';

import { createTestQueryClient } from './auth';

/** Render the real route tree at `path`, with `user` signed in (or no one). */
export function renderApp(
  path: string,
  user: AuthUser | null = null,
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createTestQueryClient(user)}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return router;
}
