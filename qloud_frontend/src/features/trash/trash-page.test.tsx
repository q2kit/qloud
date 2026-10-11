import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  await user.click(screen.getByRole('button', { name: 'Restore' }));
  await screen.findByText('Trash is empty');
  expect(requests[0]).toEqual([a.id, b.id]);
  expect(useDriveStore.getState().selected).toEqual([]);
  expect(screen.getByRole('button', { name: 'Empty trash' })).toBeDisabled();
});

it('confirms permanent deletion, cancel does not delete, failures can retry', async () => {
  const user = userEvent.setup();
  addTrash(drive.file('report.pdf'));
  renderApp('/trash', testUser);
  await user.click(await screen.findByRole('option', { name: 'report.pdf' }));
  await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(requests).toEqual([]);
  server.use(
    http.post('/api/v1/trash/delete', () =>
      HttpResponse.json({}, { status: 500 }),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
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
  await user.click(screen.getByRole('button', { name: 'Move to trash' }));
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
  await user.click(screen.getByRole('button', { name: 'Move to trash' }));
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
  await user.click(screen.getByRole('button', { name: 'Restore' }));
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
  await user.click(screen.getByRole('button', { name: 'Move to trash' }));
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
