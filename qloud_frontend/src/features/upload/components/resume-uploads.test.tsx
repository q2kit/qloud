import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import { createTestQueryClient } from '@/test/auth';

import type { UploadSession } from '../api';
import { UploaderContext } from '../context';
import type { UploadEngine } from '../engine';
import { ResumeUploads } from './resume-uploads';

const session = {
  id: 'old',
  filename: 'a.txt',
  size: 10,
  parent_id: 'original',
  fingerprint: 'hash',
} as UploadSession;
const server = setupServer();
const restore = vi.fn<UploadEngine['restore']>();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  server.close();
});
afterEach(() => {
  server.resetHandlers();
});
beforeEach(async () => {
  restore.mockReset().mockResolvedValue(false);
  await i18n.changeLanguage('en');
  server.use(
    http.get('/api/v1/uploads', () =>
      HttpResponse.json({ results: [session], next: null }),
    ),
  );
});
function show() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <UploaderContext.Provider value={{ restore } as unknown as UploadEngine}>
        <ResumeUploads />
      </UploaderContext.Provider>
    </QueryClientProvider>,
  );
}

it('asks for the original file and keeps the session available after a mismatch', async () => {
  const user = userEvent.setup();
  show();
  await screen.findByText('a.txt');
  const file = new File(['wrong'], 'a.txt');
  await user.upload(screen.getByLabelText('Reselect a.txt'), file);
  expect(restore).toHaveBeenCalledWith(file, session);
  expect(await screen.findByRole('alert')).toHaveTextContent("doesn't match");
  expect(screen.getByRole('button', { name: 'Select file' })).toBeEnabled();
});

it('cancels an unfinished session through the API and refreshes the list', async () => {
  let cancelled = false;
  server.use(
    http.delete('/api/v1/uploads/old', () => {
      cancelled = true;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/v1/uploads', () =>
      HttpResponse.json({ results: cancelled ? [] : [session], next: null }),
    ),
  );
  const user = userEvent.setup();
  show();
  await screen.findByText('a.txt');
  await user.click(screen.getByRole('button', { name: 'Cancel a.txt' }));
  await waitFor(() => {
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
  });
  expect(cancelled).toBe(true);
});

it('loads additional server pages instead of losing sessions beyond the first page', async () => {
  server.use(
    http.get('/api/v1/uploads', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('cursor')
          ? {
              results: [{ ...session, id: 'second', filename: 'b.txt' }],
              next: null,
            }
          : {
              results: [session],
              next: 'http://localhost/api/v1/uploads?cursor=next&status=active',
            },
      ),
    ),
  );
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole('button', { name: 'Show more' }));
  expect(
    await within(
      screen.getByRole('region', { name: 'Unfinished uploads' }),
    ).findByText('b.txt'),
  ).toBeVisible();
});
