import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive, ROOT_ID } from '@/test/drive-server';
import { renderApp } from '@/test/render-app';
import { setMediaQuery } from '@/test/match-media';
import { DESKTOP_INPUT_QUERY } from './desktop-input';

import { VIRTUALIZE_AFTER } from './components/node-collection';
import { compactId, folderPath } from './paths';

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

const items = () => screen.findAllByRole('option');
const names = async () =>
  (await items()).map((item) => item.getAttribute('title'));

describe('Drive (S-05)', () => {
  it('loads cursor pages to highlight a linked file, focuses it and lets Escape clear it', async () => {
    const user = userEvent.setup();
    for (let i = 0; i < 105; i++) drive.file(`a${String(i)}.txt`);
    const target = drive.file('z-target.txt');
    renderApp(folderPath(undefined, target.id), testUser);
    const file = await screen.findByRole('option', { name: target.name });
    await waitFor(() => expect(file).toHaveAttribute('aria-selected', 'true'));
    expect(file).toHaveFocus();
    expect(drive.requests.some((url) => url.searchParams.has('cursor'))).toBe(
      true,
    );
    await user.keyboard('{Escape}');
    expect(file).toHaveAttribute('aria-selected', 'false');
    await user.click(
      screen.getByRole('button', { name: 'More actions for z-target.txt' }),
    );
    expect(
      screen.queryByRole('menuitem', { name: 'Open containing folder' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the file query when canonicalizing a dashed parent link', async () => {
    const parent = drive.folder('Nested');
    const target = drive.file('report.txt', parent.id);
    const router = renderApp(
      `/drive/folders/${parent.id}?select=${target.id}`,
      testUser,
    );
    await waitFor(() =>
      expect(screen.getByRole('option', { name: target.name })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(router.state.location.pathname).toBe(
      `/drive/folders/${compactId(parent.id)}`,
    );
    expect(router.state.location.search).toBe(`?select=${target.id}`);
  });

  it('rejects missing or moved targets without walking unrelated cursor pages', async () => {
    const parent = drive.folder('Elsewhere');
    const target = drive.file('moved.txt', parent.id);
    for (let i = 0; i < 105; i++) drive.file(`a${String(i)}.txt`);
    const router = renderApp(folderPath(undefined, target.id), testUser);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file is unavailable',
    );
    expect(drive.requests.some((url) => url.searchParams.has('cursor'))).toBe(
      false,
    );
    await act(() =>
      router.navigate('/drive?select=00000000000000000000000000000000'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file is unavailable',
    );
    expect(
      (await items()).every(
        (item) => item.getAttribute('aria-selected') === 'false',
      ),
    ).toBe(true);
  });

  it('touch devices ignore double click but keep explicit Open and New folder actions', async () => {
    setMediaQuery(DESKTOP_INPUT_QUERY, false);
    const user = userEvent.setup();
    const photos = drive.folder('Photos');
    drive.file('note.txt');
    const router = renderApp('/drive', testUser);
    await items();
    await user.dblClick(screen.getByRole('option', { name: 'Photos' }));
    expect(router.state.location.pathname).toBe('/drive');
    await user.dblClick(screen.getByRole('option', { name: 'note.txt' }));
    expect(
      drive.requests.some((url) => url.pathname.endsWith('/download')),
    ).toBe(false);
    await user.dblClick(screen.getByTestId('folder-content'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Photos' }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Photos' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `/drive/folders/${compactId(photos.id)}`,
    );
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeVisible();
  });

  it('updates double click behavior when the primary input capability changes', async () => {
    const user = userEvent.setup();
    drive.folder('Photos');
    const router = renderApp('/drive', testUser);
    await items();
    act(() => {
      setMediaQuery(DESKTOP_INPUT_QUERY, false);
    });
    await user.dblClick(screen.getByTestId('folder-content'));
    await user.dblClick(screen.getByRole('option', { name: 'Photos' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/drive');
    act(() => {
      setMediaQuery(DESKTOP_INPUT_QUERY, true);
    });
    await user.dblClick(screen.getByTestId('folder-content'));
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.dblClick(screen.getByRole('option', { name: 'Photos' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Photos' }),
    ).toBeVisible();
  });
  it('opens the root at /drive: folders first, in natural order', async () => {
    drive.file('file10.txt');
    drive.file('file2.txt');
    drive.folder('Photos');
    drive.folder('Archive');
    const router = renderApp('/', testUser);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/drive');
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'My Drive' }),
    ).toBeVisible();
    expect(await names()).toEqual([
      'Archive',
      'Photos',
      'file2.txt',
      'file10.txt',
    ]);
  });

  it('opens folders and walks back with the breadcrumb', async () => {
    const user = userEvent.setup();
    const projects = drive.folder('Projects');
    const design = drive.folder('Design', projects.id);
    drive.file('logo.png', design.id, 2048, 'image/png');
    const router = renderApp('/drive', testUser);

    await user.dblClick(
      await screen.findByRole('option', { name: /Projects/ }),
    );
    await user.dblClick(await screen.findByRole('option', { name: /Design/ }));
    expect(router.state.location.pathname).toBe(
      `/drive/folders/${compactId(design.id)}`,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Design' }),
    ).toBeVisible();
    expect(await names()).toEqual(['logo.png']);

    const crumbs = within(
      screen.getByRole('navigation', { name: 'Folder path' }),
    );
    expect(crumbs.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      `/drive/folders/${compactId(projects.id)}`,
    );
    await user.click(crumbs.getByRole('link', { name: 'My Drive' }));
    expect(router.state.location.pathname).toBe('/drive');
  });

  it('links use the compact id; dashed links still open, then show it', async () => {
    const user = userEvent.setup();
    const projects = drive.folder('Projects');
    drive.folder('Design', projects.id);
    const router = renderApp(
      `/drive/folders/${projects.id.toUpperCase()}`,
      testUser,
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Projects' }),
    ).toBeVisible();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/drive/folders/${projects.id.replaceAll('-', '')}`,
      );
    });
    // Backspace goes up to the parent, here the root.
    await user.keyboard('{Backspace}');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'My Drive' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/drive');
    await user.keyboard('{Backspace}'); // nothing above the root
    expect(router.state.location.pathname).toBe('/drive');
  });

  it('selects with the keyboard, opens with Enter, shows details', async () => {
    const user = userEvent.setup();
    drive.folder('A');
    const b = drive.folder('B');
    renderApp('/drive', testUser);

    const [first] = await items();
    first?.focus();
    await user.keyboard('{ArrowRight}');
    const second = screen.getByRole('option', { name: /B/ });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveFocus();
    await user.click(
      screen.getByRole('button', { name: 'Open details panel' }),
    );
    const panel = within(screen.getByRole('dialog', { name: 'Details' }));
    expect(panel.getByText('Folder')).toBeVisible();
    await user.keyboard('{Escape}');

    second.focus();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'B' }),
    ).toBeVisible();
    expect(drive.requests.at(-1)?.pathname).toBe(
      `/api/v1/nodes/${b.id}/children`,
    );
  });

  it('creates a folder from the header menu', async () => {
    const user = userEvent.setup();
    renderApp('/drive', testUser);
    expect(await screen.findByText('This folder is empty')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await user.click(screen.getByRole('menuitem', { name: 'New folder' }));
    const dialog = within(screen.getByRole('dialog', { name: 'New folder' }));
    const field = dialog.getByLabelText('Name');
    expect(field).toHaveValue('Untitled folder');
    await user.clear(field);
    await user.type(field, 'Reports');
    await user.click(dialog.getByRole('button', { name: 'Create' }));

    expect(await names()).toEqual(['Reports']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Reports/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it.each(['grid', 'list'])(
    'creates a child from empty space in %s view',
    async (view) => {
      const user = userEvent.setup();
      localStorage.setItem('qloud.drive.view', view);
      const parent = drive.folder('Projects');
      drive.file('notes.txt', parent.id);
      renderApp(`/drive/folders/${compactId(parent.id)}`, testUser);
      await items();
      await user.dblClick(screen.getByTestId('folder-content'));
      const dialog = within(screen.getByRole('dialog', { name: 'New folder' }));
      expect(dialog.getByLabelText('Name')).toHaveFocus();
      await user.clear(dialog.getByLabelText('Name'));
      await user.type(dialog.getByLabelText('Name'), 'Reports{Enter}');
      expect(
        await screen.findByRole('option', { name: 'Reports' }),
      ).toBeVisible();
      expect(
        [...drive.nodes.values()].find((node) => node.name === 'Reports')
          ?.parent_id,
      ).toBe(parent.id);
    },
  );

  it('opens from an empty root; cancel creates nothing and repeated double clicks do not stack', async () => {
    const user = userEvent.setup();
    renderApp('/drive', testUser);
    await screen.findByText('This folder is empty');
    const area = screen.getByTestId('folder-content');
    await user.dblClick(area);
    fireEvent.doubleClick(area); // a second event behind the open modal
    expect(screen.getAllByRole('dialog', { name: 'New folder' })).toHaveLength(
      1,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(drive.nodes.size).toBe(1); // root only
    await user.dblClick(area);
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Reports{Enter}');
    expect(
      await screen.findByRole('option', { name: 'Reports' }),
    ).toBeVisible();
    expect(
      [...drive.nodes.values()].find((node) => node.name === 'Reports')
        ?.parent_id,
    ).toBe(ROOT_ID);
  });

  it('ignores the breadcrumb, view controls and an open item menu', async () => {
    const user = userEvent.setup();
    drive.folder('A');
    renderApp('/drive', testUser);
    await items();
    await user.dblClick(screen.getByRole('heading', { level: 1 }));
    await user.dblClick(screen.getByRole('button', { name: 'List view' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Use the actual contextmenu event: user-event does not synthesize it.
    fireEvent.contextMenu(screen.getByRole('option', { name: 'A' }));
    expect(screen.getByRole('menu')).toBeVisible();
    fireEvent.doubleClick(screen.getByTestId('folder-content'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not create while loading or when the children request fails', async () => {
    const user = userEvent.setup();
    drive.failChildren = true;
    renderApp('/drive', testUser);
    fireEvent.doubleClick(screen.getByTestId('folder-content'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await screen.findByText("Couldn't load this folder");
    await user.dblClick(screen.getByTestId('folder-content'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a double click after drawing a selection box does not create a folder', async () => {
    drive.folder('A');
    renderApp('/drive', testUser);
    await items();
    const area = screen.getByTestId('folder-content');
    fireEvent.pointerDown(area, {
      button: 0,
      pointerType: 'mouse',
      clientX: 200,
      clientY: 300,
    });
    fireEvent.pointerMove(window, { clientX: 210, clientY: 310 });
    fireEvent.pointerUp(window);
    fireEvent.doubleClick(area);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // A fresh genuine double click works again.
    await userEvent.setup().dblClick(area);
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeVisible();
  });

  it('keeps the dialog open with a message when the name is taken', async () => {
    const user = userEvent.setup();
    drive.folder('Reports');
    renderApp('/drive', testUser);
    await items();

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await user.click(screen.getByRole('menuitem', { name: 'New folder' }));
    const dialog = within(screen.getByRole('dialog', { name: 'New folder' }));
    await user.clear(dialog.getByLabelText('Name'));
    await user.type(dialog.getByLabelText('Name'), 'reports');
    await user.click(dialog.getByRole('button', { name: 'Create' }));

    expect(
      await dialog.findByText(
        'An item with this name already exists in this folder.',
      ),
    ).toBeVisible();
  });

  it('renames optimistically with F2', async () => {
    const user = userEvent.setup();
    drive.writeDelay = 200;
    drive.file('draft.pdf');
    renderApp('/drive', testUser);

    await user.click(await screen.findByRole('option', { name: /draft\.pdf/ }));
    await user.keyboard('{F2}');
    const field = within(
      screen.getByRole('dialog', { name: 'Rename' }),
    ).getByLabelText('Name');
    await user.keyboard('final');
    expect(field).toHaveValue('final.pdf'); // the extension was not selected
    await user.keyboard('{Enter}');

    // Before the server answers.
    expect(screen.getByRole('option', { name: /final\.pdf/ })).toBeVisible();
    await waitFor(() => {
      expect(
        [...drive.nodes.values()].some((node) => node.name === 'final.pdf'),
      ).toBe(true);
    });
  });

  it('puts the old name back and reopens the dialog when a rename fails', async () => {
    const user = userEvent.setup();
    drive.folder('Taken');
    drive.folder('Mine');
    renderApp('/drive', testUser);

    await user.click(await screen.findByRole('option', { name: /Mine/ }));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Rename' }));
    await user.clear(dialog.getByLabelText('Name'));
    await user.type(dialog.getByLabelText('Name'), 'taken{Enter}');

    const reopened = within(
      await screen.findByRole('dialog', { name: 'Rename' }),
    );
    expect(
      await reopened.findByText(
        'An item with this name already exists in this folder.',
      ),
    ).toBeVisible();
    expect(reopened.getByLabelText('Name')).toHaveValue('taken');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('option', { name: /Mine/ })).toBeVisible();
  });

  it('remembers the sort order and the view', async () => {
    const user = userEvent.setup();
    drive.file('small.txt', ROOT_ID, 10);
    drive.file('big.txt', ROOT_ID, 9000);
    renderApp('/drive', testUser);
    await items();

    await user.click(screen.getByRole('button', { name: /Name \(A → Z\)/ }));
    await user.click(
      screen.getByRole('menuitemradio', { name: 'Largest first' }),
    );
    await waitFor(async () => {
      expect(await names()).toEqual(['big.txt', 'small.txt']);
    });
    expect(drive.requests.at(-1)?.searchParams.get('ordering')).toBe('-size');
    expect(localStorage.getItem('qloud.drive.ordering')).toBe('-size');

    await user.click(screen.getByRole('button', { name: 'List view' }));
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(localStorage.getItem('qloud.drive.view')).toBe('list');
    expect(screen.getByText('Last modified')).toBeInTheDocument();
  });

  it('loads more pages, then virtualizes long folders', async () => {
    const user = userEvent.setup();
    for (let i = 0; i < 250; i += 1) drive.folder(`Folder ${String(i)}`);
    renderApp('/drive', testUser);

    expect(await items()).toHaveLength(100);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(async () => {
      expect(await items()).toHaveLength(200);
    });
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    // Past VIRTUALIZE_AFTER items only the rows near the viewport are in the DOM.
    await waitFor(async () => {
      expect((await items()).length).toBeLessThan(VIRTUALIZE_AFTER);
    });
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });

  it('opens the viewer on double click and closes it with Escape', async () => {
    const user = userEvent.setup();
    drive.file('report.pdf');
    renderApp('/drive', testUser);
    const file = await screen.findByRole('option', { name: /report\.pdf/ });
    await user.dblClick(file);
    expect(
      await screen.findByRole('dialog', { name: 'report.pdf' }),
    ).toBeVisible();
    expect(await screen.findByText(/Preview is unavailable/)).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('offers to retry when the folder cannot be loaded', async () => {
    const user = userEvent.setup();
    drive.failChildren = true;
    drive.folder('Back');
    renderApp('/drive', testUser);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText("Couldn't load this folder")).toBeVisible();
    drive.failChildren = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await names()).toEqual(['Back']);
  });

  it('says so when a folder does not exist or is not shared', async () => {
    renderApp('/drive/folders/0190c0de-0000-7000-8000-0000000000ff', testUser);
    expect(await screen.findByText('Folder not found')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Drive' })).toHaveAttribute(
      'href',
      '/drive',
    );
  });
});
