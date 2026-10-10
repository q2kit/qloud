import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { authErrorMessages, safeNextPath } from '../auth-errors';
import { AuthCard } from '../components/auth-card';
import { FormAlert, FormField } from '../components/form-field';
import { OAuthButtons } from '../components/oauth-buttons';
import { useLogin, useSession } from '../use-auth';

/** S-01. RedirectIfAuthenticated sends the user on once a session exists. */
export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const login = useLogin();
  const { data: session } = useSession();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [remember, setRemember] = React.useState(false);

  const errors = login.isError
    ? authErrorMessages(login.error, t)
    : { fields: {}, codes: [] };
  // OAuth comes back here: `?error=` when the handshake failed, or a pending
  // provider signup when the provider email matches an account it may not link.
  const oauthError = searchParams.has('error')
    ? t('auth.oauth.failed')
    : session?.flows.some(
          (flow) => flow.id === 'provider_signup' && flow.is_pending,
        )
      ? t('auth.oauth.emailInUse')
      : undefined;
  const nextQuery = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;

  return (
    <AuthCard
      title={t('auth.login.title')}
      description={t('auth.login.description')}
      footer={
        <>
          {t('auth.login.noAccount')}{' '}
          <Link
            className="font-medium text-primary hover:underline"
            to={`/signup${nextQuery}`}
          >
            {t('auth.login.signupLink')}
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate({ email, password, remember });
        }}
      >
        {(errors.form ?? oauthError) && (
          <FormAlert>{errors.form ?? oauthError}</FormAlert>
        )}
        <FormField
          label={t('auth.fields.email')}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          error={errors.fields.email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <div className="space-y-1.5">
          <FormField
            label={t('auth.fields.password')}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            error={errors.fields.password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <div className="text-right">
            <Link
              className="text-xs text-primary hover:underline"
              to="/password/reset"
            >
              {t('auth.login.forgotPassword')}
            </Link>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input accent-primary"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
          />
          {t('auth.login.remember')}
        </label>
        <Button className="w-full" type="submit" disabled={login.isPending}>
          {login.isPending
            ? t('auth.login.submitting')
            : t('auth.login.submit')}
        </Button>
      </form>
      <div className="mt-6">
        <OAuthButtons callbackUrl={`/login${nextQuery}`} />
      </div>
    </AuthCard>
  );
}
