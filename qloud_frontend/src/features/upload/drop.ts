/** Files from a drop: plain files only; folders arrive with M2-08b. */
export function filesFromDrop(dataTransfer: DataTransfer): {
  files: File[];
  folders: number;
} {
  const files: File[] = [];
  let folders = 0;
  const items = [...dataTransfer.items];
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry();
      if (entry?.isDirectory) {
        folders += 1;
        continue;
      }
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    return { files, folders };
  }
  return { files: [...dataTransfer.files], folders };
}
