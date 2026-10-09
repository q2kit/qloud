import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppLayout } from './layout';
import {
  DrivePage,
  LoginPage,
  NotFoundPage,
  SectionPlaceholderPage,
} from './pages';
import { PublicLayout } from './public-layout';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, Component: DrivePage },
      {
        path: 'recent',
        element: (
          <SectionPlaceholderPage
            titleKey="navigation.recent"
            descriptionKey="placeholder.recent"
          />
        ),
      },
      {
        path: 'shared',
        element: (
          <SectionPlaceholderPage
            titleKey="navigation.shared"
            descriptionKey="placeholder.shared"
          />
        ),
      },
      {
        path: 'trash',
        element: (
          <SectionPlaceholderPage
            titleKey="navigation.trash"
            descriptionKey="placeholder.trash"
          />
        ),
      },
      {
        path: 'settings',
        element: (
          <SectionPlaceholderPage
            titleKey="navigation.settings"
            descriptionKey="placeholder.settings"
          />
        ),
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
  {
    Component: PublicLayout,
    children: [{ path: 'login', Component: LoginPage }],
  },
];

export const router = createBrowserRouter(appRoutes);
