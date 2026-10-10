import { useParams } from 'react-router';

import { useMe } from '@/features/settings/use-me';

import { uuidFromUrl } from './paths';

/** The folder the Drive route shows: `/drive/folders/:folderId`, or the root at `/drive`. */
export function useCurrentFolderId(): string | undefined {
  const { folderId } = useParams();
  const me = useMe();
  return folderId ? uuidFromUrl(folderId) : me.data?.root_folder_id;
}
