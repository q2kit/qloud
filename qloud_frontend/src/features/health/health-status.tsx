import { useTranslation } from 'react-i18next';

import { useHealth } from './use-health';

export function HealthStatus(): React.JSX.Element {
  const { t } = useTranslation();
  const { isError, isPending } = useHealth();

  const message = isPending
    ? t('health.checking')
    : isError
      ? t('health.error')
      : t('health.ok');

  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      aria-label={t('health.label')}
      role="status"
    >
      <span
        className={`size-2 rounded-full ${isPending ? 'bg-muted-foreground' : isError ? 'bg-destructive' : 'bg-primary'}`}
        aria-hidden="true"
      />
      {message}
    </div>
  );
}
