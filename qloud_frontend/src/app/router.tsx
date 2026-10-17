import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';

import { RedirectIfAuthenticated, RequireAuth } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/pages/login-page';
import { PasswordResetPage } from '@/features/auth/pages/password-reset-page';
import { PasswordResetRequestPage } from '@/features/auth/pages/password-reset-request-page';
import { SignupPage } from '@/features/auth/pages/signup-page';
import { VerifyEmailPage } from '@/features/auth/pages/verify-email-page';
import { FileLinkPage } from '@/features/drive/file-link-page';
import { DrivePage } from '@/features/drive/drive-page';
import { RecentPage } from '@/features/drive/recent-page';
import { TrashPage } from '@/features/trash/trash-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { StoragePage } from '@/features/storage/storage-page';

import { SearchPage } from '@/features/search/search-page';
import { SharedPage } from '@/features/sharing/shared-page';
import { PublicPage } from '@/features/sharing/public-page';
import { ModerationPage } from '@/features/moderation/moderation-page';

import { AppLayout } from './layout';
import { NotFoundPage, RouteErrorPage } from './pages';
import { PublicLayout } from './public-layout';
import type { RouteHandle } from './route-handle';

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
              { index: true, element: <Navigate to="/drive" replace /> },
              // S-05 (ui-ux.md): the root folder, then any folder by id.
              {
                path: 'drive',
                Component: DrivePage,
                handle: { titleKey: 'drive.title' } satisfies RouteHandle,
              },
              {
                path: 'drive/folders/:folderId',
                Component: DrivePage,
                handle: { titleKey: 'drive.title' } satisfies RouteHandle,
              },
              {
                path: 'drive/files/:fileId',
                Component: FileLinkPage,
                handle: { titleKey: 'preview.title' } satisfies RouteHandle,
              },
              {
                path: 'search',
                Component: SearchPage,
                handle: { titleKey: 'search.title' } satisfies RouteHandle,
              },
              {
                path: 'recent',
                Component: RecentPage,
                handle: { titleKey: 'navigation.recent' } satisfies RouteHandle,
              },
              {
                path: 'shared',
                Component: SharedPage,
                handle: { titleKey: 'navigation.shared' } satisfies RouteHandle,
              },
              // M8-22: what others share opens here, never under /drive.
              {
                path: 'shared/folders/:folderId',
                Component: DrivePage,
                handle: { titleKey: 'navigation.shared' } satisfies RouteHandle,
              },
              {
                path: 'shared/files/:fileId',
                Component: FileLinkPage,
                handle: { titleKey: 'preview.title' } satisfies RouteHandle,
              },
              {
                path: 'trash',
                Component: TrashPage,
                handle: { titleKey: 'navigation.trash' } satisfies RouteHandle,
              },
              {
                path: 'moderation',
                Component: ModerationPage,
                handle: {
                  titleKey: 'navigation.moderation',
                } satisfies RouteHandle,
              },
              {
                path: 'settings',
                Component: SettingsPage,
                handle: {
                  titleKey: 'navigation.settings',
                } satisfies RouteHandle,
              },
              {
                path: 'settings/storage',
                Component: StoragePage,
                handle: {
                  titleKey: 'navigation.storage',
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
          { path: 's/:token', Component: PublicPage },
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
