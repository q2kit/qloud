import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import * as React from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import type { Theme } from '@/app/theme-provider';
import { Button } from '@/components/ui/button';
import {
  changePassword,
  disconnectProvider,
  fetchProviderAccounts,
  redirectToProvider,
  type ProviderAccount,
} from '@/features/auth/api';
import { authErrorMessages } from '@/features/auth/auth-errors';
import { FormAlert, FormField } from '@/features/auth/components/form-field';
import {
  sessionQueryKey,
  useAuthProviders,
  useSession,
  useSetSession,
} from '@/features/auth/use-auth';
import { supportedLanguages, type Language } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { useMe, useUpdateMe, type Me } from './use-me';
import { usePreferences } from './use-preferences';

const THEMES: Theme[] = ['system', 'light', 'dark'];
const providerAccountsKey = ['auth', 'providerAccounts'] as const;

function Section({
  title,
  description,
  children,
}: React.PropsWithChildren<{
  title: string;
  description?: string;
}>): React.JSX.Element {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring',
              option.value === value
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border hover:bg-accent',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={label}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ProfileSection({ me }: { me: Me }): React.JSX.Element {
  const { t } = useTranslation();
  const updateMe = useUpdateMe();
  const [displayName, setDisplayName] = React.useState(me.display_name ?? '');
  // An empty display name falls back to the email.
  const shownName = me.display_name?.trim() ? me.display_name : me.email;
  const initial = shownName.charAt(0).toUpperCase();
  const fieldError = updateMe.error
    ? t('settings.profile.saveFailed')
    : undefined;

  return (
    <Section title={t('settings.profile.title')}>
      <div className="mb-5 flex items-center gap-4">
        {me.avatar_url ? (
          <img
            src={me.avatar_url}
            alt=""
            className="size-14 shrink-0 rounded-full border border-border object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-medium">{shownName}</p>
          {shownName !== me.email && (
            <p className="truncate text-sm text-muted-foreground">{me.email}</p>
          )}
        </div>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          updateMe.mutate({ display_name: displayName.trim() });
        }}
      >
        <FormField
          label={t('settings.profile.displayName')}
          name="display_name"
          maxLength={100}
          autoComplete="name"
          value={displayName}
          error={fieldError}
          hint={t('settings.profile.displayNameHint')}
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={updateMe.isPending}>
            {updateMe.isPending ? t('settings.saving') : t('settings.save')}
          </Button>
          {updateMe.isSuccess && (
            <p className="text-sm text-success" role="status">
              {t('settings.saved')}
            </p>
          )}
        </div>
      </form>
    </Section>
  );
}

function PreferencesSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { language, setLanguage, theme, setTheme } = usePreferences();
  return (
    <Section
      title={t('settings.preferences.title')}
      description={t('settings.preferences.description')}
    >
      <div className="space-y-5">
        <ChoiceGroup<Language>
          label={t('language.label')}
          value={language}
          options={supportedLanguages.map((value) => ({
            value,
            label: t(`language.${value}`),
          }))}
          onChange={setLanguage}
        />
        <ChoiceGroup<Theme>
          label={t('theme.label')}
          value={theme}
          options={THEMES.map((value) => ({
            value,
            label: t(`theme.${value}`),
          }))}
          onChange={setTheme}
        />
      </div>
    </Section>
  );
}

function PasswordSection({
  hasPassword,
}: {
  hasPassword: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const setSession = useSetSession();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const change = useMutation({
    mutationFn: () => changePassword(next, hasPassword ? current : undefined),
    onSuccess: (session) => {
      setSession(session);
      setCurrent('');
      setNext('');
    },
  });
  const errors = change.isError
    ? authErrorMessages(change.error, t)
    : { fields: {}, codes: [] };
  const currentError = errors.codes.includes('enter_current_password')
    ? t('settings.password.wrongCurrent')
    : errors.fields.current_password;

  return (
    <Section
      title={t(
        hasPassword
          ? 'settings.password.changeTitle'
          : 'settings.password.setTitle',
      )}
      description={t(
        hasPassword
          ? 'settings.password.changeDescription'
          : 'settings.password.setDescription',
      )}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          change.mutate();
        }}
      >
        {errors.form && !currentError && <FormAlert>{errors.form}</FormAlert>}
        {change.isSuccess && (
          <FormAlert tone="success">{t('settings.password.changed')}</FormAlert>
        )}
        {hasPassword && (
          <FormField
            label={t('settings.password.current')}
            type="password"
            name="current_password"
            autoComplete="current-password"
            value={current}
            error={currentError}
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
        )}
        <FormField
          label={t('auth.fields.newPassword')}
          type="password"
          name="new_password"
          autoComplete="new-password"
          minLength={8}
          value={next}
          error={errors.fields.new_password}
          hint={t('auth.signup.passwordHint')}
          onChange={(event) => {
            setNext(event.target.value);
          }}
        />
        <Button type="submit" disabled={change.isPending}>
          {change.isPending
            ? t('settings.saving')
            : t('settings.password.submit')}
        </Button>
      </form>
    </Section>
  );
}

function LinkedAccountsSection(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { data: providers = [] } = useAuthProviders();
  const accounts = useQuery({
    queryKey: providerAccountsKey,
    queryFn: fetchProviderAccounts,
  });
  const disconnect = useMutation({
    mutationFn: disconnectProvider,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: providerAccountsKey }),
  });
  const [connecting, setConnecting] = React.useState<string | null>(null);
  const disconnectError = disconnect.isError
    ? (authErrorMessages(disconnect.error, t).form ??
      Object.values(authErrorMessages(disconnect.error, t).fields)[0])
    : undefined;
  // allauth comes back to /settings with ?error= when linking failed.
  const connectError = searchParams.has('error')
    ? t('settings.linked.connectFailed')
    : undefined;

  return (
    <Section
      title={t('settings.linked.title')}
      description={t('settings.linked.description')}
    >
      {(disconnectError ?? connectError) && (
        <div className="mb-4">
          <FormAlert>{disconnectError ?? connectError}</FormAlert>
        </div>
      )}
      {accounts.isError ? (
        <div
          className="flex items-center gap-3 text-sm text-muted-foreground"
          role="alert"
        >
          {t('settings.linked.loadFailed')}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void accounts.refetch();
            }}
          >
            <RotateCw />
            {t('auth.sessionError.retry')}
          </Button>
        </div>
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('settings.linked.none')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {providers.map((provider) => {
            const linked: ProviderAccount[] = (accounts.data ?? []).filter(
              (account) => account.provider.id === provider.id,
            );
            return (
              <li
                key={provider.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{provider.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {accounts.isPending
                      ? '…'
                      : linked.length > 0
                        ? linked.map((account) => account.display).join(', ')
                        : t('settings.linked.notLinked')}
                  </p>
                </div>
                {linked[0] ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disconnect.isPending}
                    onClick={() => {
                      if (linked[0]) disconnect.mutate(linked[0]);
                    }}
                  >
                    {t('settings.linked.disconnect')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={accounts.isPending || connecting !== null}
                    onClick={() => {
                      setConnecting(provider.id);
                      void redirectToProvider(
                        provider.id,
                        '/settings',
                        'connect',
                      ).catch(() => {
                        setConnecting(null);
                      });
                    }}
                  >
                    {t('settings.linked.connect')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function SettingsSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-40 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

/** S-13: profile, language, theme, password and linked accounts. */
export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const me = useMe();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  return (
    <section className="mx-auto max-w-2xl space-y-4 py-2 sm:py-6">
      <h1 className="text-xl font-semibold tracking-tight">
        {t('navigation.settings')}
      </h1>
      {me.isPending ? (
        <SettingsSkeleton />
      ) : me.isError ? (
        <div
          className="rounded-lg border border-border bg-card p-6 text-center"
          role="alert"
        >
          <p className="text-sm text-muted-foreground">
            {t('settings.loadFailed')}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => {
              void me.refetch();
              void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
            }}
          >
            <RotateCw />
            {t('auth.sessionError.retry')}
          </Button>
        </div>
      ) : (
        <>
          <ProfileSection me={me.data} />
          <PreferencesSection />
          <PasswordSection
            hasPassword={session?.user?.has_usable_password ?? true}
          />
          <LinkedAccountsSection />
        </>
      )}
    </section>
  );
}
