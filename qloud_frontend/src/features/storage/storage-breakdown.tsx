import { Trash2 } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { formatBytes } from '@/features/drive/format';
import { cn } from '@/lib/utils';
import { STORAGE_GROUPS, type StorageGroup, type StorageUsage } from './api';
import { barWidth } from './levels';

/** Fixed slot per group (index.css `chart-*`): a color always means the same group. */
const GROUP_COLOR: Record<StorageGroup, string> = {
  document: 'bg-chart-document',
  image: 'bg-chart-image',
  video: 'bg-chart-video',
  audio: 'bg-chart-audio',
  archive: 'bg-chart-archive',
  other: 'bg-chart-other',
  old_versions: 'bg-chart-old-versions',
  trash: 'bg-chart-trash',
};

/** Share of the total, "< 0.1%" for a sliver so a stored group never reads as 0. */
function shareLabel(share: number, locale: string): string {
  const format = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  });
  if (share > 0 && share < 0.001) return `< ${format.format(0.001)}`;
  return format.format(share);
}

/**
 * Part-to-whole bar with a legend that doubles as the data table. Hovering or
 * focusing a segment or a legend row highlights the pair and shows its share.
 */
export function StorageBreakdown({
  usage,
}: {
  usage: StorageUsage;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const titleId = React.useId();
  const [active, setActive] = React.useState<StorageGroup | null>(null);
  const total = STORAGE_GROUPS.reduce(
    (sum, group) => sum + usage.breakdown[group],
    0,
  );
  const share = (group: StorageGroup) =>
    total > 0 ? usage.breakdown[group] / total : 0;
  const stored = STORAGE_GROUPS.filter((group) => usage.breakdown[group] > 0);
  const bytes = (value: number) => formatBytes(value, i18n.language);
  const hover = (group: StorageGroup | null) => ({
    onMouseEnter: () => {
      setActive(group);
    },
    onMouseLeave: () => {
      setActive(null);
    },
  });

  // Where the tooltip points: the middle of the active segment.
  let tooltipAt = 0;
  for (const group of stored) {
    if (group === active) {
      tooltipAt += share(group) / 2;
      break;
    }
    tooltipAt += share(group);
  }

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            {t('storage.breakdown')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('storage.total', { size: bytes(total) })}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/trash">
            <Trash2 aria-hidden="true" />
            {t('storage.openTrash')}
          </Link>
        </Button>
      </div>

      {/* The legend below carries the same numbers for assistive technology. */}
      <div aria-hidden="true" className="relative mt-8">
        {active && usage.breakdown[active] > 0 && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-soft"
            style={{
              left: barWidth(Math.min(88, Math.max(12, tooltipAt * 100))),
            }}
          >
            <span className="font-medium">{t(`storage.groups.${active}`)}</span>
            <span className="ml-2 tabular-nums text-muted-foreground">
              {bytes(usage.breakdown[active])} ·{' '}
              {shareLabel(share(active), i18n.language)}
            </span>
          </div>
        )}
        <div className="flex h-4 gap-0.5 overflow-hidden rounded-full">
          {stored.length === 0 ? (
            <div className="flex-1 bg-accent" />
          ) : (
            stored.map((group) => (
              <div
                key={group}
                {...hover(group)}
                className={cn(
                  // A 4px floor keeps a sliver visible and hoverable.
                  'h-full min-w-1 transition-opacity duration-150',
                  GROUP_COLOR[group],
                  active && active !== group && 'opacity-25',
                )}
                style={{ flexGrow: usage.breakdown[group], flexBasis: 0 }}
              />
            ))
          )}
        </div>
      </div>

      <ul className="mt-5 grid gap-1 text-sm sm:grid-cols-2 sm:gap-x-4">
        {STORAGE_GROUPS.map((group) => {
          const empty = usage.breakdown[group] === 0;
          const highlighted = active === group;
          return (
            <li
              key={group}
              tabIndex={empty ? undefined : 0}
              {...(empty ? {} : hover(group))}
              onFocus={() => {
                if (!empty) setActive(group);
              }}
              onBlur={() => {
                setActive(null);
              }}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                highlighted && 'bg-accent',
                active && !highlighted && 'opacity-50',
                empty && 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2.5 shrink-0 rounded-full',
                  GROUP_COLOR[group],
                  empty && 'opacity-40',
                )}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  highlighted && 'font-medium',
                )}
              >
                {t(`storage.groups.${group}`)}
              </span>
              <span className="tabular-nums">
                {bytes(usage.breakdown[group])}
              </span>
              <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                {empty ? '—' : shareLabel(share(group), i18n.language)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
