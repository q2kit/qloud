import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  type MockInstance,
} from 'vitest';

import { i18n } from '@/lib/i18n';
import { testUser } from '@/test/auth';
import { FakeDrive, ROOT_ID } from '@/test/drive-server';
import { renderApp } from '@/test/render-app';

import { UploadEngine } from './engine';

const server = setupServer();
let drive: FakeDrive;
let add: MockInstance<UploadEngine['add']>;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});
beforeEach(async () => {
  drive = new FakeDrive();
  server.use(...drive.handlers());
  add = vi.spyOn(UploadEngine.prototype, 'add').mockReturnValue([]);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  server.resetHandlers();
  add.mockRestore();
});
afterAll(() => {
  server.close();
});

function fileDrop(entries: { file?: File; directory?: boolean }[]) {
  const files = entries.flatMap((entry) => (entry.file ? [entry.file] : []));
  return {
    types: ['Files'],
    files,
    dropEffect: 'none',
    items: entries.map((entry) => ({
      kind: 'file',
      getAsFile: () => entry.file ?? null,
      webkitGetAsEntry: () => null,
    })),
  };
}

describe('starting uploads (M2-08a)', () => {
  it('"Upload files" in the Create menu queues them for the open folder', async () => {
    const user = userEvent.setup();
    const docs = drive.folder('Docs');
    renderApp(`/drive/folders/${docs.id}`, testUser);
    await screen.findByRole('heading', { level: 1, name: 'Docs' });

    const report = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByTestId('upload-input'), report);
    expect(add).toHaveBeenCalledWith([report], docs.id);
    // The menu item opens the picker.
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(
      screen.getByRole('menuitem', { name: 'Upload files' }),
    ).toBeVisible();
  });

  it('files dropped on the page go to the open folder; on a folder, into it', async () => {
    const target = drive.folder('Target');
    renderApp('/drive', testUser);
    const folder = await screen.findByRole('option', { name: 'Target' });
    const page = screen
      .getByRole('heading', { level: 1, name: 'My Drive' })
      .closest('section');
    if (!page) throw new Error('no page');

    const a = new File(['a'], 'a.txt');
    fireEvent.dragEnter(page, { dataTransfer: fileDrop([{ file: a }]) });
    expect(
      screen.getByText('Drop to upload to "My Drive"'),
    ).toBeInTheDocument();
    fireEvent.dragOver(folder, { dataTransfer: fileDrop([{ file: a }]) });
    expect(screen.getByText('Drop to upload to "Target"')).toBeInTheDocument();
    fireEvent.drop(folder, { dataTransfer: fileDrop([{ file: a }]) });
    await waitFor(() => {
      expect(add).toHaveBeenLastCalledWith([a], target.id);
    });
    expect(screen.queryByText(/Drop to upload/)).not.toBeInTheDocument();

    const b = new File(['b'], 'b.txt');
    fireEvent.dragEnter(page, { dataTransfer: fileDrop([{ file: b }]) });
    fireEvent.drop(page, { dataTransfer: fileDrop([{ file: b }]) });
    await waitFor(() => {
      expect(add).toHaveBeenLastCalledWith([b], ROOT_ID);
    });
  });

  it('the empty folder offers to upload', async () => {
    const user = userEvent.setup();
    renderApp('/drive', testUser);
    expect(await screen.findByText('This folder is empty')).toBeVisible();
    expect(
      screen.getAllByRole('button', { name: 'Upload files' })[0],
    ).toBeVisible();
    const input =
      document.querySelectorAll<HTMLInputElement>('input[type="file"]')[2];
    if (!input) throw new Error('no picker');
    await user.upload(input, new File(['c'], 'c.txt'));
    expect(add).toHaveBeenCalledWith([expect.any(File)], ROOT_ID);
  });
});

it('the folder picker creates a nested tree and queues files for the resolved child', async () => {
  const user = userEvent.setup();
  renderApp('/drive', testUser);
  await screen.findByText('This folder is empty');
  const file = new File(['x'], 'a.txt');
  Object.defineProperty(file, 'webkitRelativePath', {
    value: 'Docs/Nested/a.txt',
  });
  await user.upload(screen.getByTestId('upload-folder-input'), file);
  await waitFor(() => {
    expect(add).toHaveBeenCalled();
  });
  const nested = [...drive.nodes.values()].find(
    (node) => node.name === 'Nested',
  );
  expect(add).toHaveBeenCalledWith([file], nested?.id);
  expect([...drive.nodes.values()].some((node) => node.name === 'Docs')).toBe(
    true,
  );
});
