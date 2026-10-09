import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { HealthStatus } from '@/features/health/health-status';

export function DrivePage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('drive.title')}
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          {t('drive.description')}
        </p>
      </div>
      <HealthStatus />
    </section>
  );
}

export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-md space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">{t('login.title')}</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        {t('login.description')}
      </p>
    </section>
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
