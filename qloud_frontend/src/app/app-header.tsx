import { FileUp, FolderUp, FolderPlus, Info, Menu, Plus } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { CommandPalette } from '@/features/search/command-palette';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMe } from '@/features/settings/use-me';
import { AccountMenu } from '@/features/auth/components/account-menu';
import { useDriveStore } from '@/features/drive/store';
import { useNode } from '@/features/drive/api';
import { useCurrentFolderId } from '@/features/drive/use-current-folder';
import { useUploadBlocked } from '@/features/storage/use-upload-blocked';
import { useUploader } from '@/features/upload/context';
import { useFolderUploader } from '@/features/upload/folder-context';
import { treeFromFiles } from '@/features/upload/drop';
import { useShortcut } from '@/features/shortcuts/context';
import { ariaKeyshortcuts, shortcutLabel } from '@/features/shortcuts/keys';
import { cn } from '@/lib/utils';

import { LanguageSwitcher } from './language-switcher';
import { useRouteHandle } from './route-handle';
import { ThemeSwitcher } from './theme-switcher';

interface AppHeaderProps {
  isDetailOpen: boolean;
  navigationTriggerRef: React.RefObject<HTMLButtonElement | null>;
  detailTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onNavigationOpen: () => void;
  onDetailToggle: () => void;
}

export function AppHeader({
  isDetailOpen,
  navigationTriggerRef,
  detailTriggerRef,
  onNavigationOpen,
  onDetailToggle,
}: AppHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const routeHandle = useRouteHandle();
  const me = useMe();
  const { titleKey, subtitleKey } =
    routeHandle.titleKey === 'navigation.moderation' &&
    me.data?.is_superuser === false
      ? { titleKey: 'notFound.title' }
      : routeHandle;
  const setCreatingFolder = useDriveStore((state) => state.setCreatingFolder);
  const uploader = useUploader();
  // Outside the Drive this is the root folder (useCurrentFolderId).
  const folderId = useCurrentFolderId();
  const folder = useNode(folderId);
  const canCreate =
    folder.data?.is_root === true ||
    folder.data?.capabilities.can_edit === true;
  const uploadBlocked = useUploadBlocked(folderId);
  const canUpload = canCreate && !uploadBlocked;
  const folderUploader = useFolderUploader();
  const directoryInput = React.useRef<HTMLInputElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  // Creating by keyboard belongs to the Drive (ui-ux.md › Phím tắt).
  const { pathname } = useLocation();
  const inDrive =
    pathname === '/drive' || pathname.startsWith('/drive/folders/');
  const createShortcuts = { enabled: inDrive && canCreate };
  // A full quota blocks uploads like the menu items (quota.md › M8-01).
  const uploadShortcuts = { enabled: inDrive && canUpload };
  useShortcut(
    'newFolder',
    () => {
      setCreatingFolder(true);
    },
    createShortcuts,
  );
  useShortcut('upload', () => fileInput.current?.click(), uploadShortcuts);
  useShortcut(
    'uploadFolder',
    () => directoryInput.current?.click(),
    uploadShortcuts,
  );

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <Button
        ref={navigationTriggerRef}
        className="-ml-2 lg:hidden"
        variant="ghost"
        size="icon"
        aria-label={t('shell.openNavigation')}
        onClick={onNavigationOpen}
      >
        <Menu />
      </Button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold tracking-tight">
          {t(titleKey)}
        </p>
        {subtitleKey && (
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            {t(subtitleKey)}
          </p>
        )}
      </div>

      <CommandPalette
        canCreate={canCreate}
        canUpload={canUpload}
        onCreateFolder={() => {
          setCreatingFolder(true);
        }}
        onUploadFiles={() => {
          fileInput.current?.click();
        }}
        onUploadFolder={() => {
          directoryInput.current?.click();
        }}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        data-testid="upload-input"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (folderId && files.length > 0) uploader.add(files, folderId);
          event.target.value = ''; // the same file can be picked again
        }}
      />
      <input
        ref={directoryInput}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: '' }}
        data-testid="upload-folder-input"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (folderId && files.length)
            folderUploader.addTree(treeFromFiles(files), folderId);
          event.target.value = '';
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" aria-label={t('shell.create')}>
            <Plus />
            <span className="hidden sm:inline">{t('shell.create')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!canCreate}
            aria-keyshortcuts={ariaKeyshortcuts('newFolder')}
            onSelect={() => {
              setCreatingFolder(true);
            }}
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
            onSelect={() => {
              fileInput.current?.click();
            }}
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
            onSelect={() => directoryInput.current?.click()}
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
      </DropdownMenu>
      <Button
        ref={detailTriggerRef}
        variant="ghost"
        size="icon"
        aria-label={
          isDetailOpen ? t('shell.closeDetails') : t('shell.openDetails')
        }
        aria-pressed={isDetailOpen}
        aria-keyshortcuts={ariaKeyshortcuts('details')}
        className={cn(isDetailOpen && 'bg-accent text-accent-foreground')}
        onClick={onDetailToggle}
      >
        <Info />
      </Button>
      <div className="hidden items-center sm:flex">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
      <AccountMenu />
    </header>
  );
}
