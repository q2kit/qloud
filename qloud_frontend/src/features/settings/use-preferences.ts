import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useTheme, type Theme } from '@/app/theme-provider';
import type { AuthSession } from '@/features/auth/api';
import { sessionQueryKey } from '@/features/auth/use-auth';
import type { Language } from '@/lib/i18n';

import { useUpdateMe } from './use-me';

interface Preferences {
  language: Language;
  theme: Theme;
  setLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
}

/**
 * Language and theme, applied at once and, for a signed-in user, saved to the
 * profile so they follow the account to other browsers (ui-ux.md › i18n).
 */
export function usePreferences(): Preferences {
  const { i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();
  const signedIn = (): boolean =>
    Boolean(queryClient.getQueryData<AuthSession>(sessionQueryKey)?.user);

  return {
    language: i18n.resolvedLanguage === 'en' ? 'en' : 'vi',
    theme,
    setLanguage: (language) => {
      void i18n.changeLanguage(language);
      if (signedIn()) updateMe.mutate({ locale: language });
    },
    setTheme: (nextTheme) => {
      setTheme(nextTheme);
      if (signedIn()) updateMe.mutate({ theme: nextTheme });
    },
  };
}
