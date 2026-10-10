/** S-05 routes (ui-ux.md): the root folder lives at /drive. */
export function folderPath(folderId: string | undefined): string {
  return folderId ? `/drive/folders/${folderId}` : '/drive';
}
