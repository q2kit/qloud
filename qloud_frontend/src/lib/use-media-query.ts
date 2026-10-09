import * as React from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(
    () => window.matchMedia(query).matches,
  );

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateMatch = (): void => {
      setMatches(mediaQuery.matches);
    };

    updateMatch();
    mediaQuery.addEventListener('change', updateMatch);
    return () => {
      mediaQuery.removeEventListener('change', updateMatch);
    };
  }, [query]);

  return matches;
}
