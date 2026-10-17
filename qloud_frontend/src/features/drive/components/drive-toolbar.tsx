import { ArrowDownUp, LayoutGrid, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ariaKeyshortcuts } from '@/features/shortcuts/keys';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { ORDERINGS, type DriveNode, type Ordering } from '../api';
import type { DriveView } from '../preferences';

const ORDERING_KEYS: Record<Ordering, string> = {
  name: 'nameAsc',
  '-name': 'nameDesc',
  updated_at: 'oldest',
  '-updated_at': 'newest',
  size: 'smallest',
  '-size': 'largest',
};

export interface DriveToolbarProps {
  selected: DriveNode[];
  view: DriveView;
  ordering: Ordering;
  /** Shown instead of the sort menu without `onOrdering`; null hides both. */
  orderingLabel?: string | null;
  onView: (view: DriveView) => void;
  onOrdering?: (ordering: Ordering) => void;
}

export function DriveToolbar({
  selected,
  view,
  ordering,
  orderingLabel,
  onView,
  onOrdering,
}: DriveToolbarProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-10 flex-wrap items-center justify-end gap-2">
      {/* Item actions live in the item menu (right click, ⋯, Shift+F10). */}
      <span className="sr-only" aria-live="polite">
        {selected.length > 0 &&
          t('drive.selection.count', { count: selected.length })}
      </span>
      <div className="flex items-center gap-2">
        {onOrdering ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowDownUp />
                <span className="hidden sm:inline">
                  {t(`drive.sort.${ORDERING_KEYS[ordering]}`)}
                </span>
                <span className="sr-only sm:hidden">
                  {t('drive.sort.label')}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label={t('drive.sort.label')}>
              <DropdownMenuRadioGroup
                value={ordering}
                onValueChange={(value) => {
                  const next = ORDERINGS.find((option) => option === value);
                  if (next) onOrdering(next);
                }}
              >
                {ORDERINGS.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {t(`drive.sort.${ORDERING_KEYS[option]}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : orderingLabel === null ? null : (
          <span className="text-xs text-muted-foreground">
            {orderingLabel ?? t(`drive.sort.${ORDERING_KEYS[ordering]}`)}
          </span>
        )}
        <div
          className="flex items-center rounded-lg border border-border bg-card p-0.5"
          role="group"
          aria-label={t('drive.view.label')}
        >
          {(['grid', 'list'] as const).map((option) => (
            <Button
              key={option}
              size="icon"
              className="size-8"
              variant={view === option ? 'secondary' : 'ghost'}
              aria-label={t(`drive.view.${option}`)}
              aria-pressed={view === option}
              aria-keyshortcuts={ariaKeyshortcuts('toggleView')}
              onClick={() => {
                onView(option);
              }}
            >
              {option === 'grid' ? <LayoutGrid /> : <List />}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
