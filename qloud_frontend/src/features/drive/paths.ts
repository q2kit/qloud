/** S-05 routes (ui-ux.md): the root folder lives at /drive. */
export function folderPath(folderId: string | undefined): string {
  return folderId ? `/drive/folders/${folderId}` : '/drive';
}

/** The absolute URL of a folder, to open in a new tab or share as a link. */
export function folderUrl(folderId: string | undefined): string {
  return new URL(folderPath(folderId), window.location.origin).toString();
}
