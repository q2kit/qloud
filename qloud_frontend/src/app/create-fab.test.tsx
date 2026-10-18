import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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

import { useDriveStore } from '@/features/drive/store';
import { folderPath } from '@/features/drive/paths';
import { useBottomObstacles } from '@/lib/bottom-obstacles';
import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive, SHARING_OWNER_ID } from '@/test/drive-server';
import { setMediaQuery } from '@/test/match-media';
import { renderApp } from '@/test/render-app';

const DESKTOP_SHELL_QUERY = '(min-width: 1024px)';
const server = setupServer();
let drive: FakeDrive;

const fab = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-create-fab]');

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});
beforeEach(async () => {
  drive = new FakeDrive();
  server.use(...drive.handlers());
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
  useBottomObstacles.setState(useBottomObstacles.getInitialState(), true);
});
afterAll(() => {
  server.close();
});

describe('floating create button (M8-12)', () => {
  it('replaces the header button on mobile and opens the create menu', async () => {
    const user = userEvent.setup();
    renderApp('/drive', testUser);

    const button = await screen.findByRole('button', { name: 'Create' });
    expect(button).toBe(fab());
    expect(screen.getAllByRole('button', { name: 'Create' })).toHaveLength(1);

    await user.click(button);
    await user.click(
      await screen.findByRole('menuitem', { name: 'New folder' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'New folder' }),
    ).toBeInTheDocument();
  });

  it('keeps the header button from the lg breakpoint up', async () => {
    setMediaQuery(DESKTOP_SHELL_QUERY, true);
    renderApp('/drive', testUser);

    expect(
      await screen.findByRole('button', { name: 'Create' }),
    ).toBeInTheDocument();
    expect(fab()).toBeNull();
  });

  it.each(['/recent', '/shared', '/search?q=a'])(
    'shows on %s',
    async (path) => {
      renderApp(path, testUser);
      expect(await screen.findByRole('button', { name: 'Create' })).toBe(fab());
    },
  );

  it.each(['/trash', '/settings'])(
    'leaves %s to the header button',
    async (path) => {
      renderApp(path, testUser);
      await screen.findByRole('button', { name: 'Create' });
      expect(fab()).toBeNull();
    },
  );

  it('hides while the details sheet is open', async () => {
    renderApp('/drive', testUser);
    await screen.findByRole('button', { name: 'Create' });

    act(() => {
      useDriveStore.getState().setDetailOpen(true);
    });
    expect(fab()).toBeNull();

    act(() => {
      useDriveStore.getState().setDetailOpen(false);
    });
    expect(fab()).not.toBeNull();
  });

  it('moves above the bars at the bottom of the screen', async () => {
    renderApp('/drive', testUser);
    const button = await screen.findByRole('button', { name: 'Create' });
    expect(button.style.bottom).toContain('safe-area-inset-bottom');

    act(() => {
      useBottomObstacles.getState().setHeight('upload-tray', 120);
      useBottomObstacles.getState().setHeight('trash-toast', 80);
    });
    expect(button.style.bottom).toBe('calc(120px + 0.75rem)');

    act(() => {
      useBottomObstacles.getState().setHeight('upload-tray', null);
    });
    expect(button.style.bottom).toBe('calc(80px + 0.75rem)');
  });

  it('does not create in a folder one may only view', async () => {
    const user = userEvent.setup();
    const folder = drive.folder('Read only');
    drive.shared.add(folder.id);
    server.use(
      http.get(`/api/v1/nodes/${folder.id}`, () =>
        HttpResponse.json({
          ...folder,
          owner: { id: SHARING_OWNER_ID, display_name: 'Owner' },
          breadcrumb: [],
          capabilities: {
            can_edit: false,
            can_trash: false,
            can_share: false,
            can_delete_versions: false,
          },
        }),
      ),
    );
    renderApp(folderPath(folder.id, undefined, 'shared'), testUser);

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: 'New folder' }),
      ).toHaveAttribute('aria-disabled', 'true');
    });
    for (const name of ['Upload files', 'Upload folder'])
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
  });
});
