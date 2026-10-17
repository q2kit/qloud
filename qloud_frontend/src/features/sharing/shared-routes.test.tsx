import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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

import { DESKTOP_INPUT_QUERY } from '@/features/drive/desktop-input';
import { compactId } from '@/features/drive/paths';
import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive, SHARING_OWNER_ID } from '@/test/drive-server';
import { setMediaQuery } from '@/test/match-media';
import { renderApp } from '@/test/render-app';

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

/** Team (shared with the test user) > Notes, plus a file in each. */
function sharedTree() {
  const team = drive.folder('Team');
  const notes = drive.folder('Notes', team.id);
  const plan = drive.file('plan.txt', team.id);
  for (const node of [team, notes, plan]) drive.shared.add(node.id);
  server.use(
    http.get('/api/v1/shared-with-me', () =>
      HttpResponse.json({
        results: [
          {
            ...team,
            owner: { id: SHARING_OWNER_ID, display_name: 'Owner' },
            effective_role: 'editor',
          },
        ],
        next: null,
        previous: null,
      }),
    ),
  );
  return { team, notes, plan };
}

const at = (router: ReturnType<typeof renderApp>) =>
  `${router.state.location.pathname}${router.state.location.search}`;

describe('shared items live under /shared (M8-22)', () => {
  it('opens a shared folder from the list under /shared, with a trail back to it', async () => {
    const { team } = sharedTree();
    const user = userEvent.setup();
    const router = renderApp('/shared', testUser);
    await user.dblClick(await screen.findByRole('option', { name: 'Team' }));
    await waitFor(() => {
      expect(at(router)).toBe(`/shared/folders/${compactId(team.id)}`);
    });
    const trail = await screen.findByRole('navigation', {
      name: 'Folder path',
    });
    expect(within(trail).getByRole('heading', { name: 'Team' })).toBeVisible();
    expect(
      within(trail).getByRole('link', { name: 'Shared with me' }),
    ).toHaveAttribute('href', '/shared');
    expect(
      within(trail).queryByRole('link', { name: 'My Drive' }),
    ).not.toBeInTheDocument();
  });

  it('moves an old /drive link of a shared folder to /shared, and an own folder back', async () => {
    const { team } = sharedTree();
    const router = renderApp(`/drive/folders/${team.id}?view=list`, testUser);
    await waitFor(() => {
      expect(at(router)).toBe(
        `/shared/folders/${compactId(team.id)}?view=list`,
      );
    });

    const own = drive.folder('Mine');
    const second = renderApp(`/shared/folders/${compactId(own.id)}`, testUser);
    await waitFor(() => {
      expect(at(second)).toBe(`/drive/folders/${compactId(own.id)}`);
    });
  });

  it('stays under /shared in subfolders, and Backspace climbs back to the list', async () => {
    const { team, notes } = sharedTree();
    const user = userEvent.setup();
    const router = renderApp(`/shared/folders/${compactId(team.id)}`, testUser);
    await user.dblClick(await screen.findByRole('option', { name: 'Notes' }));
    await waitFor(() => {
      expect(at(router)).toBe(`/shared/folders/${compactId(notes.id)}`);
    });
    await screen.findByRole('heading', { name: 'Notes' });

    await user.keyboard('{Backspace}');
    await waitFor(() => {
      expect(at(router)).toBe(`/shared/folders/${compactId(team.id)}`);
    });
    await screen.findByRole('heading', { name: 'Team' });
    await user.keyboard('{Backspace}');
    await waitFor(() => {
      expect(at(router)).toBe('/shared');
    });
  });

  it('previews a shared file in its shared folder, from either file link', async () => {
    const { team, plan } = sharedTree();
    const preview = `/shared/folders/${compactId(team.id)}?preview=${compactId(plan.id)}`;
    const router = renderApp(`/shared/files/${compactId(plan.id)}`, testUser);
    await waitFor(() => {
      expect(at(router)).toBe(preview);
    });
    expect(
      await screen.findByRole('dialog', { name: 'plan.txt' }),
    ).toBeVisible();

    const old = renderApp(`/drive/files/${compactId(plan.id)}`, testUser);
    await waitFor(() => {
      expect(at(old)).toBe(preview);
    });
  });

  it('previews an own file in the Drive', async () => {
    const file = drive.file('mine.txt');
    const router = renderApp(`/shared/files/${compactId(file.id)}`, testUser);
    await waitFor(() => {
      expect(at(router)).toBe(`/drive?preview=${compactId(file.id)}`);
    });
  });
});
