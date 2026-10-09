import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { createQueryClient } from '@/lib/query-client';

import { ThemeProvider } from './theme-provider';

const queryClient = createQueryClient();

export function AppProviders({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
