import { useLocation } from 'react-router';

import { useMediaQuery } from '@/lib/use-media-query';

/** The sidebar becomes a drawer below `lg`; the "+" button lives there too. */
const DESKTOP_SHELL_QUERY = '(min-width: 1024px)';

// Pages that list files (ui-ux.md › Responsive). Trash, settings, moderation
// and the file viewer keep the header button only.
function isListingPage(pathname: string): boolean {
  return (
    pathname === '/drive' ||
    pathname.startsWith('/drive/folders/') ||
    pathname === '/shared' ||
    pathname.startsWith('/shared/folders/') ||
    pathname === '/recent' ||
    pathname === '/search'
  );
}

/** Whether the floating "+" replaces the header "Create" button on this page. */
export function useShowCreateFab(): boolean {
  const { pathname } = useLocation();
  const isDesktopShell = useMediaQuery(DESKTOP_SHELL_QUERY);
  return !isDesktopShell && isListingPage(pathname);
}
