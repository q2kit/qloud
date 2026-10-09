import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppLayout } from './layout';
import { DrivePage, LoginPage, NotFoundPage } from './pages';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, Component: DrivePage },
      { path: 'login', Component: LoginPage },
      { path: '*', Component: NotFoundPage },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
