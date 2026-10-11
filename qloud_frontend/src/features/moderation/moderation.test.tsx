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
import { renderApp } from '@/test/render-app';
import { FakeDrive, ROOT_ID } from '@/test/drive-server';
import { testUser } from '@/test/auth';
import { i18n } from '@/lib/i18n';

const server = setupServer();
let drive: FakeDrive;
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(async () => {
  drive = new FakeDrive();
  server.use(...drive.handlers());
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});
const id = '0190c0de-0000-7000-8000-000000001234';
const report = {
  id,
  created_at: '2026-10-11T01:00:00Z',
  node_uuid: ROOT_ID,
  node_name: 'Reported folder',
  link_uuid: id,
  root_node_uuid: ROOT_ID,
  owner_uuid: testUser.id,
  reason: 'malware',
  status: 'open',
  message: '<script>malware</script>',
  reporter_email: 'contact@example.com',
  reporter_user_id: null,
  resolved_at: null,
  resolved_by_id: null,
  resolution_note: '',
  resolution: null,
  node_report_count: 3,
  node_open_report_count: 2,
  subject: {
    node: {
      id: ROOT_ID,
      name: 'Current reported name',
      kind: 'folder',
      size: 0,
      mime_type: null,
      trashed_at: null,
    },
    root_node: {
      id: ROOT_ID,
      name: 'Current reported name',
      kind: 'folder',
      size: 0,
      mime_type: null,
      trashed_at: null,
    },
    owner: {
      id: testUser.id,
      display_name: 'Content owner',
      email: 'owner@example.com',
      is_active: true,
      suspended_at: null,
    },
    link_state: 'active',
    link_revoked_at: null,
    link_expires_at: null,
    link_revoke_reason: null,
    resolver_name: null,
  },
};
function adminHandlers(superuser = true) {
  server.use(
    http.get('/api/v1/me', () =>
      HttpResponse.json({
        id: testUser.id,
        email: testUser.email,
        display_name: '',
        avatar_url: null,
        locale: 'en',
        theme: 'system',
        root_folder_id: ROOT_ID,
        is_superuser: superuser,
      }),
    ),
  );
}
async function publicReport() {
  server.use(
    http.get('/api/v1/config', () =>
      HttpResponse.json({ turnstile_site_key: null }),
    ),
    http.get('/api/v1/public/links/:token', () =>
      HttpResponse.json({
        ...drive.nodes.get(ROOT_ID),
        breadcrumb: [],
        capabilities: { can_edit: false, can_share: false, can_trash: false },
      }),
    ),
    http.get('/api/v1/public/links/:token/children', () =>
      HttpResponse.json({ results: [], next: null, previous: null }),
    ),
  );
  const user = userEvent.setup();
  renderApp('/s/public-token');
  await user.click(await screen.findByRole('button', { name: 'Report abuse' }));
  const modal = await screen.findByRole('dialog', { name: 'Report: Drive' });
  return { user, modal };
}
it('submits a scoped anonymous report and shows success', async () => {
  let body: unknown;
  server.use(
    http.post(
      '/api/v1/public/links/:token/reports',
      async ({ request, params }) => {
        expect(params.token).toBe('public-token');
        body = await request.json();
        return HttpResponse.json({ status: 'accepted' }, { status: 202 });
      },
    ),
  );
  const { user, modal } = await publicReport();
  await user.selectOptions(within(modal).getByLabelText('Reason'), 'malware');
  await user.type(
    within(modal).getByLabelText('Description (optional)'),
    'Unsafe download',
  );
  await user.type(
    within(modal).getByLabelText('Contact email (optional)'),
    'contact@example.com',
  );
  await user.click(
    within(modal).getByRole('button', { name: 'Submit report' }),
  );
  await within(modal).findByText('Your report has been accepted. Thank you.');
  expect(body).toEqual({
    node_id: ROOT_ID,
    reason: 'malware',
    message: 'Unsafe download',
    email: 'contact@example.com',
    turnstile_token: '',
  });
  expect(
    within(modal).queryByRole('button', { name: 'Submit report' }),
  ).not.toBeInTheDocument();
});
it.each([
  [429, 'throttled', 'You have submitted 5 new reports'],
  [404, 'not_found', 'This content is no longer available.'],
  [400, 'captcha_invalid', 'Verification failed.'],
])('maps report error %s and permits retry', async (status, code, text) => {
  server.use(
    http.post('/api/v1/public/links/:token/reports', () =>
      HttpResponse.json(
        { error: { code, message: 'secret backend message', details: {} } },
        { status: status },
      ),
    ),
  );
  const { user, modal } = await publicReport();
  await user.click(
    within(modal).getByRole('button', { name: 'Submit report' }),
  );
  await waitFor(() =>
    expect(within(modal).getByRole('alert')).toHaveTextContent(text),
  );
  expect(
    within(modal).queryByText('secret backend message'),
  ).not.toBeInTheDocument();
  expect(
    within(modal).getByRole('button', { name: 'Submit report' }),
  ).toBeEnabled();
});
it('prevents ordinary users from querying moderation and hides navigation', async () => {
  adminHandlers(false);
  const query = vi.fn();
  server.use(http.get('/api/v1/moderation/reports', query));
  renderApp('/moderation', testUser);
  await screen.findByRole('heading', { name: 'Page not found' });
  expect(
    screen.queryByRole('link', { name: 'Moderation' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Moderation')).not.toBeInTheDocument();
  expect(query).not.toHaveBeenCalled();
});
it('shows report details, requires a note and confirmation, resolves and renders audit', async () => {
  adminHandlers();
  let resolved = false;
  const resolve = vi.fn(async ({ request }: { request: Request }) => {
    expect(await request.json()).toEqual({
      action: 'revoke_link',
      note: 'Confirmed malware',
    });
    resolved = true;
    return HttpResponse.json({
      ...report,
      status: 'actioned',
      resolution_note: 'Confirmed malware',
      resolution: {
        id,
        created_at: report.created_at,
        actor_uuid: testUser.id,
        action: 'revoke_link',
        note: 'Confirmed malware',
        targets: { revoked_link_ids: [id] },
      },
    });
  });
  server.use(
    http.get('/api/v1/moderation/reports', () =>
      HttpResponse.json({
        results: resolved ? [] : [report],
        next: null,
        previous: null,
      }),
    ),
    http.get('/api/v1/moderation/reports/:id', () => HttpResponse.json(report)),
    http.post('/api/v1/moderation/reports/:id/resolve', resolve),
  );
  const user = userEvent.setup();
  renderApp(`/moderation?report=${id}`, testUser);
  expect(
    await screen.findByRole('link', { name: 'Moderation' }),
  ).toBeInTheDocument();
  await screen.findByText('contact@example.com');
  expect(screen.getByText('<script>malware</script>')).toBeInTheDocument();
  const review = screen.getByRole('button', { name: 'Review action' });
  expect(review).toBeDisabled();
  await user.type(
    screen.getByLabelText('Note (required)'),
    'Confirmed malware',
  );
  await user.click(review);
  expect(resolve).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(resolve).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Review action' }));
  await user.click(screen.getByRole('button', { name: 'Confirm resolution' }));
  await screen.findByRole('region', { name: 'Resolution history' });
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole('button', { name: 'Review action' }),
  ).not.toBeInTheDocument();
});
it('shows conflict errors without discarding a moderator note', async () => {
  adminHandlers();
  server.use(
    http.get('/api/v1/moderation/reports', () =>
      HttpResponse.json({ results: [report], next: null, previous: null }),
    ),
    http.get('/api/v1/moderation/reports/:id', () => HttpResponse.json(report)),
    http.post('/api/v1/moderation/reports/:id/resolve', () =>
      HttpResponse.json(
        {
          error: { code: 'report_resolved', message: 'resolved', details: {} },
        },
        { status: 409 },
      ),
    ),
  );
  const user = userEvent.setup();
  renderApp(`/moderation?report=${id}`, testUser);
  await user.type(
    await screen.findByLabelText('Note (required)'),
    'Keep this note',
  );
  await user.click(screen.getByRole('button', { name: 'Review action' }));
  await user.click(screen.getByRole('button', { name: 'Confirm resolution' }));
  await screen.findByText(
    'This report has already been resolved. Reload the page.',
  );
  expect(screen.getByLabelText('Note (required)')).toHaveValue(
    'Keep this note',
  );
});

it('reports the file in the public viewer and returns focus to the viewer', async () => {
  const file = drive.file('Public.txt');
  let body: unknown;
  server.use(
    http.get('/api/v1/config', () =>
      HttpResponse.json({ turnstile_site_key: null }),
    ),
    http.get('/api/v1/public/links/:token', () =>
      HttpResponse.json({
        ...file,
        parent_id: null,
        breadcrumb: [],
        capabilities: { can_edit: false, can_share: false, can_trash: false },
      }),
    ),
    http.get('/api/v1/public/links/:token/preview', () =>
      HttpResponse.json({
        kind: 'text',
        url: 'https://storage.example/reported.txt',
        expires_at: new Date(Date.now() + 300000).toISOString(),
        thumbnail: null,
      }),
    ),
    http.get('https://storage.example/reported.txt', () =>
      HttpResponse.text('Public file content'),
    ),
    http.post('/api/v1/public/links/:token/reports', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ status: 'accepted' }, { status: 202 });
    }),
  );
  const user = userEvent.setup();
  renderApp('/s/file-token');
  const viewer = await screen.findByRole('dialog', { name: file.name });
  const trigger = within(viewer).getByRole('button', { name: 'Report abuse' });
  await user.click(trigger);
  const modal = await screen.findByRole('dialog', {
    name: `Report: ${file.name}`,
  });
  await user.click(
    within(modal).getByRole('button', { name: 'Submit report' }),
  );
  await within(modal).findByText('Your report has been accepted. Thank you.');
  expect(body).toMatchObject({ node_id: file.id });
  await user.click(within(modal).getByRole('button', { name: 'Close' }));
  expect(await screen.findByRole('dialog', { name: file.name })).toBeVisible();
});

it('shows target context and filters all related reports across cursor pages', async () => {
  adminHandlers();
  const queries: URL[] = [];
  server.use(
    http.get('/api/v1/moderation/reports', ({ request }) => {
      const url = new URL(request.url);
      queries.push(url);
      return HttpResponse.json({
        results: [
          url.searchParams.has('cursor')
            ? {
                ...report,
                id: '0190c0de-0000-7000-8000-000000001235',
                node_name: 'Another report',
              }
            : report,
        ],
        next:
          url.searchParams.has('node_uuid') && !url.searchParams.has('cursor')
            ? 'http://localhost/api/v1/moderation/reports?cursor=next'
            : null,
        previous: null,
      });
    }),
    http.get('/api/v1/moderation/reports/:id', () => HttpResponse.json(report)),
  );
  const user = userEvent.setup();
  renderApp(`/moderation?report=${id}`, testUser);
  await screen.findByText('Content owner');
  expect(screen.getByText('owner@example.com')).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Reports on the same node' }),
  ).toHaveTextContent('3 reports on this node · 2 open');
  expect(
    screen.getByText('The reported node is also the link root node.'),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'View all reports on this node' }),
  );
  await screen.findByText('Showing reports on the same node');
  expect(queries.at(-1)?.searchParams.get('node_uuid')).toBe(ROOT_ID);
  expect(queries.at(-1)?.searchParams.has('status')).toBe(false);
  await user.click(await screen.findByRole('button', { name: 'Load more' }));
  await screen.findByText('Another report');
  expect(queries.at(-1)?.searchParams.get('node_uuid')).toBe(ROOT_ID);
  expect(queries.at(-1)?.searchParams.get('cursor')).toBe('next');
  await user.click(screen.getByRole('button', { name: 'Clear node filter' }));
  await waitFor(() => {
    expect(queries.at(-1)?.searchParams.has('node_uuid')).toBe(false);
  });
});

it('handles deleted targets and describes an audit with no new changes', async () => {
  adminHandlers();
  server.use(
    http.get('/api/v1/moderation/reports', () =>
      HttpResponse.json({ results: [], next: null, previous: null }),
    ),
    http.get('/api/v1/moderation/reports/:id', () =>
      HttpResponse.json({
        ...report,
        status: 'actioned',
        message: '',
        subject: {
          ...report.subject,
          node: null,
          root_node: null,
          owner: null,
          link_state: 'deleted',
        },
        resolution: {
          id,
          created_at: report.created_at,
          actor_uuid: testUser.id,
          action: 'revoke_link',
          note: 'Already handled',
          targets: { revoked_link_ids: [] },
        },
      }),
    ),
  );
  const user = userEvent.setup();
  renderApp(`/moderation?report=${id}`, testUser);
  await screen.findByText('The reporter did not provide a description.');
  expect(
    screen.getAllByText('Deleted / no longer exists').length,
  ).toBeGreaterThan(1);
  expect(
    screen.getByRole('region', { name: 'Resolution history' }),
  ).toHaveTextContent('No new changes:');
  expect(screen.queryByLabelText('Note (required)')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back to queue' }));
  expect(
    screen.queryByRole('region', { name: 'Resolution history' }),
  ).not.toBeInTheDocument();
});
