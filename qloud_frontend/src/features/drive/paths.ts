/**
 * S-05 routes (ui-ux.md): the root folder lives at /drive, others at /drive/folders/:id.
 * URLs carry the UUID without dashes (32 hex digits); the API keeps the standard form.
 */
export function folderPath(
  folderId: string | undefined,
  fileId?: string,
): string {
  const path = folderId ? `/drive/folders/${compactId(folderId)}` : '/drive';
  return fileId
    ? `${path}?select=${encodeURIComponent(compactId(fileId))}`
    : path;
}

/** The absolute URL of a folder, to open in a new tab or share as a link. */
export function folderUrl(folderId: string | undefined): string {
  return new URL(folderPath(folderId), window.location.origin).toString();
}

export function compactId(id: string): string {
  return id.replaceAll('-', '').toLowerCase();
}

/** The standard UUID for an id from a URL, with or without dashes; otherwise as given
 * (the API then answers 404, shown as "folder not found"). */
export function uuidFromUrl(id: string): string {
  const hex = compactId(id);
  if (!/^[0-9a-f]{32}$/.test(hex)) return id;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
