/**
 * Where an item opens (M8-22): own items under /drive, items others share under
 * /shared. /drive never shows someone else's data.
 */
export type Space = 'drive' | 'shared';

export function spaceOf(
  node: { owner: { id: string } },
  me: { id: string },
): Space {
  return node.owner.id === me.id ? 'drive' : 'shared';
}

/**
 * S-05 routes (ui-ux.md): the root folder lives at /drive, others at /drive/folders/:id;
 * shared folders at /shared/folders/:id, with /shared itself as their list.
 * URLs carry the UUID without dashes (32 hex digits); the API keeps the standard form.
 */
export function folderPath(
  folderId: string | undefined,
  fileId?: string,
  space: Space = 'drive',
): string {
  const path = folderId
    ? `/${space}/folders/${compactId(folderId)}`
    : `/${space}`;
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

/** A file's canonical link; it redirects to its folder with `?preview=`. */
export function filePath(fileId: string, space: Space = 'drive'): string {
  return `/${space}/files/${compactId(fileId)}`;
}

export function nodeUrl(node: { id: string; kind: string }): string {
  return new URL(
    node.kind === 'folder'
      ? folderPath(node.id)
      : `/drive/files/${compactId(node.id)}`,
    window.location.origin,
  ).toString();
}
