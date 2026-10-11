import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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
import { FakeDrive } from '@/test/drive-server';
import { renderApp } from '@/test/render-app';
import { testUser } from '@/test/auth';
import { i18n } from '@/lib/i18n';
import { compactId } from '@/features/drive/paths';
import { setMediaQuery } from '@/test/match-media';
import { DESKTOP_INPUT_QUERY } from '@/features/drive/desktop-input';

const server = setupServer();
let drive: FakeDrive;
let requests: string[] = [];
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) =>
    requests.push(new URL(request.url).pathname),
  );
});
beforeEach(async () => {
  drive = new FakeDrive();
  requests = [];
  server.use(...drive.handlers());
  setMediaQuery(DESKTOP_INPUT_QUERY, true);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});
const page = (results: unknown[], next: string | null = null) =>
  HttpResponse.json({ results, next, previous: null });
const grant = (nodeId: string) => ({
  id: '11111111-1111-7111-8111-111111111111',
  node_id: nodeId,
  grantee: {
    id: testUser.id,
    email: 'friend@example.com',
    display_name: 'Friend',
  },
  role: 'viewer',
  created_by_id: testUser.id,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
async function dialog() {
  const user = userEvent.setup();
  const node = drive.file('Owned.txt');
  server.use(
    http.get('/api/v1/nodes/:id/shares', () => page([])),
    http.get('/api/v1/nodes/:id/links', () => page([])),
  );
  renderApp('/drive', testUser);
  await user.click(await screen.findByRole('option', { name: node.name }));
  await user.click(await screen.findByRole('button', { name: 'Share' }));
  const modal = await screen.findByRole('dialog', { name: 'Share Owned.txt' });
  await within(modal).findByRole('button', { name: 'Create link' });
  return { user, node, modal };
}
it('adds a grant, changes role and revokes it using the sharing dialog', async () => {
  const { user, node, modal } = await dialog();
  let shares: ReturnType<typeof grant>[] = [];
  server.use(
    http.get('/api/v1/nodes/:id/shares', () => page(shares)),
    http.post('/api/v1/nodes/:id/shares', async ({ request }) => {
      expect(await request.json()).toEqual({
        email: 'friend@example.com',
        role: 'viewer',
      });
      shares = [grant(node.id)];
      return HttpResponse.json(shares[0], { status: 201 });
    }),
    http.patch('/api/v1/shares/:id', async ({ request }) => {
      const body = (await request.json()) as { role: string };
      shares = shares.map((s) => ({ ...s, role: body.role }));
      return HttpResponse.json(shares[0]);
    }),
    http.delete('/api/v1/shares/:id', () => {
      shares = [];
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await user.type(
    within(modal).getByLabelText('Recipient email'),
    'friend@example.com',
  );
  await user.click(within(modal).getByRole('button', { name: 'Share' }));
  const select = await within(modal).findByRole('combobox', {
    name: 'Role for friend@example.com',
  });
  await user.selectOptions(select, 'editor');
  await waitFor(() => expect(select).toHaveValue('editor'));
  await user.click(
    within(modal).getByRole('button', {
      name: 'Remove access for friend@example.com',
    }),
  );
  await waitFor(() =>
    expect(within(modal).queryByText('Friend')).not.toBeInTheDocument(),
  );
});
it.each(['invalid_share_recipient', 'invalid_share_target', 'share_exists'])(
  'maps %s without exposing backend error text',
  async (code) => {
    const { user, modal } = await dialog();
    server.use(
      http.post('/api/v1/nodes/:id/shares', () =>
        HttpResponse.json(
          { error: { code, message: 'Sensitive server text', details: {} } },
          { status: 400 },
        ),
      ),
    );
    await user.type(
      within(modal).getByLabelText('Recipient email'),
      'friend@example.com',
    );
    await user.click(within(modal).getByRole('button', { name: 'Share' }));
    expect(await within(modal).findByRole('alert')).toBeVisible();
    expect(screen.queryByText('Sensitive server text')).not.toBeInTheDocument();
  },
);
it('rejects past expiry, creates, copies and revokes a link', async () => {
  const { user, node, modal } = await dialog();
  let links: Record<string, unknown>[] = [];
  const clipboard = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue();
  server.use(
    http.get('/api/v1/nodes/:id/links', () => page(links)),
    http.post('/api/v1/nodes/:id/links', async ({ request }) => {
      expect(await request.json()).toEqual({ expires_at: null });
      links = [
        {
          ...grant(node.id),
          token: 'public-token',
          expires_at: null,
          revoked_at: null,
        },
      ];
      return HttpResponse.json(links[0], { status: 201 });
    }),
    http.delete('/api/v1/links/:id', () => {
      links = links.map((link) => ({
        ...link,
        revoked_at: new Date().toISOString(),
      }));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await user.type(
    within(modal).getByLabelText('Expires at (optional)'),
    '2020-01-01T00:00',
  );
  await user.click(within(modal).getByRole('button', { name: 'Create link' }));
  expect(await within(modal).findByRole('alert')).toHaveTextContent('future');
  await user.clear(within(modal).getByLabelText('Expires at (optional)'));
  await user.click(within(modal).getByRole('button', { name: 'Create link' }));
  await user.click(
    await within(modal).findByRole('button', { name: 'Copy link' }),
  );
  expect(clipboard).toHaveBeenCalledWith(
    new URL('/s/public-token', window.location.origin).href,
  );
  await user.click(within(modal).getByRole('button', { name: 'Revoke link' }));
  expect(await within(modal).findByText('Revoked')).toBeVisible();
  expect(
    within(modal).getByRole('button', { name: 'Copy link' }),
  ).toBeDisabled();
});
it('does not offer public link creation to an editor', async () => {
  const { modal, node } = await dialog();
  server.use(
    http.get(
      `/api/v1/nodes/${node.id}/links`,
      () => new HttpResponse(null, { status: 404 }),
    ),
  );
  await userEvent
    .setup()
    .click(within(modal).getByRole('button', { name: 'Close' }));
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Share' }));
  expect(
    await screen.findByText('Only the owner can manage public links.'),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Create link' }),
  ).not.toBeInTheDocument();
});
it('lists shared items, owner and effective role and opens the canonical file route', async () => {
  const node = drive.file('Shared.txt');
  server.use(
    http.get('/api/v1/shared-with-me', () =>
      page([
        {
          ...node,
          owner: { id: testUser.id, display_name: 'Owner name' },
          effective_role: 'viewer',
        },
      ]),
    ),
  );
  const router = renderApp('/shared', testUser);
  expect(await screen.findByText('Owner name · Viewer')).toBeVisible();
  await userEvent
    .setup()
    .dblClick(screen.getByRole('option', { name: node.name }));
  await waitFor(() => {
    expect(router.state.location.pathname).not.toBe('/shared');
  });
  expect(await screen.findByRole('dialog', { name: node.name })).toBeVisible();
});
it('renders shared loading failures with retry and an empty state', async () => {
  let failed = true;
  server.use(
    http.get('/api/v1/shared-with-me', () =>
      failed ? new HttpResponse(null, { status: 500 }) : page([]),
    ),
  );
  renderApp('/shared', testUser);
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Try again' }));
  failed = false;
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Nothing shared yet')).toBeVisible();
});
it('hides writing and sharing actions from a viewer in a shared folder', async () => {
  const folder = drive.folder('Viewer folder');
  const node = drive.file('Read only.txt', folder.id);
  server.use(
    http.get('/api/v1/nodes/:id', ({ params }) =>
      HttpResponse.json({
        ...drive.nodes.get(String(params.id)),
        breadcrumb: [],
        capabilities: { can_edit: false, can_trash: false, can_share: false },
      }),
    ),
  );
  renderApp(`/drive/folders/${compactId(folder.id)}`, testUser);
  await userEvent
    .setup()
    .click(await screen.findByRole('option', { name: node.name }));
  await waitFor(() => {
    expect(requests).toContain(`/api/v1/nodes/${node.id}`);
  });
  expect(
    screen.queryByRole('button', { name: 'Rename' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Share' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Move to trash' }),
  ).not.toBeInTheDocument();
});
it.each([null, testUser])(
  'uses public APIs exclusively for a public file, independent of session',
  async (user) => {
    const node = drive.file('Public.txt');
    server.use(
      http.get('/api/v1/public/links/:token', () =>
        HttpResponse.json({
          ...node,
          parent_id: null,
          breadcrumb: [],
          capabilities: { can_edit: false, can_trash: false, can_share: false },
        }),
      ),
      http.get('/api/v1/public/links/:token/preview', () =>
        HttpResponse.json({
          kind: 'text',
          url: 'https://storage.example/public',
          expires_at: new Date(Date.now() + 300000).toISOString(),
          thumbnail: null,
        }),
      ),
      http.get('https://storage.example/public', () =>
        HttpResponse.text('Public content'),
      ),
    );
    renderApp('/s/token', user);
    const modal = await screen.findByRole('dialog', { name: node.name });
    expect(await within(modal).findByText('Public content')).toBeVisible();
    expect(requests.some((path) => path.startsWith('/api/v1/nodes/'))).toBe(
      false,
    );
    expect(requests).toContain('/api/v1/public/links/token/preview');
    await userEvent.setup().keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);
it('shows the same friendly state for invalid, expired and revoked links', async () => {
  server.use(
    http.get(
      '/api/v1/public/links/:token',
      () => new HttpResponse(null, { status: 404 }),
    ),
  );
  renderApp('/s/missing');
  expect(
    await screen.findByText('Content is no longer available'),
  ).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('paginates a public folder and confines breadcrumbs to the link tree', async () => {
  const folder = drive.folder('Shared root');
  const nested = drive.folder('Nested', folder.id);
  const first = drive.file('First.txt', folder.id);
  const later = drive.file('Later.txt', folder.id);
  server.use(
    http.get('/api/v1/public/links/:token', ({ request }) => {
      const id = new URL(request.url).searchParams.get('node_id');
      return HttpResponse.json({
        ...(!id || id === folder.id ? folder : nested),
        parent_id: id === nested.id ? folder.id : null,
        breadcrumb:
          id === nested.id ? [{ id: folder.id, name: folder.name }] : [],
        capabilities: { can_edit: false, can_trash: false, can_share: false },
      });
    }),
    http.get('/api/v1/public/links/:token/children', ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('folder_id') === nested.id) return page([]);
      return url.searchParams.has('cursor')
        ? page([later])
        : page(
            [first, nested],
            'http://localhost/api/v1/public/links/token/children?cursor=next',
          );
    }),
  );
  const router = renderApp('/s/token');
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: /Load more/ }));
  expect(await screen.findByRole('option', { name: later.name })).toBeVisible();
  await userEvent
    .setup()
    .dblClick(screen.getByRole('option', { name: nested.name }));
  expect(
    await screen.findByRole('link', { name: folder.name }),
  ).toHaveAttribute('href', '/s/token');
  expect(router.state.location.search).toContain(compactId(nested.id));
  expect(requests.some((path) => path.startsWith('/api/v1/nodes/'))).toBe(
    false,
  );
});

it('paginates direct grants in the dialog and keeps link pagination separate', async () => {
  const { user, node, modal } = await dialog();
  const first = grant(node.id);
  const second = {
    ...first,
    id: '22222222-2222-7222-8222-222222222222',
    grantee: {
      ...first.grantee,
      email: 'later@example.com',
      display_name: 'Later',
    },
  };
  server.use(
    http.get('/api/v1/nodes/:id/shares', ({ request }) =>
      new URL(request.url).searchParams.has('cursor')
        ? page([second])
        : page(
            [first],
            'http://localhost/api/v1/nodes/node/shares?cursor=next',
          ),
    ),
  );
  await user.click(within(modal).getByRole('button', { name: 'Close' }));
  await user.click(await screen.findByRole('button', { name: 'Share' }));
  const section = await screen.findByRole('region', {
    name: 'People with access',
  });
  await user.click(
    await within(section).findByRole('button', { name: 'Load more' }),
  );
  expect(await within(section).findByText('Later')).toBeVisible();
  expect(within(section).getByText('Friend')).toBeVisible();
});

it('denies an outside-tree preview through the public API without falling back to a session', async () => {
  const folder = drive.folder('Public root');
  const outside = drive.file('Private.txt');
  server.use(
    http.get('/api/v1/public/links/:token', ({ request }) =>
      new URL(request.url).searchParams.has('node_id')
        ? new HttpResponse(null, { status: 404 })
        : HttpResponse.json({
            ...folder,
            parent_id: null,
            breadcrumb: [],
            capabilities: {
              can_edit: false,
              can_share: false,
              can_trash: false,
            },
          }),
    ),
    http.get('/api/v1/public/links/:token/children', () => page([])),
  );
  renderApp(`/s/token?preview=${compactId(outside.id)}`, testUser);
  expect(await screen.findByText('Unable to preview this file.')).toBeVisible();
  expect(requests.some((path) => path.startsWith('/api/v1/nodes/'))).toBe(
    false,
  );
  expect(requests).not.toContain('/api/v1/public/links/token/preview');
});
