import { MailCheck } from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { authErrorMessages, safeNextPath } from '../auth-errors';
import { AuthCard } from '../components/auth-card';
import { FormAlert, FormField } from '../components/form-field';
import { OAuthButtons } from '../components/oauth-buttons';
import { Turnstile, type TurnstileHandle } from '../components/turnstile';
import { turnstileSiteKey } from '../components/turnstile-config';
import { useSetSession, useSignup } from '../use-auth';

/** S-02. */
export function SignupPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const nextQuery = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  const signup = useSignup();
  const setSession = useSetSession();
  const turnstileRef = React.useRef<TurnstileHandle>(null);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [turnstileToken, setTurnstileToken] = React.useState('');

  if (signup.isSuccess) {
    return (
      <AuthCard
        title={t('auth.signup.successTitle')}
        description={t('auth.signup.successDescription', { email })}
      >
        <div className="mb-6 flex justify-center">
          <MailCheck className="size-10 text-primary" aria-hidden="true" />
        </div>
        <Button
          className="w-full"
          onClick={() => {
            // Storing the session lets RedirectIfAuthenticated take over.
            setSession(signup.data);
          }}
        >
          {t('auth.signup.continue')}
        </Button>
      </AuthCard>
    );
  }

  const errors = signup.isError
    ? authErrorMessages(signup.error, t)
    : { fields: {}, codes: [] };
  const waitingForTurnstile = Boolean(turnstileSiteKey) && !turnstileToken;

  return (
    <AuthCard
      title={t('auth.signup.title')}
      description={t('auth.signup.description')}
      footer={
        <>
          {t('auth.signup.haveAccount')}{' '}
          <Link
            className="font-medium text-primary hover:underline"
            to={`/login${nextQuery}`}
          >
            {t('auth.signup.loginLink')}
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          signup.mutate(
            { email, password, turnstileToken },
            {
              onError: () => {
                // A token is single use; get a new one for the next attempt.
                turnstileRef.current?.reset();
              },
            },
          );
        }}
      >
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
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
        <FormField
          label={t('auth.fields.password')}
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          error={errors.fields.password}
          hint={t('auth.signup.passwordHint')}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <Turnstile ref={turnstileRef} onToken={setTurnstileToken} />
        <Button
          className="w-full"
          type="submit"
          disabled={signup.isPending || waitingForTurnstile}
        >
          {signup.isPending
            ? t('auth.signup.submitting')
            : t('auth.signup.submit')}
        </Button>
      </form>
      <div className="mt-6">
        <OAuthButtons callbackUrl={`/login${nextQuery}`} />
      </div>
    </AuthCard>
  );
}
