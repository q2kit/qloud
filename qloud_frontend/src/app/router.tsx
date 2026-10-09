import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppLayout } from './layout';
import {
  DrivePage,
  LoginPage,
  NotFoundPage,
  RouteErrorPage,
  SectionPlaceholderPage,
} from './pages';
import { PublicLayout } from './public-layout';
import type { RouteHandle } from './route-handle';

type Section = 'recent' | 'shared' | 'trash' | 'settings';

function sectionPlaceholderRoute(section: Section): RouteObject {
  const handle: RouteHandle = { titleKey: `navigation.${section}` };
  return {
    path: section,
    handle,
    element: (
      <SectionPlaceholderPage
        titleKey={handle.titleKey}
        descriptionKey={`placeholder.${section}`}
      />
    ),
  };
}

export const appRoutes: RouteObject[] = [
  {
    // Pathless root: catches render and loader errors from every route below,
    // replacing React Router's built-in (English-only) error screen.
    ErrorBoundary: RouteErrorPage,
    children: [
      {
        path: '/',
        Component: AppLayout,
        children: [
          {
            index: true,
            Component: DrivePage,
            handle: {
              titleKey: 'drive.title',
              subtitleKey: 'shell.breadcrumbRoot',
            } satisfies RouteHandle,
          },
          sectionPlaceholderRoute('recent'),
          sectionPlaceholderRoute('shared'),
          sectionPlaceholderRoute('trash'),
          sectionPlaceholderRoute('settings'),
          {
            path: '*',
            Component: NotFoundPage,
            handle: { titleKey: 'notFound.title' } satisfies RouteHandle,
          },
        ],
      },
      {
        Component: PublicLayout,
        children: [{ path: 'login', Component: LoginPage }],
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
