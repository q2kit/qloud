import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive, ROOT_ID } from '@/test/drive-server';
import { renderApp } from '@/test/render-app';
import { setMediaQuery } from '@/test/match-media';
import { DESKTOP_INPUT_QUERY } from './desktop-input';

import { DRAG_TYPE } from './actions';
import { compactId } from './paths';

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

const option = (name: string) => screen.getByRole('option', { name });
// `hidden`: an open Radix menu hides the rest of the page from the accessibility tree.
const selectedNames = () =>
  screen
    .getAllByRole('option', { hidden: true })
    .filter((item) => item.getAttribute('aria-selected') === 'true')
    .map((item) => item.getAttribute('aria-label'));
const names = () =>
  screen.getAllByRole('option').map((item) => item.getAttribute('aria-label'));

/** jsdom has no DataTransfer; this is the part drag and drop uses. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    data,
    types: [] as string[],
    dropEffect: 'none',
    effectAllowed: 'all',
    setData(type: string, value: string) {
      data.set(type, value);
      this.types.push(type);
    },
    getData: (type: string) => data.get(type) ?? '',
  };
}

describe('selecting several items (M2-07b)', () => {
  it('Ctrl/⌘+click, Shift+click, Ctrl+A and Esc', async () => {
    const user = userEvent.setup();
    for (const name of ['A', 'B', 'C', 'D']) drive.folder(name);
    renderApp('/drive', testUser);
    await screen.findByRole('option', { name: 'A' });

    await user.click(option('A'));
    await user.keyboard('{Control>}');
    await user.click(option('C'));
    await user.keyboard('{/Control}');
    expect(selectedNames()).toEqual(['A', 'C']);
    expect(screen.getByText('2 items selected')).toBeVisible();

    await user.click(option('B'));
    await user.keyboard('{Shift>}');
    await user.click(option('D'));
    await user.keyboard('{/Shift}');
    expect(selectedNames()).toEqual(['B', 'C', 'D']);

    await user.keyboard('{Control>}a{/Control}');
    expect(selectedNames()).toEqual(['A', 'B', 'C', 'D']);
    await user.click(
      screen.getByRole('button', { name: 'Open details panel' }),
    );
    const panel = within(screen.getByRole('dialog', { name: 'Details' }));
    expect(panel.getByText('4 items selected')).toBeVisible();
    await user.keyboard('{Escape}');

    option('A').focus();
    await user.keyboard('{Escape}');
    expect(selectedNames()).toEqual([]);
  });

  it('Ctrl/⌘+A works from anywhere on the page, not only the list', async () => {
    const user = userEvent.setup();
    for (const name of ['A', 'B']) drive.folder(name);
    renderApp('/drive', testUser);
    await screen.findByRole('option', { name: 'A' });
    // Focus on a toolbar button, outside the listbox.
    screen.getByRole('button', { name: 'List view' }).focus();
    await user.keyboard('{Control>}a{/Control}');
    expect(selectedNames()).toEqual(['A', 'B']);
    await user.keyboard('{Escape}');
    expect(selectedNames()).toEqual([]);
  });

  it('Shift+arrows grow the selection', async () => {
    const user = userEvent.setup();
    for (const name of ['A', 'B', 'C']) drive.folder(name);
    renderApp('/drive', testUser);
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}');
    expect(selectedNames()).toEqual(['A', 'B', 'C']);
  });
});

describe('rubber-band selection', () => {
  /** Lay the items out in a row, 100px wide with 20px gaps (jsdom has no layout). */
  function layOut(names: string[]) {
    names.forEach((name, index) => {
      const left = index * 120;
      option(name).getBoundingClientRect = () =>
        ({
          left,
          top: 0,
          width: 100,
          height: 100,
          right: left + 100,
          bottom: 100,
        }) as DOMRect;
    });
    const area = screen.getByRole('listbox').parentElement;
    if (!area) throw new Error('no selection area');
    return area;
  }
  const press = (area: HTMLElement, x: number, init: object = {}) => {
    fireEvent.pointerDown(area, {
      button: 0,
      pointerType: 'mouse',
      clientX: x,
      clientY: 50,
      ...init,
    });
  };

  it('dragging on empty space selects what the box touches', async () => {
    for (const name of ['A', 'B', 'C', 'D']) drive.folder(name);
    renderApp('/drive', testUser);
    await screen.findByRole('option', { name: 'A' });
    const area = layOut(['A', 'B', 'C', 'D']);

    press(area, 110); // the gap between A and B
    fireEvent.pointerMove(window, { clientX: 112, clientY: 50 }); // below the threshold
    expect(screen.queryByTestId('selection-box')).not.toBeInTheDocument();
    fireEvent.pointerMove(window, { clientX: 250, clientY: 60 });
    expect(screen.getByTestId('selection-box')).toBeInTheDocument();
    expect(selectedNames()).toEqual(['B', 'C']);
    fireEvent.pointerUp(window);
    expect(screen.queryByTestId('selection-box')).not.toBeInTheDocument();
    expect(selectedNames()).toEqual(['B', 'C']);

    // With Ctrl/⌘ the box adds to what is selected.
    press(area, 470, { ctrlKey: true });
    fireEvent.pointerMove(window, { clientX: 380, clientY: 60 });
    fireEvent.pointerUp(window);
    expect(selectedNames()).toEqual(['B', 'C', 'D']);

    // A click on empty space clears the selection.
    press(area, 470);
    fireEvent.pointerUp(window);
    expect(selectedNames()).toEqual([]);
  });

  it('a press on an item is a click or a drag to move, never a box', async () => {
    for (const name of ['A', 'B']) drive.folder(name);
    renderApp('/drive', testUser);
    await screen.findByRole('option', { name: 'A' });
    layOut(['A', 'B']);
    fireEvent.pointerDown(option('A'), {
      button: 0,
      pointerType: 'mouse',
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 60 });
    expect(screen.queryByTestId('selection-box')).not.toBeInTheDocument();
    fireEvent.pointerUp(window);
  });
});

describe('item menus', () => {
  it('waits for the trigger click to finish before changing selection and opening the menu', async () => {
    const user = userEvent.setup();
    drive.folder('Photos');
    drive.file('report.pdf');
    const router = renderApp('/drive', testUser);
    await user.click(await screen.findByRole('option', { name: 'report.pdf' }));
    const trigger = screen.getByRole('button', {
      name: 'More actions for Photos',
    });
    await user.pointer({ keys: '[MouseLeft>]', target: trigger });
    expect(selectedNames()).toEqual(['report.pdf']);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.pointer({ keys: '[/MouseLeft]' });
    expect(screen.getByRole('menu')).toBeVisible();
    expect(selectedNames()).toEqual(['Photos']);
    expect(router.state.location.pathname).toBe('/drive');
    await user.keyboard('{Escape}');
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Open↵' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Photos' }),
    ).toBeVisible();
  });

  it('right click selects the item and offers its actions', async () => {
    const user = userEvent.setup();
    drive.folder('A');
    drive.file('report.pdf');
    renderApp('/drive', testUser);

    await user.pointer({
      keys: '[MouseRight]',
      target: await screen.findByRole('option', { name: 'report.pdf' }),
    });
    const menu = within(screen.getByRole('menu'));
    expect(
      menu.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual([
      'Preview↵',
      'Open in new tab',
      'Copy link',
      'Download',
      'RenameF2',
      'Move…',
      'Infoi',
    ]);
    expect(selectedNames()).toEqual(['report.pdf']);
    await user.click(menu.getByRole('menuitem', { name: /Info/ }));
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeVisible();
  });

  it('keys and clicks inside an open menu leave the selection alone', async () => {
    const user = userEvent.setup();
    for (const name of ['A', 'B', 'C']) drive.folder(name);
    renderApp('/drive', testUser);

    // Menus render in a portal, but React events still bubble to the item.
    await user.pointer({
      keys: '[MouseRight]',
      target: await screen.findByRole('option', { name: 'B' }),
    });
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(selectedNames()).toEqual(['B']);
    await user.keyboard('{Escape}');

    await user.keyboard('{Control>}');
    await user.click(option('C'));
    await user.keyboard('{/Control}');
    await user.click(
      screen.getByRole('button', { name: 'More actions for C' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Move 2 items…' }));
    expect(screen.getByRole('dialog', { name: 'Move 2 items' })).toBeVisible();
    expect(selectedNames()).toEqual(['B', 'C']);
  });

  it('the ⋯ button opens the same menu; several items only move', async () => {
    const user = userEvent.setup();
    drive.folder('A');
    drive.folder('B');
    renderApp('/drive', testUser);
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.keyboard('{Control>}');
    await user.click(option('B'));
    await user.keyboard('{/Control}');

    await user.click(
      screen.getByRole('button', { name: 'More actions for B' }),
    );
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Move 2 items…']);
  });
});

describe('folder links (open in a new tab)', () => {
  it('middle click and Ctrl/⌘+Enter open independent folder and file links', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const photos = drive.folder('Photos');
    const file = drive.file('a.pdf');
    renderApp('/drive', testUser);

    await user.pointer({
      keys: '[MouseMiddle]',
      target: await screen.findByRole('option', { name: 'Photos' }),
    });
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}/drive/folders/${compactId(photos.id)}`,
      '_blank',
      'noopener',
    );
    await user.pointer({ keys: '[MouseMiddle]', target: option('a.pdf') });
    expect(open).toHaveBeenLastCalledWith(
      `${window.location.origin}/drive/files/${compactId(file.id)}`,
      '_blank',
      'noopener',
    );
    expect(open).toHaveBeenCalledTimes(2);

    option('Photos').focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(open).toHaveBeenCalledTimes(3);
    // Still on the same page: a new tab, not navigation here.
    expect(
      screen.getByRole('heading', { level: 1, name: 'My Drive' }),
    ).toBeVisible();
    open.mockRestore();
  });

  it('a folder menu can open it in a new tab or copy its link', async () => {
    const user = userEvent.setup();
    const photos = drive.folder('Photos');
    renderApp('/drive', testUser);

    await user.pointer({
      keys: '[MouseRight]',
      target: await screen.findByRole('option', { name: 'Photos' }),
    });
    const menu = within(screen.getByRole('menu'));
    expect(
      menu.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual([
      'Open↵',
      'Open in new tab',
      'Copy link',
      'RenameF2',
      'Move…',
      'Infoi',
    ]);
    await user.click(menu.getByRole('menuitem', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/drive/folders/${compactId(photos.id)}`,
    );
    expect(
      await screen.findByText('Copied the link to "Photos".'),
    ).toBeInTheDocument();
  });
});

describe('moving', () => {
  it('moves the selection with the dialog, optimistically', async () => {
    const user = userEvent.setup();
    drive.writeDelay = 200;
    const target = drive.folder('Archive');
    const inner = drive.folder('2025', target.id);
    drive.folder('Notes');
    drive.file('a.pdf');
    renderApp('/drive', testUser);

    await user.click(await screen.findByRole('option', { name: 'Notes' }));
    await user.keyboard('{Control>}');
    await user.click(option('a.pdf'));
    await user.keyboard('{/Control}');
    await user.click(screen.getByRole('button', { name: 'Move 2 items…' }));

    const dialog = within(screen.getByRole('dialog', { name: 'Move 2 items' }));
    // Where they already are: nothing to do yet.
    expect(dialog.getByRole('button', { name: 'Move here' })).toBeDisabled();
    // The items being moved cannot be entered.
    expect(dialog.getByRole('button', { name: 'Notes' })).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: 'Archive' }));
    await user.click(await dialog.findByRole('button', { name: '2025' }));
    await dialog.findByText('No subfolders.');
    await user.click(dialog.getByRole('button', { name: 'Move here' }));

    // Gone from here before the server answers.
    expect(names()).toEqual(['Archive']);
    await waitFor(() => {
      expect(drive.moves).toHaveLength(1);
    });
    expect(drive.moves[0]?.target_parent_id).toBe(inner.id);
    expect(
      await screen.findByText('Moved 2 items to "2025".'),
    ).toBeInTheDocument();
  });

  it('puts the items back when the move is refused', async () => {
    const user = userEvent.setup();
    drive.folder('Other');
    drive.folder('Mine');
    // As if the tree changed elsewhere and the API now sees a cycle.
    server.use(
      http.post('/api/v1/nodes/move', async () => {
        await delay(100);
        return HttpResponse.json(
          { error: { code: 'invalid_move', message: 'Cycle.', details: {} } },
          { status: 400 },
        );
      }),
    );
    renderApp('/drive', testUser);
    await user.click(await screen.findByRole('option', { name: 'Mine' }));
    await user.click(screen.getByRole('button', { name: 'Move…' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Move 1 item' }));
    // The folder being moved cannot be entered.
    expect(dialog.getByRole('button', { name: 'Mine' })).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: 'Other' }));
    await user.click(await dialog.findByRole('button', { name: 'Move here' }));

    expect(names()).toEqual(['Other']);
    expect(
      await screen.findByText(
        "A folder can't be moved into itself or one of its subfolders.",
      ),
    ).toBeVisible();
    expect(names()).toEqual(['Mine', 'Other']);
    expect(selectedNames()).toEqual(['Mine']);
  });

  it('drops on a folder or a breadcrumb link to move there', async () => {
    const project = drive.folder('Project');
    const target = drive.folder('Target', project.id);
    drive.file('a.pdf', project.id);
    drive.file('b.pdf', project.id);
    renderApp(`/drive/folders/${project.id}`, testUser);
    await screen.findByRole('option', { name: 'a.pdf' });

    let transfer = dataTransfer();
    fireEvent.dragStart(option('a.pdf'), { dataTransfer: transfer });
    fireEvent.dragOver(option('Target'), { dataTransfer: transfer });
    expect(option('Target').className).toContain('ring-2');
    fireEvent.drop(option('Target'), { dataTransfer: transfer });
    await waitFor(() => {
      expect(drive.moves.at(-1)).toEqual({
        node_ids: [expect.any(String)],
        target_parent_id: target.id,
      });
    });
    expect(transfer.data.get(DRAG_TYPE)).toBeDefined();

    transfer = dataTransfer();
    fireEvent.dragStart(await screen.findByRole('option', { name: 'b.pdf' }), {
      dataTransfer: transfer,
    });
    const root = within(
      screen.getByRole('navigation', { name: 'Folder path' }),
    ).getByRole('link', { name: 'My Drive' });
    fireEvent.dragOver(root, { dataTransfer: transfer });
    fireEvent.drop(root, { dataTransfer: transfer });
    await waitFor(() => {
      expect(drive.moves.at(-1)?.target_parent_id).toBe(ROOT_ID);
    });
    await waitFor(() => {
      expect(names()).toEqual(['Target']);
    });
  });

  it('moves fifty items in one request', async () => {
    const user = userEvent.setup();
    const target = drive.folder('0 Target');
    for (let i = 0; i < 50; i += 1) drive.file(`file ${String(i)}.txt`);
    renderApp('/drive', testUser);
    await user.click(await screen.findByRole('option', { name: 'file 0.txt' }));
    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard('{Control>}');
    await user.click(option('0 Target'));
    await user.keyboard('{/Control}');
    await user.click(screen.getByRole('button', { name: 'Move 50 items…' }));
    const dialog = within(
      screen.getByRole('dialog', { name: 'Move 50 items' }),
    );
    await user.click(await dialog.findByRole('button', { name: '0 Target' }));
    await user.click(dialog.getByRole('button', { name: 'Move here' }));
    await waitFor(() => {
      expect(drive.moves).toHaveLength(1);
    });
    expect(drive.moves[0]?.node_ids).toHaveLength(50);
    expect(drive.moves[0]?.target_parent_id).toBe(target.id);
  });
});
