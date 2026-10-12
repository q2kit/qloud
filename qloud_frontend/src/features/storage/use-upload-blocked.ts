import { useNode } from '@/features/drive/api';
import { useMe } from '@/features/settings/use-me';
import { isUploadBlocked, useStorage } from './api';

/** Whether uploads into `folderId` are blocked because the user's storage is full. */
export function useUploadBlocked(folderId: string | undefined): boolean {
  const storage = useStorage();
  const me = useMe();
  const folder = useNode(folderId);
  return isUploadBlocked(storage.data, me.data, folder.data);
}
