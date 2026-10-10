import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';

import type { FolderConflictChoice, UploadedNode } from './api';
import { uploadTree } from './folders';

const conflict = () =>
  new ApiError(409, {
    error: { code: 'name_conflict', message: '', details: {} },
  });

function deps(choice: FolderConflictChoice = 'rename') {
  return {
    create: vi.fn(
      (parent: string, name: string, _choice: string): Promise<UploadedNode> =>
        Promise.resolve({
          id: `${parent}/${name}`,
          name: _choice,
        } as UploadedNode),
    ),
    choose: vi.fn(() => Promise.resolve(choice)),
    add: vi.fn(),
    onFolder: vi.fn(),
  };
}

describe('uploading a folder tree', () => {
  it('creates ancestors first, keeps empty folders and maps files to renamed ids', async () => {
    const d = deps();
    d.create
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ id: 'renamed' } as UploadedNode);
    const file = new File(['a'], 'a.txt');
    await uploadTree(
      {
        directories: ['Photos/Nested', 'Photos', 'Photos/Empty'],
        files: [{ file, directory: 'Photos/Nested' }],
      },
      'root',
      d,
    );
    expect(d.create.mock.calls).toEqual([
      ['root', 'Photos', 'fail'],
      ['root', 'Photos', 'rename'],
      ['renamed', 'Nested', 'fail'],
      ['renamed', 'Empty', 'fail'],
    ]);
    expect(d.add).toHaveBeenCalledWith([file], 'renamed/Nested');
  });

  it('merges into an existing folder and leaves file name conflicts to the engine', async () => {
    const d = deps('reuse');
    d.create
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ id: 'existing' } as UploadedNode);
    const file = new File(['a'], 'a.txt');
    await uploadTree(
      { directories: ['Docs'], files: [{ file, directory: 'Docs' }] },
      'root',
      d,
    );
    expect(d.create).toHaveBeenLastCalledWith('root', 'Docs', 'reuse');
    expect(d.add).toHaveBeenCalledWith([file], 'existing');
  });

  it('skips the entire subtree, while still uploading loose files', async () => {
    const d = deps('skip');
    d.create.mockRejectedValueOnce(conflict());
    const file = new File(['a'], 'a.txt');
    await uploadTree(
      {
        directories: ['Docs', 'Docs/Nested'],
        files: [
          { file, directory: 'Docs/Nested' },
          { file, directory: '' },
        ],
      },
      'root',
      d,
    );
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(d.add).toHaveBeenCalledExactlyOnceWith([file], 'root');
  });

  it('propagates permission failures without queuing files in a wrong destination', async () => {
    const d = deps();
    d.create.mockRejectedValueOnce(new Error('permission denied'));
    await expect(
      uploadTree(
        {
          directories: ['Docs'],
          files: [{ file: new File(['x'], 'x'), directory: 'Docs' }],
        },
        'root',
        d,
      ),
    ).rejects.toThrow('permission denied');
    expect(d.choose).not.toHaveBeenCalled();
    expect(d.add).not.toHaveBeenCalled();
  });
});
