import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { setMediaQuery } from '@/test/match-media';

import { createTestQueryClient } from '@/test/auth';

import { ThemeProvider } from './theme-provider';
import { appRoutes } from './router';

const DESKTOP_PANEL_QUERY = '(min-width: 1280px)';

function renderDrive(path = '/'): void {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const queryClient = createTestQueryClient();

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('application layout', () => {
  it('renders the primary navigation and the create menu', async () => {
    const user = userEvent.setup();
    renderDrive();

    expect(
      screen.getByRole('navigation', {
        name: /Điều hướng chính|Main navigation/,
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /^(Tạo mới|Create)$/ }),
    );
    expect(
      screen.getByRole('menuitem', { name: /Thư mục mới|New folder/ }),
    ).toBeInTheDocument();
  });

  it('opens and closes the details panel', async () => {
    const user = userEvent.setup();
    renderDrive();

    const trigger = screen.getByRole('button', {
      name: /Mở bảng chi tiết|Open details panel/,
    });
    await user.click(trigger);
    expect(
      screen.getByRole('dialog', { name: /Chi tiết|Details/ }),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: /Chi tiết|Details/ }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('shows details in a side panel on wide screens', async () => {
    setMediaQuery(DESKTOP_PANEL_QUERY, true);
    const user = userEvent.setup();
    renderDrive();

    await user.click(
      screen.getByRole('button', {
        name: /Mở bảng chi tiết|Open details panel/,
      }),
    );
    const panel = screen.getByRole('complementary', {
      name: /Chi tiết|Details/,
    });
    expect(
      within(panel).getByRole('heading', { name: /Chi tiết|Details/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(
      within(panel).getByRole('button', {
        name: /Đóng bảng chi tiết|Close details panel/,
      }),
    );
    expect(
      screen.queryByRole('complementary', { name: /Chi tiết|Details/ }),
    ).not.toBeInTheDocument();
  });

  it('moves open details into the bottom sheet when the screen narrows', async () => {
    setMediaQuery(DESKTOP_PANEL_QUERY, true);
    const user = userEvent.setup();
    renderDrive();
    await user.keyboard('i');
    expect(
      screen.getByRole('complementary', { name: /Chi tiết|Details/ }),
    ).toBeInTheDocument();

    act(() => {
      setMediaQuery(DESKTOP_PANEL_QUERY, false);
    });

    expect(
      screen.queryByRole('complementary', { name: /Chi tiết|Details/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: /Chi tiết|Details/ }),
    ).toBeInTheDocument();
  });

  it('opens and closes the mobile navigation drawer accessibly', async () => {
    const user = userEvent.setup();
    renderDrive();

    const trigger = screen.getByRole('button', {
      name: /Mở điều hướng|Open navigation/,
    });
    await user.click(trigger);
    expect(
      screen.getByRole('dialog', {
        name: /Điều hướng chính|Main navigation/,
      }),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', {
        name: /Điều hướng chính|Main navigation/,
      }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps application routes inside the shell', async () => {
    const user = userEvent.setup();
    renderDrive();

    await user.click(screen.getByRole('link', { name: /Gần đây|Recent/ }));
    expect(
      screen.getByRole('navigation', {
        name: /Điều hướng chính|Main navigation/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Gần đây|Recent/ }),
    ).toBeInTheDocument();
  });

  it('titles the header after the drive root', () => {
    renderDrive();

    const header = within(screen.getByRole('banner'));
    expect(header.getByText('Drive')).toBeInTheDocument();
    // jsdom's user agent is not an Apple platform.
    expect(header.getByText('Ctrl+K')).toBeInTheDocument();
  });

  it.each([
    ['/trash', /^(Thùng rác|Trash)$/],
    ['/settings', /^(Cài đặt|Settings)$/],
    ['/missing-page', /^(Không tìm thấy trang|Page not found)$/],
  ])('titles the header after the matched route %s', (path, title) => {
    renderDrive(path);

    const header = within(screen.getByRole('banner'));
    expect(header.getByText(title)).toBeInTheDocument();
    expect(header.queryByText('Drive')).not.toBeInTheDocument();
    expect(
      header.queryByText(/Drive của tôi|My Drive/),
    ).not.toBeInTheDocument();
  });

  it('highlights the settings link like the other navigation items', () => {
    renderDrive('/settings');

    const settings = screen.getByRole('link', { name: /Cài đặt|Settings/ });
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(settings).toHaveClass('bg-sidebar-accent');
    expect(
      screen.getByRole('link', { name: /Gần đây|Recent/ }),
    ).not.toHaveClass('bg-sidebar-accent');
  });

  it('toggles the details panel with the i shortcut', async () => {
    const user = userEvent.setup();
    renderDrive();

    await user.keyboard('i');
    expect(
      screen.getByRole('dialog', { name: /Chi tiết|Details/ }),
    ).toBeInTheDocument();

    await user.keyboard('i');
    expect(
      screen.queryByRole('dialog', { name: /Chi tiết|Details/ }),
    ).not.toBeInTheDocument();
  });

  it('does not toggle details while typing in editable controls', () => {
    renderDrive();
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(select, editable);

    fireEvent.keyDown(select, { key: 'i' });
    fireEvent.keyDown(editable, { key: 'i' });

    expect(
      screen.queryByRole('dialog', { name: /Chi tiết|Details/ }),
    ).not.toBeInTheDocument();
  });
});

describe('details shortcut', () => {
  it.each(['', 'true', 'plaintext-only'])(
    'ignores i typed inside contenteditable="%s"',
    async (value) => {
      const user = userEvent.setup();
      renderDrive();
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', value);
      editor.tabIndex = 0;
      document.body.append(editor);
      editor.focus();

      await user.keyboard('i');

      expect(
        screen.queryByRole('region', { name: /Chi tiết|Details/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      editor.remove();
    },
  );

  it.each(['menu', 'menuitem', 'listbox'])(
    'leaves i to typeahead inside role="%s"',
    (role) => {
      renderDrive();
      const container = document.createElement('div');
      container.setAttribute('role', role);
      const item = document.createElement('span');
      container.append(item);
      document.body.append(container);

      fireEvent.keyDown(item, { key: 'i' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      container.remove();
    },
  );

  it('ignores auto-repeated and already handled key presses', () => {
    renderDrive();
    const handled = document.createElement('div');
    handled.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    document.body.append(handled);

    fireEvent.keyDown(document.body, { key: 'i', repeat: true });
    fireEvent.keyDown(handled, { key: 'i' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    handled.remove();
  });

  it('does not stack details on top of the navigation drawer', async () => {
    const user = userEvent.setup();
    renderDrive();
    await user.click(
      screen.getByRole('button', { name: /Mở điều hướng|Open navigation/ }),
    );

    await user.keyboard('i');

    expect(
      screen.getByRole('dialog', { name: /Điều hướng chính|Main navigation/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: /Chi tiết|Details/ }),
    ).not.toBeInTheDocument();
  });

  it('closes the mobile details sheet from inside it', async () => {
    const user = userEvent.setup();
    renderDrive();
    await user.keyboard('i');
    const sheet = screen.getByRole('dialog', { name: /Chi tiết|Details/ });
    expect(sheet).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('i');

    expect(
      screen.queryByRole('dialog', { name: /Chi tiết|Details/ }),
    ).not.toBeInTheDocument();
  });

  it('toggles the desktop side panel', async () => {
    setMediaQuery(DESKTOP_PANEL_QUERY, true);
    const user = userEvent.setup();
    renderDrive();

    await user.keyboard('i');
    expect(
      screen.getByRole('complementary', { name: /Chi tiết|Details/ }),
    ).toBeInTheDocument();

    await user.keyboard('i');
    expect(
      screen.queryByRole('complementary', { name: /Chi tiết|Details/ }),
    ).not.toBeInTheDocument();
  });
});
