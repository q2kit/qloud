import * as React from 'react';

import { readStorage, writeStorage } from '@/lib/storage';

export type Theme = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'qloud-theme';
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';
// Browser UI color per resolved theme: `--background` in index.css. Keep in
// sync with the pre-paint script in index.html.
const THEME_COLORS = { light: '#fafaf9', dark: '#1c1917' } as const;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
  undefined,
);

function isTheme(value: string | null): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function getStoredTheme(): Theme {
  const storedTheme = readStorage(THEME_STORAGE_KEY);
  return isTheme(storedTheme) ? storedTheme : 'system';
}

function applyTheme(theme: Theme, prefersDark: boolean): void {
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', isDark ? THEME_COLORS.dark : THEME_COLORS.light);
}

export function ThemeProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const [theme, setThemeState] = React.useState<Theme>(getStoredTheme);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MODE_QUERY);
    const updateTheme = (): void => {
      applyTheme(theme, mediaQuery.matches);
    };

    updateTheme();
    mediaQuery.addEventListener('change', updateTheme);
    return () => {
      mediaQuery.removeEventListener('change', updateTheme);
    };
  }, [theme]);

  // Follow a theme picked in another tab. `key` is null when storage is cleared.
  React.useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        setThemeState(getStoredTheme());
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setTheme = React.useCallback((nextTheme: Theme): void => {
    writeStorage(THEME_STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
  }, []);

  const value = React.useMemo(() => ({ theme, setTheme }), [setTheme, theme]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

// The provider and its hook belong together as one public module.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = React.use(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
