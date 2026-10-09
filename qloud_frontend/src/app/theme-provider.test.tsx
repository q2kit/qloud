import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ThemeProvider, useTheme } from './theme-provider';

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

describe('ThemeProvider', () => {
  it('uses system by default and persists a theme selection', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button')).toHaveTextContent('system');
    await user.click(screen.getByRole('button'));

    expect(localStorage.getItem('qloud-theme')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('loads a saved light preference', () => {
    localStorage.setItem('qloud-theme', 'light');
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('requires its provider', () => {
    expect(() => {
      render(<ThemeProbe />);
    }).toThrow('useTheme must be used within ThemeProvider');
  });
});
