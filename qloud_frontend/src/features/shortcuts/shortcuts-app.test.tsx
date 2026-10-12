import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { DESKTOP_INPUT_QUERY } from '@/features/drive/desktop-input';
import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive } from '@/test/drive-server';
import { setMediaQuery } from '@/test/match-media';
import { renderApp } from '@/test/render-app';

const server = setupServer();
let drive: FakeDrive;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});
beforeEach(async () => {
  setMediaQuery(DESKTOP_INPUT_QUERY, true);
  drive = new FakeDrive();
  server.use(...drive.handlers());
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe('keyboard shortcuts (M8-08)', () => {
  it('? lists every group, and the palette offers the same sheet', async () => {
    const user = userEvent.setup();
    drive.file('report.pdf');
    renderApp('/drive', testUser);
    await screen.findByRole('option', { name: 'report.pdf' });

    await user.keyboard('?');
    const sheet = await screen.findByRole('dialog', {
      name: 'Keyboard shortcuts',
    });
    for (const group of [
      'General',
      'Navigation',
      'Selection',
      'Item actions',
      'File viewer',
    ])
      expect(
        within(sheet).getByRole('heading', { name: group }),
      ).toBeInTheDocument();
    expect(within(sheet).getByText('Go to Trash')).toBeInTheDocument();
    expect(within(sheet).getByText('Rename')).toBeInTheDocument();
    await user.keyboard('?');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await user.keyboard('/');
    const palette = await screen.findByRole('dialog', {
      name: 'Search and commands',
    });
    // Typing in the palette never triggers single-key shortcuts.
    await user.keyboard('s?');
    expect(within(palette).getByRole('combobox')).toHaveValue('s?');
    await user.clear(within(palette).getByRole('combobox'));
    await user.click(
      within(palette).getByRole('option', { name: 'Keyboard shortcuts' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeInTheDocument();
  });

  it('creates a folder with Shift+N in the Drive only', async () => {
    const user = userEvent.setup();
    renderApp('/recent', testUser);
    await screen.findByRole('heading', { name: 'Recent' });
    await user.keyboard('{Shift>}N{/Shift}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.keyboard('gd');
    await user.keyboard('{Shift>}N{/Shift}');
    expect(
      await screen.findByRole('dialog', { name: 'New folder' }),
    ).toBeInTheDocument();
  });

  it('G then T opens the trash; V switches the view', async () => {
    const user = userEvent.setup();
    drive.file('report.pdf');
    const router = renderApp('/drive', testUser);
    await screen.findByRole('option', { name: 'report.pdf' });

    const list = screen.getByRole('button', { name: 'List view' });
    expect(list).toHaveAttribute('aria-keyshortcuts', 'V');
    await user.keyboard('v');
    expect(list).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('v');
    expect(list).toHaveAttribute('aria-pressed', 'false');

    await user.keyboard('gt');
    expect(router.state.location.pathname).toBe('/trash');
  });

  it('S shares exactly one selected item, through the same checks as the menu', async () => {
    const user = userEvent.setup();
    drive.file('a.txt');
    drive.file('b.txt');
    renderApp('/drive', testUser);
    const first = await screen.findByRole('option', { name: 'a.txt' });

    await user.keyboard('s');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(first);
    await user.keyboard('s');
    expect(
      await screen.findByRole('dialog', { name: 'Share a.txt' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard('s');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('labels menus with the shortcut and aria-keyshortcuts', async () => {
    const user = userEvent.setup();
    renderApp('/drive', testUser);
    await user.click(await screen.findByRole('button', { name: 'Create' }));
    const item = await screen.findByRole('menuitem', { name: 'New folder' });
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Shift+N');
    expect(item).toHaveTextContent('Shift+N');
    expect(
      screen.getByRole('menuitem', { name: 'Upload folder' }),
    ).toHaveAttribute('aria-keyshortcuts', 'Shift+U');
  });
});
