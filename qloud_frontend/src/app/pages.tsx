import { FolderPlus, LayoutGrid, List, RotateCw, Upload } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { HealthStatus } from '@/features/health/health-status';

export function DrivePage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex min-h-[calc(100vh-7.75rem)] max-w-7xl flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t('drive.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('drive.description')}
          </p>
        </div>
        <div
          className="flex items-center rounded-lg border border-border bg-card p-1"
          aria-label={t('drive.view.label')}
          role="group"
        >
          {/* TODO(M2-07): Enable view switching with the Drive implementation. */}
          <Button
            size="icon"
            variant="secondary"
            aria-label={t('drive.view.grid')}
            aria-pressed="true"
            disabled
          >
            <LayoutGrid />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('drive.view.list')}
            aria-pressed="false"
            disabled
          >
            <List />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center py-12">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-soft">
            <Upload className="size-6 text-primary" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold">{t('drive.empty.title')}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {t('drive.empty.description')}
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            {/* TODO(M2-08): Connect this action to the upload manager. */}
            <Button disabled>
              <Upload />
              {t('drive.actions.upload')}
            </Button>
            {/* TODO(M2-02): Connect this action to folder creation. */}
            <Button variant="outline" disabled>
              <FolderPlus />
              {t('drive.actions.newFolder')}
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <HealthStatus />
      </div>
    </section>
  );
}

interface SectionPlaceholderPageProps {
  titleKey: string;
  descriptionKey: string;
}

export function SectionPlaceholderPage({
  titleKey,
  descriptionKey,
}: SectionPlaceholderPageProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="mx-auto max-w-3xl py-8">
      <h1 className="text-xl font-semibold tracking-tight">{t(titleKey)}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {t(descriptionKey)}
      </p>
    </section>
  );
}

/**
 * Root route error boundary. Rendered outside the app shell because the shell
 * itself may be what failed; React Router logs the error to the console.
 */
export function RouteErrorPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="mx-auto max-w-lg space-y-4 text-center" role="alert">
        <h1 className="text-3xl font-semibold">{t('routeError.title')}</h1>
        <p className="text-muted-foreground">{t('routeError.description')}</p>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            <RotateCw />
            {t('routeError.reload')}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">{t('navigation.home')}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

export function NotFoundPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-lg space-y-4 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="text-3xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-muted-foreground">{t('notFound.description')}</p>
      <Button asChild>
        <Link to="/">{t('navigation.home')}</Link>
      </Button>
    </section>
  );
}
