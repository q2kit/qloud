import { Link, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from './language-switcher';
import { ThemeSwitcher } from './theme-switcher';

export function PublicLayout(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            className="rounded-md text-lg font-semibold text-primary"
            to="/"
          >
            {t('app.name')}
          </Link>
          <nav
            className="flex items-center gap-1"
            aria-label={t('navigation.preferences')}
          >
            <LanguageSwitcher />
            <ThemeSwitcher />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
        <Outlet />
      </main>
    </div>
  );
}
