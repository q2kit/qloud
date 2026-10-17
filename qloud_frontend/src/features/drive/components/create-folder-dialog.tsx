import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { useCreateFolder } from '../api';
import { driveErrorMessage } from '../errors';
import { folderPath } from '../paths';
import { useDriveStore } from '../store';
import { useCurrentFolderId } from '../use-current-folder';
import { NameDialog } from './name-dialog';

/** Mounted once in the shell: "New folder" works from the header on any page. */
export function CreateFolderDialog(): React.JSX.Element {
  const { t } = useTranslation();
  const open = useDriveStore((state) => state.isCreatingFolder);
  const setOpen = useDriveStore((state) => state.setCreatingFolder);
  const select = useDriveStore((state) => state.select);
  const parentId = useCurrentFolderId();
  const create = useCreateFolder();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <NameDialog
      open={open}
      title={t('drive.dialogs.newFolder')}
      submitLabel={t('drive.actions.create')}
      initialName={t('drive.defaultFolderName')}
      error={create.isError ? driveErrorMessage(create.error, t) : undefined}
      pending={create.isPending}
      onOpenChange={(next) => {
        if (!next) create.reset();
        setOpen(next);
      }}
      onSubmit={(name) => {
        if (!parentId) return;
        create.mutate(
          { parentId, name },
          {
            onSuccess: (folder) => {
              setOpen(false);
              create.reset();
              // From another page, show where the folder went: it was
              // created in the own Drive's root (useCurrentFolderId).
              if (
                !pathname.startsWith('/drive') &&
                !pathname.startsWith('/shared/folders/')
              )
                void navigate(folderPath(undefined));
              select(folder);
            },
          },
        );
      }}
    />
  );
}
