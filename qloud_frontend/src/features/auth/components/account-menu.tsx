import { LogOut, Settings } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useLogout, useSession } from '../use-auth';

/** Header menu with the signed-in account and the logout action. */
export function AccountMenu(): React.JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const logout = useLogout();
  const user = session?.user;
  if (!user) return null;
  const initial = (user.display || user.email).charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('account.menu')}>
          <span
            className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate font-medium">{user.display}</span>
          {user.display !== user.email && (
            <span className="block truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings />
            {t('navigation.settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={logout.isPending}
          onSelect={() => {
            logout.mutate(undefined, {
              onSuccess: () => {
                void navigate('/login', { replace: true });
              },
            });
          }}
        >
          <LogOut />
          {t('account.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
