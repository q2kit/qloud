import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from './theme-provider';
import { appRoutes } from './router';

function renderDrive(path = '/'): void {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('application layout', () => {
  it('renders the primary navigation and drive actions', () => {
    renderDrive();

    expect(
      screen.getByRole('navigation', {
        name: /Điều hướng chính|Main navigation/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Tải tệp lên|Upload files/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Thư mục mới|New folder/ }),
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
    expect(header.getByText(/Drive của tôi|My Drive/)).toBeInTheDocument();
    // jsdom's user agent is not an Apple platform.
    expect(header.getByText('Ctrl K')).toBeInTheDocument();
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
});
