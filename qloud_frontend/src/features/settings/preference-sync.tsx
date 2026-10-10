import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/app/theme-provider';

import { useMe } from './use-me';

/**
 * Apply the signed-in user's saved language and theme once per account, so
 * the profile wins over this browser's earlier choice (ui-ux.md › i18n).
 */
export function PreferenceSync(): null {
  const { i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { data: me } = useMe();
  const appliedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!me || appliedFor.current === me.id) return;
    appliedFor.current = me.id;
    if (me.locale && i18n.resolvedLanguage !== me.locale) {
      void i18n.changeLanguage(me.locale);
    }
    if (me.theme && theme !== me.theme) setTheme(me.theme);
  }, [i18n, me, setTheme, theme]);

  return null;
}
