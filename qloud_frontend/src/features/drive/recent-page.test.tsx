import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive, ROOT_ID } from '@/test/drive-server';
import { setMediaQuery } from '@/test/match-media';
import { renderApp } from '@/test/render-app';

import { DESKTOP_INPUT_QUERY } from './desktop-input';
import { compactId } from './paths';
import { useDriveStore } from './store';

const server = setupServer();
let drive: FakeDrive;
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});
beforeEach(async () => {
  drive = new FakeDrive();
  server.use(...drive.handlers());
  await i18n.changeLanguage('en');
  setMediaQuery(DESKTOP_INPUT_QUERY, true);
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function recent(pageSize = 50) {
  server.use(
    http.get('/api/v1/recent', ({ request }) => {
      drive.requests.push(new URL(request.url));
      const offset = Number(
        new URL(request.url).searchParams.get('cursor') ?? 0,
      );
      const files = [...drive.nodes.values()]
        .filter((node) => node.kind === 'file')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 100);
      return HttpResponse.json({
        results: files.slice(offset, offset + pageSize),
        previous: null,
        next:
          files.length > offset + pageSize
            ? `http://localhost/api/v1/recent?cursor=${String(offset + pageSize)}`
            : null,
      });
    }),
  );
}

it('loads files across folders newest first, supports pagination and keeps Recent sort separate from Drive', async () => {
  const user = userEvent.setup();
  const folder = drive.folder('Nested');
  drive.file('old.txt');
  drive.file('new.txt', folder.id);
  recent(1);
  localStorage.setItem('qloud.drive.ordering', 'name');
  renderApp('/recent', testUser);
  await screen.findByRole('option', { name: 'new.txt' });
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('option', { name: 'old.txt' });
  expect(screen.getAllByRole('option').map((node) => node.title)).toEqual([
    'new.txt',
    'old.txt',
  ]);
  expect(
    screen.queryByRole('option', { name: 'Nested' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('Last modified first')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Last modified first' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'List view' }));
  expect(localStorage.getItem('qloud.drive.view')).toBe('list');
  expect(localStorage.getItem('qloud.drive.ordering')).toBe('name');
  expect(
    drive.requests.some((url) => url.searchParams.get('cursor') === '1'),
  ).toBe(true);
});

it('shares selection, keyboard, info and menus; opens the containing nested folder and highlights the file', async () => {
  const user = userEvent.setup();
  const folder = drive.folder('Nested');
  drive.file('report.txt', folder.id);
  drive.file('root.txt');
  recent();
  const router = renderApp('/recent', testUser);
  const file = await screen.findByRole('option', { name: 'report.txt' });
  await user.click(file);
  expect(file).toHaveAttribute('draggable', 'false');
  await user.click(
    screen.getByRole('button', { name: 'More actions for report.txt' }),
  );
  expect(
    screen.queryByRole('menuitem', { name: 'Rename' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: 'Info' }));
  expect(await screen.findByText('application/pdf')).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(
    screen.getByRole('button', { name: 'Open containing folder' }),
  );
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(
      `/drive/folders/${compactId(folder.id)}`,
    );
  });
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'report.txt' })).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
  expect(router.state.location.search).toContain('select=');
});

it('opens root locations, ignores blank-area double click and supports select-all/clear', async () => {
  const user = userEvent.setup();
  drive.file('a.txt');
  drive.file('b.txt');
  recent();
  const router = renderApp('/recent', testUser);
  await screen.findByRole('option', { name: 'a.txt' });
  await user.dblClick(screen.getByTestId('folder-content'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.keyboard('{Control>}a{/Control}');
  expect(
    screen
      .getAllByRole('option')
      .every((node) => node.getAttribute('aria-selected') === 'true'),
  ).toBe(true);
  await user.keyboard('{Escape}');
  expect(useDriveStore.getState().selected).toEqual([]);
  await user.click(screen.getByRole('option', { name: 'a.txt' }));
  await user.click(
    screen.getByRole('button', { name: 'Open containing folder' }),
  );
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/drive');
  });
});

it('shows loading then an empty state', async () => {
  server.use(
    http.get('/api/v1/recent', async () => {
      await delay(100);
      return HttpResponse.json({ results: [], next: null, previous: null });
    }),
  );
  renderApp('/recent', testUser);
  expect(
    screen.getByRole('status', { name: 'Loading recent files' }),
  ).toBeVisible();
  expect(await screen.findByText('No recent files yet')).toBeVisible();
});

it('retries a failed request and reports a download failure without recording an open', async () => {
  const user = userEvent.setup();
  drive.file('note.txt', ROOT_ID, 10, 'text/plain');
  server.use(
    http.get('/api/v1/recent', () => new HttpResponse(null, { status: 500 })),
  );
  renderApp('/recent', testUser);
  expect(await screen.findByText("Couldn't load recent files")).toBeVisible();
  recent();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  const file = await screen.findByRole('option', { name: 'note.txt' });
  server.use(
    http.get(
      '/api/v1/nodes/:id/download',
      () => new HttpResponse(null, { status: 500 }),
    ),
  );
  act(() => {
    setMediaQuery(DESKTOP_INPUT_QUERY, false);
  });
  await user.dblClick(file);
  expect(drive.requests.some((url) => url.pathname.endsWith('/download'))).toBe(
    false,
  );
  fireEvent.keyDown(file, { key: 'Enter' });
  expect(
    await screen.findByText("Couldn't download the file. Please try again."),
  ).toBeVisible();
  expect(
    within(screen.getByRole('listbox')).getAllByRole('option'),
  ).toHaveLength(1);
});
