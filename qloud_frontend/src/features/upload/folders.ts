import { ApiError } from '@/lib/api/errors';

import type { FolderConflictChoice, UploadedNode } from './api';
import type { UploadTree } from './drop';

interface FolderDeps {
  create: (
    parentId: string,
    name: string,
    choice: 'fail' | 'rename' | 'reuse',
  ) => Promise<UploadedNode>;
  choose: (name: string) => Promise<FolderConflictChoice>;
  add: (files: File[], parentId: string) => void;
  onFolder: (parentId: string) => void;
}

/** Resolve original paths to server ids, even when "keep both" changes a folder name. */
export async function uploadTree(
  tree: UploadTree,
  parentId: string,
  deps: FolderDeps,
): Promise<void> {
  const ids = new Map([['', parentId]]);
  const directories = [...new Set(tree.directories)].sort(
    (a, b) => a.split('/').length - b.split('/').length,
  );
  for (const path of directories) {
    const slash = path.lastIndexOf('/');
    const parent = ids.get(slash < 0 ? '' : path.slice(0, slash));
    if (!parent) continue; // the user skipped an ancestor
    const name = path.slice(slash + 1);
    let folder: UploadedNode;
    try {
      folder = await deps.create(parent, name, 'fail');
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'name_conflict')
        throw error;
      const choice = await deps.choose(name);
      if (choice === 'skip') continue;
      folder = await deps.create(parent, name, choice);
    }
    ids.set(path, folder.id);
    deps.onFolder(parent);
  }
  const groups = new Map<string, File[]>();
  for (const { file, directory } of tree.files) {
    const id = ids.get(directory);
    if (!id) continue;
    const group = groups.get(id) ?? [];
    group.push(file);
    groups.set(id, group);
  }
  for (const [id, files] of groups) deps.add(files, id);
}
