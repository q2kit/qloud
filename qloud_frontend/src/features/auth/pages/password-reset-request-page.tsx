import { MailCheck } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { authErrorMessages } from '../auth-errors';
import { AuthCard } from '../components/auth-card';
import { FormAlert, FormField } from '../components/form-field';
import { Turnstile, type TurnstileHandle } from '../components/turnstile';
import { turnstileSiteKey } from '../components/turnstile-config';
import { useRequestPasswordReset } from '../use-auth';

/** S-04, first step: ask for a reset link. */
export function PasswordResetRequestPage(): React.JSX.Element {
  const { t } = useTranslation();
  const requestReset = useRequestPasswordReset();
  const turnstileRef = React.useRef<TurnstileHandle>(null);
  const [email, setEmail] = React.useState('');
  const [turnstileToken, setTurnstileToken] = React.useState('');
  const backToLogin = (
    <Link className="font-medium text-primary hover:underline" to="/login">
      {t('auth.reset.backToLogin')}
    </Link>
  );

  if (requestReset.isSuccess) {
    // Same answer whether or not the email has an account (no enumeration).
    return (
      <AuthCard
        title={t('auth.reset.sentTitle')}
        description={t('auth.reset.sentDescription', { email })}
        footer={backToLogin}
      >
        <div className="flex justify-center">
          <MailCheck className="size-10 text-primary" aria-hidden="true" />
        </div>
      </AuthCard>
    );
  }

  const errors = requestReset.isError
    ? authErrorMessages(requestReset.error, t)
    : { fields: {}, codes: [] };

  return (
    <AuthCard
      title={t('auth.reset.requestTitle')}
      description={t('auth.reset.requestDescription')}
      footer={backToLogin}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          requestReset.mutate(
            { email, turnstileToken },
            {
              onError: () => {
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
        <Turnstile ref={turnstileRef} onToken={setTurnstileToken} />
        <Button
          className="w-full"
          type="submit"
          disabled={
            requestReset.isPending ||
            (Boolean(turnstileSiteKey) && !turnstileToken)
          }
        >
          {requestReset.isPending
            ? t('auth.reset.sending')
            : t('auth.reset.send')}
        </Button>
      </form>
    </AuthCard>
  );
}
