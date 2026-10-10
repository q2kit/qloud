import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n';
import { createTestQueryClient } from '@/test/auth';

import { UploaderContext } from '../context';
import type { UploadEngine } from '../engine';
import { useUploadStore, type UploadItem } from '../store';
import { ConflictDialog } from './conflict-dialog';
import { UploadTray } from './upload-tray';

const MB = 1_000_000;

function item(name: string, changes: Partial<UploadItem> = {}): UploadItem {
  return {
    id: name,
    name,
    size: 10 * MB,
    type: 'application/pdf',
    parentId: 'f',
    status: 'uploading',
    loaded: 4 * MB,
    ...changes,
  };
}

const engine = {
  pause: vi.fn(),
  resume: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  pauseAll: vi.fn(),
  resumeAll: vi.fn(),
  retryFailed: vi.fn(),
  resolveConflict: vi.fn(),
};

function show(items: UploadItem[], speed = 0) {
  useUploadStore.setState({ items, speed });
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <UploaderContext.Provider value={engine as unknown as UploadEngine}>
        <UploadTray />
        <ConflictDialog />
      </UploaderContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('upload tray', () => {
  it('is hidden with nothing to show', () => {
    show([]);
    expect(
      screen.queryByRole('region', { name: 'Uploads' }),
    ).not.toBeInTheDocument();
  });

  it('sums up progress, speed and time left', () => {
    show(
      [item('a.pdf'), item('b.pdf', { status: 'done', loaded: 10 * MB })],
      2 * MB,
    );
    const tray = within(screen.getByRole('region', { name: 'Uploads' }));
    expect(tray.getByText('Uploading 1/2')).toBeVisible();
    expect(tray.getByText('2 MB/s · about 3 seconds left')).toBeVisible();
    expect(tray.getByRole('progressbar', { name: 'a.pdf' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(tray.getByText('4 MB / 10 MB')).toBeVisible();
  });

  it('offers the actions that fit each state', async () => {
    const user = userEvent.setup();
    show([
      item('up.pdf'),
      item('held.pdf', { status: 'paused' }),
      item('bad.pdf', { status: 'error', error: 'quota_exceeded' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Pause up.pdf' }));
    expect(engine.pause).toHaveBeenCalledWith('up.pdf');
    await user.click(screen.getByRole('button', { name: 'Resume held.pdf' }));
    expect(engine.resume).toHaveBeenCalledWith('held.pdf');
    expect(
      screen.getByText('Not enough storage left for this file.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry bad.pdf' }));
    expect(engine.retry).toHaveBeenCalledWith('bad.pdf');
    await user.click(
      screen.getByRole('button', { name: 'Retry 1 failed file' }),
    );
    expect(engine.retryFailed).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel up.pdf' }));
    expect(engine.cancel).toHaveBeenCalledWith('up.pdf');
    await user.click(screen.getByRole('button', { name: 'Pause all' }));
    expect(engine.pauseAll).toHaveBeenCalled();
  });

  it('collapses, and closes once nothing is left to do', async () => {
    const user = userEvent.setup();
    show([item('a.pdf', { status: 'done', loaded: 10 * MB })]);
    expect(screen.getByText('Uploaded 1 file')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Collapse uploads' }));
    expect(screen.queryByText('a.pdf')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close uploads' }));
    expect(
      screen.queryByRole('region', { name: 'Uploads' }),
    ).not.toBeInTheDocument();
  });

  it('asks about a taken name, once for all if wanted', async () => {
    const user = userEvent.setup();
    show([
      item('a.pdf', { status: 'conflict' }),
      item('b.pdf', { status: 'conflict' }),
    ]);
    const dialog = within(
      screen.getByRole('dialog', { name: 'Name already in use' }),
    );
    expect(
      dialog.getByText('This folder already has an item named "a.pdf".'),
    ).toBeVisible();
    await user.click(dialog.getByLabelText('Do this for the 1 remaining file'));
    await user.click(dialog.getByRole('button', { name: 'Keep both' }));
    expect(engine.resolveConflict).toHaveBeenCalledWith(
      'a.pdf',
      'rename',
      true,
    );
  });
});
