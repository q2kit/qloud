import { CircleCheck, CircleX } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { authErrorMessages } from '../auth-errors';
import { AuthCard } from '../components/auth-card';
import { useSession, useVerifyEmail } from '../use-auth';

/** S-03. Opened from the email link; verifies as soon as the page loads. */
export function VerifyEmailPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { key = '' } = useParams();
  const verify = useVerifyEmail();
  const { data: session } = useSession();
  const started = React.useRef(false);

  React.useEffect(() => {
    // Once per key: a verification link is single use (and StrictMode re-runs effects).
    if (started.current) return;
    started.current = true;
    verify.mutate(key);
  }, [key, verify]);

  const destination = session?.user ? (
    <Button asChild className="w-full">
      <Link to="/">{t('auth.verify.toDrive')}</Link>
    </Button>
  ) : (
    <Button asChild className="w-full">
      <Link to="/login">{t('auth.verify.toLogin')}</Link>
    </Button>
  );

  if (verify.isSuccess) {
    return (
      <AuthCard
        title={t('auth.verify.successTitle')}
        description={t('auth.verify.successDescription')}
      >
        <div className="mb-6 flex justify-center">
          <CircleCheck className="size-10 text-success" aria-hidden="true" />
        </div>
        {destination}
      </AuthCard>
    );
  }
  if (verify.isError) {
    return (
      <AuthCard
        title={t('auth.verify.errorTitle')}
        description={
          authErrorMessages(verify.error, t).form ??
          t('auth.errors.invalidLink')
        }
      >
        <div className="mb-6 flex justify-center">
          <CircleX className="size-10 text-destructive" aria-hidden="true" />
        </div>
        {destination}
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('auth.verify.pendingTitle')}>
      <p className="text-sm text-muted-foreground" role="status">
        {t('auth.verify.pending')}
      </p>
    </AuthCard>
  );
}
