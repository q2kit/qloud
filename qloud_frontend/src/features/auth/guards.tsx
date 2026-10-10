import { RotateCw } from 'lucide-react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { safeNextPath } from './auth-errors';
import { useSession } from './use-auth';

function SessionPending(): React.JSX.Element {
  // Brief, so no skeleton: an empty page avoids flashing the wrong screen.
  return <div className="min-h-screen bg-background" aria-busy="true" />;
}

function SessionError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <section className="max-w-md space-y-4 text-center" role="alert">
        <h1 className="text-xl font-semibold">
          {t('auth.sessionError.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('auth.sessionError.description')}
        </p>
        <Button onClick={onRetry}>
          <RotateCw />
          {t('auth.sessionError.retry')}
        </Button>
      </section>
    </main>
  );
}

/** Renders child routes for signed-in users; sends others to /login?next=… */
export function RequireAuth(): React.JSX.Element {
  const location = useLocation();
  const session = useSession();

  if (session.isPending) return <SessionPending />;
  if (session.isError) {
    return (
      <SessionError
        onRetry={() => {
          void session.refetch();
        }}
      />
    );
  }
  if (!session.data.user) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    const search = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
    return <Navigate to={`/login${search}`} replace />;
  }
  return <Outlet />;
}

/** Login and signup are for visitors: signed-in users go on to `next`. */
export function RedirectIfAuthenticated(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const session = useSession();

  if (session.isPending) return <SessionPending />;
  if (session.data?.user) {
    return <Navigate to={safeNextPath(searchParams.get('next'))} replace />;
  }
  return <Outlet />;
}
