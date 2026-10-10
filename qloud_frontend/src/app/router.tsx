import { createBrowserRouter, type RouteObject } from 'react-router';

import { RedirectIfAuthenticated, RequireAuth } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/pages/login-page';
import { PasswordResetPage } from '@/features/auth/pages/password-reset-page';
import { PasswordResetRequestPage } from '@/features/auth/pages/password-reset-request-page';
import { SignupPage } from '@/features/auth/pages/signup-page';
import { VerifyEmailPage } from '@/features/auth/pages/verify-email-page';
import { SettingsPage } from '@/features/settings/settings-page';

import { AppLayout } from './layout';
import {
  DrivePage,
  NotFoundPage,
  RouteErrorPage,
  SectionPlaceholderPage,
} from './pages';
import { PublicLayout } from './public-layout';
import type { RouteHandle } from './route-handle';

type Section = 'recent' | 'shared' | 'trash';

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
        // Everything in the app shell needs a session (S-15 404 included).
        Component: RequireAuth,
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
              {
                path: 'settings',
                Component: SettingsPage,
                handle: {
                  titleKey: 'navigation.settings',
                } satisfies RouteHandle,
              },
              {
                path: '*',
                Component: NotFoundPage,
                handle: { titleKey: 'notFound.title' } satisfies RouteHandle,
              },
            ],
          },
        ],
      },
      {
        Component: PublicLayout,
        children: [
          {
            Component: RedirectIfAuthenticated,
            children: [
              { path: 'login', Component: LoginPage },
              { path: 'signup', Component: SignupPage },
            ],
          },
          // Opened from emails; they work whether or not someone is signed in.
          { path: 'verify-email/:key', Component: VerifyEmailPage },
          { path: 'password/reset', Component: PasswordResetRequestPage },
          { path: 'password/reset/:key', Component: PasswordResetPage },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
