import {
  Clock3,
  Cloud,
  HardDrive,
  Settings,
  Share2,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMe } from '@/features/settings/use-me';
import { StorageMeter } from '@/features/storage/storage-meter';

import { LanguageSwitcher } from './language-switcher';
import { ThemeSwitcher } from './theme-switcher';

interface AppSidebarProps {
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
}

const navigationItems = [
  { key: 'drive', to: '/drive', icon: HardDrive },
  { key: 'recent', to: '/recent', icon: Clock3 },
  { key: 'shared', to: '/shared', icon: Share2 },
  { key: 'trash', to: '/trash', icon: Trash2 },
] as const;

function navigationLinkClassName({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
    isActive && 'bg-sidebar-accent text-sidebar-foreground',
  );
}

export function AppSidebar({
  isOpen,
  triggerRef,
  onClose,
  onOpenChange,
}: AppSidebarProps): React.JSX.Element {
  const { t } = useTranslation();
  const me = useMe();

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center justify-between px-5">
        <NavLink
          className="flex items-center gap-2.5 rounded-md"
          to="/drive"
          onClick={onClose}
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Cloud className="size-4.5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            {t('app.name')}
          </span>
        </NavLink>
        <Button
          className="lg:hidden"
          variant="ghost"
          size="icon"
          aria-label={t('shell.closeNavigation')}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      <nav
        className="flex-1 space-y-1 px-3 py-4"
        aria-label={t('navigation.main')}
      >
        {navigationItems.map(({ key, to, icon: Icon }) => (
          <NavLink
            key={key}
            to={to}
            onClick={onClose}
            className={navigationLinkClassName}
          >
            <Icon className="size-4.5" aria-hidden="true" />
            {t(`navigation.${key}`)}
          </NavLink>
        ))}
        {me.data?.is_superuser && (
          <NavLink
            to="/moderation"
            onClick={onClose}
            className={navigationLinkClassName}
          >
            <Shield className="size-4.5" aria-hidden="true" />
            {t('navigation.moderation')}
          </NavLink>
        )}
      </nav>

      <div className="space-y-3 border-t border-border px-4 py-4">
        <StorageMeter onNavigate={onClose} />
        <NavLink
          to="/settings"
          end
          onClick={onClose}
          className={navigationLinkClassName}
        >
          <Settings className="size-4.5" aria-hidden="true" />
          {t('navigation.settings')}
        </NavLink>
        <div
          className="flex items-center gap-1 border-t border-border pt-3 sm:hidden"
          aria-label={t('navigation.preferences')}
          role="group"
        >
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">
        {sidebar}
      </div>
      <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay lg:hidden" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 w-64 shadow-soft outline-none lg:hidden"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            <Dialog.Title className="sr-only">
              {t('navigation.main')}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {t('shell.navigationDescription')}
            </Dialog.Description>
            {sidebar}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
