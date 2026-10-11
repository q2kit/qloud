import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive } from '@/test/drive-server';
import { renderApp } from '@/test/render-app';

const server = setupServer();
let drive: FakeDrive;
let requests: URL[];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(async () => {
  drive = new FakeDrive();
  requests = [];
  server.use(
    ...drive.handlers(),
    http.get('/api/v1/search', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const nodes = [...drive.nodes.values()].filter((n) =>
        n.name.includes(url.searchParams.get('q') ?? ''),
      );
      return HttpResponse.json({
        next: null,
        previous: null,
        results: nodes.map((node) => ({
          ...node,
          owner: { id: testUser.id, display_name: 'Me' },
          effective_role: 'owner',
        })),
      });
    }),
  );
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

async function openPalette() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  return await screen.findByRole('combobox', { name: 'Search term' });
}

it('offers quick commands without requesting search and restores keyboard focus', async () => {
  const user = userEvent.setup();
  renderApp('/drive', testUser);
  await screen.findByRole('heading', { level: 1, name: 'My Drive' });
  const trigger = screen.getAllByRole('button', {
    name: /Search and run commands/,
  })[0];
  if (!trigger) throw new Error('missing trigger');
  trigger.focus();
  const input = await openPalette();
  expect(input).toHaveFocus();
  expect(requests).toHaveLength(0);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });
  await openPalette();
  await user.click(screen.getByRole('option', { name: 'Recent' }));
  expect(await screen.findByRole('heading', { name: 'Recent' })).toBeVisible();
  expect(requests).toHaveLength(0);
});

it('debounces requests, cancels obsolete reads and opens a selected suggestion', async () => {
  const user = userEvent.setup();
  const target = drive.folder('latest');
  let aborted = false;
  server.use(
    http.get('/api/v1/search', async ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      if (url.searchParams.get('q') === 'old') {
        request.signal.addEventListener('abort', () => {
          aborted = true;
        });
        await delay(700);
        return HttpResponse.json({
          next: null,
          previous: null,
          results: [drive.folder('obsolete')],
        });
      }
      return HttpResponse.json({
        next: null,
        previous: null,
        results: [target],
      });
    }),
  );
  const router = renderApp('/drive', testUser);
  const input = await openPalette();
  fireEvent.change(input, { target: { value: 'old' } });
  expect(requests).toHaveLength(0);
  await waitFor(() => {
    expect(requests).toHaveLength(1);
  });
  expect(requests[0]?.searchParams.get('page_size')).toBe('8');
  fireEvent.change(input, { target: { value: 'latest' } });
  await waitFor(() => {
    expect(aborted).toBe(true);
  });
  await screen.findByRole('option', { name: 'latest' });
  await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
  await waitFor(() => {
    expect(router.state.location.pathname).toContain(
      target.id.replaceAll('-', ''),
    );
  });
  expect(
    screen.queryByRole('dialog', { name: 'Search and commands' }),
  ).not.toBeInTheDocument();
});

it('opens all results and keeps filters in URLs through back navigation', async () => {
  const user = userEvent.setup();
  drive.file('report.txt');
  const router = renderApp('/drive', testUser);
  const input = await openPalette();
  await user.type(input, 'report');
  await screen.findByRole('option', { name: 'report.txt' });
  await user.click(screen.getByRole('option', { name: 'View all results' }));
  expect(
    await screen.findByRole('heading', { name: 'Search results' }),
  ).toBeVisible();
  await user.selectOptions(screen.getByLabelText('Type'), 'document');
  await user.selectOptions(screen.getByLabelText('Owner'), 'others');
  await waitFor(() => {
    expect(router.state.location.search).toContain('owner=others');
  });
  expect(router.state.location.search).toContain('type=document');
  await act(async () => {
    await router.navigate(-1);
  });
  expect(screen.getByLabelText('Owner')).toHaveValue('');
  expect(screen.getByLabelText('Type')).toHaveValue('document');
});

it('loads cursor pages and reports errors with a retry', async () => {
  const user = userEvent.setup();
  const first = drive.file('report1');
  const second = drive.file('report2');
  let fail = true;
  server.use(
    http.get('/api/v1/search', ({ request }) => {
      if (fail)
        return HttpResponse.json(
          { error: { code: 'validation_error', message: 'bad', details: {} } },
          { status: 400 },
        );
      const cursor = new URL(request.url).searchParams.get('cursor');
      return HttpResponse.json({
        next: cursor
          ? null
          : 'http://localhost/api/v1/search?q=report&cursor=next',
        previous: null,
        results: [cursor ? second : first],
      });
    }),
  );
  renderApp('/search?q=report', testUser);
  expect(
    await screen.findByText(/Could not load search results/),
  ).toBeVisible();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('option', { name: 'report1' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByRole('option', { name: 'report2' })).toBeVisible();
});

it('does not query blank search and shows an empty state for no matches', async () => {
  const router = renderApp('/search', testUser);
  expect(await screen.findByText('Find a file or folder')).toBeVisible();
  expect(requests).toHaveLength(0);
  await act(async () => {
    await router.navigate('/search?q=missing');
  });
  expect(await screen.findByText('No results found')).toBeVisible();
});

it('runs create-folder and does not stack the palette over another dialog', async () => {
  const user = userEvent.setup();
  renderApp('/drive', testUser);
  await screen.findByRole('heading', { level: 1, name: 'My Drive' });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });
  await openPalette();
  await user.click(screen.getByRole('option', { name: 'New folder' }));
  const dialog = await screen.findByRole('dialog', { name: 'New folder' });
  expect(dialog).toBeVisible();
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(
    screen.queryByRole('dialog', { name: 'Search and commands' }),
  ).toBeNull();
  expect(requests).toHaveLength(0);
});
