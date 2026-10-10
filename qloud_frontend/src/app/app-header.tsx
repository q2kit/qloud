import { FileUp, FolderPlus, Info, Menu, Plus, Search } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AccountMenu } from '@/features/auth/components/account-menu';
import { useDriveStore } from '@/features/drive/store';
import { useCurrentFolderId } from '@/features/drive/use-current-folder';
import { useUploader } from '@/features/upload/context';
import { cn } from '@/lib/utils';

import { LanguageSwitcher } from './language-switcher';
import { useRouteHandle } from './route-handle';
import { ThemeSwitcher } from './theme-switcher';

// Apple platforms show the Command key symbol; it is not a translatable word.
const COMMAND_KEY_SYMBOL = '⌘';
const isApplePlatform = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

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
  const { titleKey, subtitleKey } = useRouteHandle();
  const setCreatingFolder = useDriveStore((state) => state.setCreatingFolder);
  const uploader = useUploader();
  // Outside the Drive this is the root folder (useCurrentFolderId).
  const folderId = useCurrentFolderId();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const searchShortcut = t('shell.searchShortcut', {
    modifier: isApplePlatform ? COMMAND_KEY_SYMBOL : t('shell.keys.ctrl'),
  });

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

      {/* TODO(M6-02): Connect this trigger to the command palette. */}
      <Button
        className="hidden min-w-48 justify-between text-muted-foreground md:flex"
        variant="outline"
        disabled
      >
        <span className="flex items-center gap-2">
          <Search />
          {t('shell.search')}
        </span>
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px]">
          {searchShortcut}
        </kbd>
      </Button>
      {/* TODO(M6-02): Connect this trigger to the command palette. */}
      <Button
        className="md:hidden"
        variant="ghost"
        size="icon"
        aria-label={t('shell.search')}
        disabled
      >
        <Search />
      </Button>
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" aria-label={t('shell.create')}>
            <Plus />
            <span className="hidden sm:inline">{t('shell.create')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setCreatingFolder(true);
            }}
          >
            <FolderPlus />
            {t('drive.actions.newFolder')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!folderId}
            onSelect={() => {
              fileInput.current?.click();
            }}
          >
            <FileUp />
            {t('drive.actions.upload')}
          </DropdownMenuItem>
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
