import { Info, Menu, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { AccountMenu } from '@/features/auth/components/account-menu';
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
      {/* TODO(M2-02, M2-08): Enable when create and upload actions exist. */}
      <Button size="sm" disabled>
        <Plus />
        <span className="hidden sm:inline">{t('shell.create')}</span>
      </Button>
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
