import { useLocation, useParams } from 'react-router';

import { useMe } from '@/features/settings/use-me';

import { uuidFromUrl, type Space } from './paths';

/** The folder the Drive route shows: `/drive/folders/:folderId` or
 * `/shared/folders/:folderId`, or the root at `/drive`. */
export function useCurrentFolderId(): string | undefined {
  const { folderId } = useParams();
  const me = useMe();
  return folderId ? uuidFromUrl(folderId) : me.data?.root_folder_id;
}

/** The space of the current route (paths.ts): `/shared/...` or the own Drive. */
export function useSpace(): Space {
  return useLocation().pathname.startsWith('/shared') ? 'shared' : 'drive';
}
