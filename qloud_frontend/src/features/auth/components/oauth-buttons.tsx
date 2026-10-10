import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { redirectToProvider } from '../api';
import { useAuthProviders } from '../use-auth';

interface OAuthButtonsProps {
  /** Where the provider sends the browser back (with `?error=` on failure). */
  callbackUrl: string;
}

/** "Continue with Google/GitHub", one per provider the backend has enabled. */
export function OAuthButtons({
  callbackUrl,
}: OAuthButtonsProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const { data: providers = [] } = useAuthProviders();
  const [pending, setPending] = React.useState<string | null>(null);

  if (providers.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t('auth.oauth.divider')}
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => {
              setPending(provider.id);
              void redirectToProvider(provider.id, callbackUrl).catch(() => {
                setPending(null);
              });
            }}
          >
            {t('auth.oauth.continueWith', { provider: provider.name })}
          </Button>
        ))}
      </div>
    </div>
  );
}
