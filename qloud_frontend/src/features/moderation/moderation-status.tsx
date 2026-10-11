import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ReportStatus } from './api';

export function StatusBadge({ status }: { status: ReportStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
        status === 'open'
          ? 'bg-primary/10 text-primary'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {t(`moderation.statuses.${status}`)}
    </span>
  );
}
