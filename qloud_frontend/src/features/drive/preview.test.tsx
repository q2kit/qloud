import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive, ROOT_ID } from '@/test/drive-server';
import { renderApp } from '@/test/render-app';
import { setMediaQuery } from '@/test/match-media';

import { compactId } from './paths';
import { DESKTOP_INPUT_QUERY } from './desktop-input';

const server = setupServer();
let drive: FakeDrive;
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(async () => {
  drive = new FakeDrive();
  server.use(...drive.handlers());
  setMediaQuery(DESKTOP_INPUT_QUERY, true);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => {
  server.close();
});

it('navigates across a cursor boundary, skips folders and preserves Back/Forward', async () => {
  const user = userEvent.setup();
  drive.pageLimit = 3;
  drive.folder('Folder');
  for (let i = 0; i < 4; i++) drive.file(`file${String(i).padStart(3, '0')}`);
  const target = [...drive.nodes.values()].find(
    (node) => node.name === 'file001',
  );
  if (!target) throw new Error('Missing test target');
  const router = renderApp('/drive', testUser);
  await user.dblClick(await screen.findByRole('option', { name: target.name }));
  const dialog = await screen.findByRole('dialog', { name: target.name });
  await waitFor(() => {
    expect(
      within(dialog).getByRole('button', { name: 'Next file' }),
    ).toBeEnabled();
  });
  await user.click(within(dialog).getByRole('button', { name: 'Next file' }));
  expect(await screen.findByRole('dialog', { name: 'file002' })).toBeVisible();
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Next file' })).toBeEnabled();
  });
  await user.click(screen.getByRole('button', { name: 'Next file' }));
  expect(await screen.findByRole('dialog', { name: 'file003' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next file' })).toBeDisabled();
  await user.keyboard('{ArrowLeft}');
  expect(await screen.findByRole('dialog', { name: 'file002' })).toBeVisible();
  await act(async () => {
    await router.navigate(-1);
  });
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  await act(async () => {
    await router.navigate(1);
  });
  expect(await screen.findByRole('dialog', { name: 'file002' })).toBeVisible();
});

it('resolves a canonical link using the current parent and reaches later pages', async () => {
  const parent = drive.folder('Moved');
  for (let i = 0; i < 110; i++) drive.file(`a${String(i)}`, parent.id);
  const target = drive.file('z-last.txt', parent.id);
  renderApp(`/drive/files/${compactId(target.id)}`, testUser);
  expect(
    await screen.findByRole('dialog', { name: target.name }),
  ).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Previous file' })).toBeEnabled(),
  );
  expect(screen.getByRole('button', { name: 'Next file' })).toBeDisabled();
});

it('shows source text literally, retries errors and restores focus on close', async () => {
  const user = userEvent.setup();
  const target = drive.file('unsafe.txt', ROOT_ID, 42, 'text/plain');
  let fail = true;
  server.use(
    http.get('/api/v1/nodes/:id/preview', () =>
      fail
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json({
            kind: 'text',
            url: 'https://storage.example/text',
            expires_at: new Date(Date.now() + 300000).toISOString(),
            thumbnail: null,
          }),
    ),
    http.get('https://storage.example/text', () =>
      HttpResponse.text(
        '<script>window.PWNED=true</script><img src=x onerror=alert(1)>',
      ),
    ),
  );
  renderApp('/drive', testUser);
  const option = await screen.findByRole('option', { name: target.name });
  await user.click(option);
  await user.keyboard('{Enter}');
  expect(
    await screen.findByText(
      'Unable to preview this file.',
      {},
      { timeout: 3000 },
    ),
  ).toBeVisible();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(
    await screen.findByText(
      '<script>window.PWNED=true</script><img src=x onerror=alert(1)>',
    ),
  ).toBeVisible();
  const dialog = screen.getByRole('dialog');
  expect(dialog.querySelector('script, img')).toBeNull();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(option).toHaveFocus());
});

it('fetches thumbnails only after visibility and falls back on image errors in list view', async () => {
  const observers: IntersectionObserverCallback[] = [];
  class Observer {
    constructor(callback: IntersectionObserverCallback) {
      observers.push(callback);
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const user = userEvent.setup();
  const node = drive.file('photo.png', ROOT_ID, 20, 'image/png');
  const calls = vi.fn();
  server.use(
    http.get('/api/v1/nodes/:id/preview', () => {
      calls();
      return HttpResponse.json({
        kind: 'image',
        url: 'https://storage.example/source',
        expires_at: new Date(Date.now() + 300000).toISOString(),
        thumbnail: {
          url: 'https://storage.example/thumb',
          large_url: 'https://storage.example/large',
          expires_at: new Date(Date.now() + 300000).toISOString(),
        },
      });
    }),
  );
  renderApp('/drive', testUser);
  const option = await screen.findByRole('option', { name: node.name });
  expect(calls).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'List view' }));
  for (const callback of observers)
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  await waitFor(() =>
    expect(option.querySelector('img')).toHaveAttribute(
      'src',
      'https://storage.example/thumb',
    ),
  );
  const image = option.querySelector('img');
  if (!image) throw new Error('Missing thumbnail');
  fireEvent.error(image);
  expect(option.querySelector('img')).toBeNull();
  vi.unstubAllGlobals();
});

it('refreshes visible thumbnail URLs before expiry and stops when hidden', async () => {
  let notify: IntersectionObserverCallback | undefined;
  class Observer {
    constructor(callback: IntersectionObserverCallback) {
      notify = callback;
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const node = drive.file('expires.png', ROOT_ID, 20, 'image/png');
  let calls = 0;
  server.use(
    http.get('/api/v1/nodes/:id/preview', () => {
      calls += 1;
      const expiry = new Date(
        Date.now() + (calls === 1 ? 30500 : 300000),
      ).toISOString();
      return HttpResponse.json({
        kind: 'image',
        url: 'https://storage.example/source',
        expires_at: expiry,
        thumbnail: {
          url: `https://storage.example/thumb${String(calls)}`,
          large_url: 'https://storage.example/large',
          expires_at: expiry,
        },
      });
    }),
  );
  renderApp('/drive', testUser);
  const option = await screen.findByRole('option', { name: node.name });
  act(() => {
    notify?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  await waitFor(() =>
    expect(option.querySelector('img')).toHaveAttribute(
      'src',
      'https://storage.example/thumb1',
    ),
  );
  await waitFor(
    () =>
      expect(option.querySelector('img')).toHaveAttribute(
        'src',
        'https://storage.example/thumb2',
      ),
    { timeout: 3000 },
  );
  act(() => {
    notify?.(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  expect(calls).toBe(2);
});
