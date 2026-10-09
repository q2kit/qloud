import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setMediaQuery } from '@/test/match-media';

import { ThemeProvider, useTheme } from './theme-provider';

const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';
const LIGHT_COLOR = '#fafaf9';
const DARK_COLOR = '#1c1917';

function ThemeProbe(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => {
        setTheme('dark');
      }}
    >
      {theme}
    </button>
  );
}

function renderProbe(): void {
  render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

function themeColor(): string | null {
  return (
    document
      .querySelector('meta[name="theme-color"]')
      ?.getAttribute('content') ?? null
  );
}

function dispatchStorage(key: string | null): void {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
}

beforeEach(() => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = LIGHT_COLOR;
  document.head.append(meta);
});

afterEach(() => {
  document.querySelector('meta[name="theme-color"]')?.remove();
  vi.restoreAllMocks();
});

describe('ThemeProvider', () => {
  it('uses system by default and persists a theme selection', async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(screen.getByRole('button')).toHaveTextContent('system');
    await user.click(screen.getByRole('button'));

    expect(localStorage.getItem('qloud-theme')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(themeColor()).toBe(DARK_COLOR);
  });

  it('loads a saved light preference', () => {
    localStorage.setItem('qloud-theme', 'light');
    setMediaQuery(DARK_MODE_QUERY, true);
    renderProbe();

    expect(screen.getByRole('button')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(themeColor()).toBe(LIGHT_COLOR);
  });

  it('follows the system theme live while set to system', () => {
    renderProbe();
    expect(document.documentElement).not.toHaveClass('dark');

    act(() => {
      setMediaQuery(DARK_MODE_QUERY, true);
    });
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(themeColor()).toBe(DARK_COLOR);

    act(() => {
      setMediaQuery(DARK_MODE_QUERY, false);
    });
    expect(document.documentElement).not.toHaveClass('dark');
    expect(themeColor()).toBe(LIGHT_COLOR);
  });

  it('ignores system changes when a theme is chosen explicitly', () => {
    localStorage.setItem('qloud-theme', 'light');
    renderProbe();

    act(() => {
      setMediaQuery(DARK_MODE_QUERY, true);
    });

    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('applies a theme chosen in another tab', () => {
    renderProbe();

    localStorage.setItem('qloud-theme', 'dark');
    dispatchStorage('qloud-theme');
    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');

    // Another tab cleared site data.
    localStorage.clear();
    dispatchStorage(null);
    expect(screen.getByRole('button')).toHaveTextContent('system');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('ignores storage events for other keys', () => {
    renderProbe();

    localStorage.setItem('qloud-theme', 'dark');
    dispatchStorage('qloud-language');

    expect(screen.getByRole('button')).toHaveTextContent('system');
  });

  it('falls back to system when storage cannot be read', () => {
    localStorage.setItem('qloud-theme', 'dark');
    renderProbe();
    expect(screen.getByRole('button')).toHaveTextContent('dark');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    dispatchStorage('qloud-theme');

    expect(screen.getByRole('button')).toHaveTextContent('system');
  });

  it('requires its provider', () => {
    expect(() => {
      render(<ThemeProbe />);
    }).toThrow('useTheme must be used within ThemeProvider');
  });
});
