import { useMatches } from 'react-router';

/** Data attached to a route via `handle`, read by the shell (e.g. the header title). */
export interface RouteHandle {
  /** i18n key of the page title shown in the header. */
  titleKey: string;
  /** Optional i18n key shown under the title on wider screens. */
  subtitleKey?: string;
}

function isRouteHandle(value: unknown): value is RouteHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'titleKey' in value &&
    typeof value.titleKey === 'string'
  );
}

const FALLBACK_HANDLE: RouteHandle = { titleKey: 'app.name' };

/** The handle of the deepest matched route that defines one. */
export function useRouteHandle(): RouteHandle {
  const matches = useMatches();
  return (
    matches
      .map((match) => match.handle)
      .filter(isRouteHandle)
      .at(-1) ?? FALLBACK_HANDLE
  );
}
