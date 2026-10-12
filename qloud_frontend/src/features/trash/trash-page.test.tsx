import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive } from '@/test/drive-server';
import { renderApp } from '@/test/render-app';
import { useDriveStore } from '@/features/drive/store';
import type { DriveNode } from '@/features/drive/api';
import type { TrashNode } from './api';
import { useTrashNotice } from './notice';
import { TrashToast } from './trash-toast';
import { chooseSelectionAction } from '@/test/item-menu';

const server = setupServer();
let drive: FakeDrive;
let trashed: TrashNode[];
let requests: string[][];
let emptied: number;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});
afterAll(() => {
  server.close();
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
beforeEach(async () => {
  drive = new FakeDrive();
  trashed = [];
  requests = [];
  emptied = 0;
  await i18n.changeLanguage('en');
  server.use(
    ...drive.handlers(),
    http.get('/api/v1/trash', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('cursor') ?? 0);
      return HttpResponse.json({
        results: trashed.slice(page, page + 1),
        previous: null,
        next:
          trashed.length > page + 1
            ? `http://localhost/api/v1/trash?cursor=${String(page + 1)}`
            : null,
      });
    }),
    http.post('/api/v1/nodes/trash', async ({ request }) => {
      const body = (await request.json()) as { node_ids: string[] };
      const nodes = body.node_ids.flatMap((id) => drive.nodes.get(id) ?? []);
      for (const node of nodes) {
        addTrash(node);
        drive.nodes.delete(node.id);
      }
      return HttpResponse.json({ nodes: trashed });
    }),
    http.post('/api/v1/trash/restore', async ({ request }) => {
      const body = (await request.json()) as { node_ids: string[] };
      requests.push(body.node_ids);
      const nodes = trashed.filter((node) => body.node_ids.includes(node.id));
      for (const node of nodes) drive.nodes.set(node.id, node);
      trashed = trashed.filter((node) => !body.node_ids.includes(node.id));
      return HttpResponse.json({ nodes });
    }),
    http.post('/api/v1/trash/delete', async ({ request }) => {
      const body = (await request.json()) as { node_ids: string[] };
      requests.push(body.node_ids);
      trashed = trashed.filter((node) => !body.node_ids.includes(node.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/v1/trash/empty', () => {
      emptied += 1;
      trashed = [];
      return new HttpResponse(null, { status: 204 });
    }),
  );
});
function addTrash(node: DriveNode): void {
  trashed.push({
    ...node,
    trashed_at: new Date().toISOString(),
    trashed_root_id: node.id,
  });
  drive.nodes.delete(node.id);
}

it('Delete trashes the Drive selection with Undo and ignores inputs, dialogs and modifiers', async () => {
  const user = userEvent.setup();
  const a = drive.folder('A');
  const b = drive.folder('B');
  renderApp('/drive', testUser);
  await screen.findByRole('option', { name: 'A' });
  await user.keyboard('{Control>}a{/Control}');
  await user.keyboard('{Shift>}{Delete}{/Shift}');
  expect(trashed).toHaveLength(0);
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  await user.keyboard('{Delete}');
  expect(trashed).toHaveLength(0);
  input.remove();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  await user.keyboard('{Delete}');
  expect(trashed).toHaveLength(0);
  dialog.remove();
  screen.getByRole('button', { name: 'List view' }).focus();
  await user.keyboard('{Delete}');
  await screen.findByText('Moved to trash');
  expect(trashed.map((node) => node.id)).toEqual([a.id, b.id]);
  await user.click(screen.getByRole('button', { name: /^Undo$/ }));
  await screen.findByRole('option', { name: 'A' });
  await screen.findByRole('option', { name: 'B' });
  await user.keyboard('{Delete}');
  expect(trashed).toHaveLength(0);
});

it('loads cursor pages, selects multiple, restores and removes selection', async () => {
  const user = userEvent.setup();
  const a = drive.folder('A');
  const b = drive.folder('B');
  addTrash(a);
  addTrash(b);
  renderApp('/trash', testUser);
  await screen.findByRole('option', { name: 'A' });
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('option', { name: 'B' });
  await user.keyboard('{Control>}a{/Control}');
  await chooseSelectionAction(user, 'Restore');
  await screen.findByText('Trash is empty');
  expect(requests[0]).toEqual([a.id, b.id]);
  expect(useDriveStore.getState().selected).toEqual([]);
  expect(screen.getByRole('button', { name: 'Empty trash' })).toBeDisabled();
});

it.each(['image/png', 'application/pdf', 'video/mp4'])(
  'shows %s trash thumbnails in grid/list and falls back on failure',
  async (mime) => {
    const observers: IntersectionObserverCallback[] = [];
    class Observer {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('IntersectionObserver', Observer);
    try {
      const user = userEvent.setup();
      const node = drive.file('preview-file', undefined, 20, mime);
      addTrash(node);
      const calls = vi.fn();
      server.use(
        http.get('/api/v1/nodes/:id/preview', ({ request }) => {
          expect(
            new URL(request.url).searchParams.get('trashed_thumbnail'),
          ).toBe('true');
          calls();
          return HttpResponse.json({
            kind: 'image',
            url: null,
            expires_at: null,
            thumbnail: {
              url: 'https://storage.example/trash-thumb',
              large_url: 'https://storage.example/large',
              expires_at: new Date(Date.now() + 300_000).toISOString(),
            },
          });
        }),
      );
      renderApp('/trash', testUser);
      const option = await screen.findByRole('option', { name: node.name });
      expect(calls).not.toHaveBeenCalled();
      for (const notify of observers)
        notify(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      await waitFor(() =>
        expect(option.querySelector('img')).toHaveAttribute(
          'src',
          'https://storage.example/trash-thumb',
        ),
      );
      await user.click(screen.getByRole('button', { name: 'List view' }));
      await waitFor(() =>
        expect(option.querySelector('img')).toBeInTheDocument(),
      );
      const image = option.querySelector('img');
      if (!image) throw new Error('Missing thumbnail');
      fireEvent.error(image);
      await waitFor(() => {
        expect(option.querySelector('img')).toBeNull();
      });
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it('confirms permanent deletion, cancel does not delete, failures can retry', async () => {
  const user = userEvent.setup();
  addTrash(drive.file('report.pdf'));
  renderApp('/trash', testUser);
  await user.click(await screen.findByRole('option', { name: 'report.pdf' }));
  await chooseSelectionAction(user, 'Delete permanently');
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(requests).toEqual([]);
  server.use(
    http.post('/api/v1/trash/delete', () =>
      HttpResponse.json({}, { status: 500 }),
    ),
  );
  await chooseSelectionAction(user, 'Delete permanently');
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete permanently',
    }),
  );
  await screen.findByRole('alert');
  expect(screen.getByRole('alertdialog')).toBeVisible();
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel',
    }),
  );
  expect(screen.getByRole('option', { name: 'report.pdf' })).toBeVisible();
});

it('empty trash requires confirmation and refreshes the list', async () => {
  const user = userEvent.setup();
  addTrash(drive.folder('A'));
  renderApp('/trash', testUser);
  await screen.findByRole('option', { name: 'A' });
  await user.click(screen.getByRole('button', { name: 'Empty trash' }));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Empty trash',
    }),
  );
  await screen.findByText('Trash is empty');
  expect(emptied).toBe(1);
});

it('optimistically removes Drive items, persists undo across navigation and restores', async () => {
  const user = userEvent.setup();
  const node = drive.folder('A');
  const router = renderApp('/drive', testUser);
  await user.click(await screen.findByRole('option', { name: 'A' }));
  await chooseSelectionAction(user, 'Move to trash');
  await screen.findByText('Moved to trash');
  expect(screen.queryByRole('option', { name: 'A' })).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate('/trash');
  });
  await screen.findByRole('option', { name: 'A' });
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  await screen.findByText('Trash is empty');
  expect(requests[0]).toEqual([node.id]);
  await waitFor(() => {
    expect(
      screen.queryByRole('button', { name: 'Undo' }),
    ).not.toBeInTheDocument();
  });
});

it('rolls back optimistic trash on error and keeps selection', async () => {
  const user = userEvent.setup();
  drive.folder('A');
  server.use(
    http.post('/api/v1/nodes/trash', async () => {
      await delay(100);
      return HttpResponse.json({}, { status: 500 });
    }),
  );
  renderApp('/drive', testUser);
  await user.click(await screen.findByRole('option', { name: 'A' }));
  await chooseSelectionAction(user, 'Move to trash');
  expect(screen.queryByRole('option', { name: 'A' })).not.toBeInTheDocument();
  await screen.findByRole('alert');
  expect(await screen.findByRole('option', { name: 'A' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

it('shows restore errors without losing items and reports list failures', async () => {
  const user = userEvent.setup();
  addTrash(drive.folder('A'));
  server.use(
    http.post('/api/v1/trash/restore', () =>
      HttpResponse.json({}, { status: 404 }),
    ),
  );
  renderApp('/trash', testUser);
  await user.click(await screen.findByRole('option', { name: 'A' }));
  await chooseSelectionAction(user, 'Restore');
  await screen.findByRole('alert');
  expect(screen.getByRole('option', { name: 'A' })).toBeVisible();
});

it('expires the undo notification after eight seconds', async () => {
  vi.useFakeTimers();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TrashToast />
    </QueryClientProvider>,
  );
  act(() => {
    useTrashNotice.getState().show(['node']);
  });
  expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7999);
  });
  expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(
    screen.queryByRole('button', { name: 'Undo' }),
  ).not.toBeInTheDocument();
});

it('keeps undo available after a restore failure and can dismiss the toast', async () => {
  const user = userEvent.setup();
  drive.folder('A');
  server.use(
    http.post('/api/v1/trash/restore', () =>
      HttpResponse.json({}, { status: 500 }),
    ),
  );
  renderApp('/drive', testUser);
  await user.click(await screen.findByRole('option', { name: 'A' }));
  await chooseSelectionAction(user, 'Move to trash');
  await user.click(await screen.findByRole('button', { name: 'Undo' }));
  await screen.findByText('Could not undo. Try again or restore from Trash.');
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await user.click(
    screen.getByRole('button', { name: 'Dismiss notification' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Undo' }),
  ).not.toBeInTheDocument();
});

it('reports a failed trash listing and retries it', async () => {
  const user = userEvent.setup();
  server.use(
    http.get('/api/v1/trash', () => HttpResponse.json({}, { status: 500 })),
  );
  renderApp('/trash', testUser);
  await screen.findByText('Could not load trash');
  server.use(
    http.get('/api/v1/trash', () =>
      HttpResponse.json({ results: [], next: null, previous: null }),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Trash is empty');
});
