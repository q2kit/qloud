import { CircleCheck } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { authErrorMessages, INVALID_LINK_CODES } from '../auth-errors';
import { AuthCard } from '../components/auth-card';
import { FormAlert, FormField } from '../components/form-field';
import { useResetPassword } from '../use-auth';

/** S-04, second step: choose a new password from the emailed link. */
export function PasswordResetPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { key = '' } = useParams();
  const reset = useResetPassword();
  const [password, setPassword] = React.useState('');

  if (reset.isSuccess) {
    return (
      <AuthCard
        title={t('auth.reset.doneTitle')}
        description={t('auth.reset.doneDescription')}
      >
        <div className="mb-6 flex justify-center">
          <CircleCheck className="size-10 text-success" aria-hidden="true" />
        </div>
        <Button asChild className="w-full">
          <Link to="/login">{t('auth.reset.toLogin')}</Link>
        </Button>
      </AuthCard>
    );
  }

  const errors = reset.isError
    ? authErrorMessages(reset.error, t)
    : { fields: {}, codes: [] };
  // A bad or used link cannot be fixed by retyping the password.
  const linkInvalid = errors.codes.some((code) =>
    INVALID_LINK_CODES.includes(code),
  );

  return (
    <AuthCard
      title={t('auth.reset.newPasswordTitle')}
      description={t('auth.reset.newPasswordDescription')}
      footer={
        <Link
          className="font-medium text-primary hover:underline"
          to="/password/reset"
        >
          {t('auth.reset.requestAgain')}
        </Link>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          reset.mutate({ key, password });
        }}
      >
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <FormField
          label={t('auth.fields.newPassword')}
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          error={errors.fields.password}
          hint={t('auth.signup.passwordHint')}
          disabled={linkInvalid}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <Button
          className="w-full"
          type="submit"
          disabled={reset.isPending || linkInvalid}
        >
          {reset.isPending ? t('auth.reset.saving') : t('auth.reset.save')}
        </Button>
      </form>
    </AuthCard>
  );
}
