import { HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

import { formatBytes } from '@/features/drive/format';
import { cn } from '@/lib/utils';
import { storageLevel, useStorage } from './api';
import { barWidth, LEVEL_BAR, LEVEL_TEXT } from './levels';

/** Sidebar "x GB / y GB" bar, linking to S-14. */
export function StorageMeter({
  onNavigate,
}: {
  onNavigate?: () => void;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const storage = useStorage();
  if (!storage.data) return null;
  const usage = storage.data;
  const level = storageLevel(usage);
  const percent =
    usage.quota_bytes > 0
      ? Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100)
      : 100;
  const summary = t('storage.summary', {
    used: formatBytes(usage.used_bytes, i18n.language),
    quota: formatBytes(usage.quota_bytes, i18n.language),
  });
  return (
    <NavLink
      to="/settings/storage"
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent',
          isActive && 'bg-sidebar-accent',
        )
      }
    >
      <span className="flex items-center gap-3 font-medium text-muted-foreground">
        <HardDrive className="size-4.5" aria-hidden="true" />
        {t('navigation.storage')}
      </span>
      <span
        role="progressbar"
        aria-label={t('storage.used')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={summary}
        className="mt-2 block h-1.5 overflow-hidden rounded-full bg-border"
      >
        <span
          className={cn('block h-full rounded-full', LEVEL_BAR[level])}
          style={{ width: barWidth(percent) }}
        />
      </span>
      <span className={cn('mt-1.5 block text-xs', LEVEL_TEXT[level])}>
        {summary}
      </span>
    </NavLink>
  );
}
