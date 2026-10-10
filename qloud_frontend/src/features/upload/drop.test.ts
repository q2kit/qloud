import { expect, it } from 'vitest';

import { treeFromDrop, treeFromFiles } from './drop';

it('reconstructs directory picker paths without changing filenames', () => {
  const file = new File(['x'], 'photo.jpg');
  Object.defineProperty(file, 'webkitRelativePath', {
    value: 'Trip/Day1/photo.jpg',
  });
  expect(treeFromFiles([file])).toEqual({
    directories: ['Trip', 'Trip/Day1'],
    files: [{ file, directory: 'Trip/Day1' }],
  });
});

it('reads every directory batch, including empty folders, and captures entries before awaiting', async () => {
  const file = new File(['x'], 'x.txt');
  const entry = {
    name: 'x.txt',
    isDirectory: false,
    file: (resolve: (file: File) => void) => {
      resolve(file);
    },
  };
  const empty = {
    name: 'Empty',
    isDirectory: true,
    createReader: () => ({
      readEntries: (resolve: (entries: unknown[]) => void) => {
        resolve([]);
      },
    }),
  };
  const batches = [[entry], [empty], []];
  const root = {
    name: 'Docs',
    isDirectory: true,
    createReader: () => ({
      readEntries: (resolve: (entries: unknown[]) => void) => {
        resolve(batches.shift() ?? []);
      },
    }),
  };
  let captured = false;
  const transfer = {
    files: [],
    items: [
      {
        kind: 'file',
        webkitGetAsEntry: () => {
          captured = true;
          return root;
        },
        getAsFile: () => null,
      },
    ],
  } as unknown as DataTransfer;
  const result = treeFromDrop(transfer);
  expect(captured).toBe(true);
  expect(await result).toEqual({
    directories: ['Docs', 'Docs/Empty'],
    files: [{ file, directory: 'Docs' }],
  });
});

it('rejects a failed directory read instead of silently uploading a partial tree', async () => {
  const root = {
    name: 'Docs',
    isDirectory: true,
    createReader: () => ({
      readEntries: (_resolve: unknown, reject: (error: Error) => void) => {
        reject(new Error('unreadable'));
      },
    }),
  };
  await expect(
    treeFromDrop({
      files: [],
      items: [
        { kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null },
      ],
    } as unknown as DataTransfer),
  ).rejects.toThrow('unreadable');
});
