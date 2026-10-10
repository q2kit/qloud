import { RotateCw } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

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
            <Link to="/drive">{t('navigation.home')}</Link>
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
        <Link to="/drive">{t('navigation.home')}</Link>
      </Button>
    </section>
  );
}
