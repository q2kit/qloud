export interface UploadTree {
  directories: string[];
  files: { file: File; directory: string }[];
}

/** The picker exposes file paths, but cannot expose completely empty folders. */
export function treeFromFiles(files: File[]): UploadTree {
  const directories = new Set<string>();
  const entries = files.map((file) => {
    const parts = file.webkitRelativePath.split('/').filter(Boolean);
    parts.pop();
    for (let length = 1; length <= parts.length; length += 1)
      directories.add(parts.slice(0, length).join('/'));
    return { file, directory: parts.join('/') };
  });
  return { directories: [...directories], files: entries };
}

/** Capture entries synchronously: the drag data store closes after the drop event. */
export function treeFromDrop(dataTransfer: DataTransfer): Promise<UploadTree> {
  const sources = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      entry: item.webkitGetAsEntry(),
      file: item.getAsFile(),
    }));
  const fallback = [...dataTransfer.files];
  const tree: UploadTree = { directories: [], files: [] };
  async function walk(
    entry: FileSystemEntry,
    directory: string,
  ): Promise<void> {
    if (entry.isDirectory) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      tree.directories.push(path);
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // Chromium returns at most 100 entries per batch; keep reading to exhaustion.
      for (;;) {
        const children = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => {
            reader.readEntries(resolve, reject);
          },
        );
        if (children.length === 0) break;
        for (const child of children) await walk(child, path);
      }
    } else {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      tree.files.push({ file, directory });
    }
  }
  return (async () => {
    if (sources.length === 0) return treeFromFiles(fallback);
    for (const source of sources) {
      if (source.entry) await walk(source.entry, '');
      else if (source.file)
        tree.files.push({ file: source.file, directory: '' });
    }
    return tree;
  })();
}
