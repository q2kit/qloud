import { FileUp, FolderPlus, FolderUp } from 'lucide-react';
import type * as React from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ariaKeyshortcuts, shortcutLabel } from '@/features/shortcuts/keys';

interface CreateMenuContentProps {
  canCreate: boolean;
  canUpload: boolean;
  uploadBlocked: boolean;
  onCreateFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  side?: 'top' | 'bottom';
}

/** The "Create" menu, shared by the header button and the floating "+" button. */
export function CreateMenuContent({
  canCreate,
  canUpload,
  uploadBlocked,
  onCreateFolder,
  onUploadFiles,
  onUploadFolder,
  side,
}: CreateMenuContentProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <DropdownMenuContent align="end" side={side}>
      <DropdownMenuItem
        disabled={!canCreate}
        aria-keyshortcuts={ariaKeyshortcuts('newFolder')}
        onSelect={onCreateFolder}
      >
        <FolderPlus />
        <span className="flex-1">{t('drive.actions.newFolder')}</span>
        <kbd
          aria-hidden="true"
          className="font-sans text-xs text-muted-foreground"
        >
          {shortcutLabel('newFolder')}
        </kbd>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canUpload}
        title={uploadBlocked ? t('storage.full.uploadBlocked') : undefined}
        aria-keyshortcuts={ariaKeyshortcuts('upload')}
        onSelect={onUploadFiles}
      >
        <FileUp />
        <span className="flex-1">{t('drive.actions.upload')}</span>
        <kbd
          aria-hidden="true"
          className="font-sans text-xs text-muted-foreground"
        >
          {shortcutLabel('upload')}
        </kbd>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canUpload}
        title={uploadBlocked ? t('storage.full.uploadBlocked') : undefined}
        aria-keyshortcuts={ariaKeyshortcuts('uploadFolder')}
        onSelect={onUploadFolder}
      >
        <FolderUp />
        <span className="flex-1">{t('upload.actions.folder')}</span>
        <kbd
          aria-hidden="true"
          className="font-sans text-xs text-muted-foreground"
        >
          {shortcutLabel('uploadFolder')}
        </kbd>
      </DropdownMenuItem>
      {uploadBlocked && (
        <p
          role="note"
          className="max-w-60 px-2 py-1.5 text-xs text-destructive"
        >
          {t('storage.full.uploadBlocked')}
        </p>
      )}
    </DropdownMenuContent>
  );
}
