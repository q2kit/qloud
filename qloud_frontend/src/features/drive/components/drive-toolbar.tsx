import { ArrowDownUp, LayoutGrid, List, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { NodeAction } from '../actions';
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

interface DriveToolbarProps {
  selected: DriveNode[];
  view: DriveView;
  ordering: Ordering;
  onView: (view: DriveView) => void;
  onOrdering: (ordering: Ordering) => void;
  /** The item menu's actions for the selection, as buttons. */
  actions: NodeAction[];
  onClearSelection: () => void;
}

export function DriveToolbar({
  selected,
  view,
  ordering,
  onView,
  onOrdering,
  actions,
  onClearSelection,
}: DriveToolbarProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-2">
      <div
        className="flex min-w-0 flex-wrap items-center gap-1"
        role="group"
        aria-label={t('drive.selectionActions')}
      >
        {selected.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('drive.selection.clear')}
              onClick={onClearSelection}
            >
              <X />
              <span aria-live="polite">
                {t('drive.selection.count', { count: selected.length })}
              </span>
            </Button>
            {actions
              .filter((action) => action.key !== 'info')
              .map((action) => (
                <Button
                  key={action.key}
                  variant="ghost"
                  size="sm"
                  onClick={action.run}
                >
                  <action.icon />
                  {action.label}
                </Button>
              ))}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <ArrowDownUp />
              <span className="hidden sm:inline">
                {t(`drive.sort.${ORDERING_KEYS[ordering]}`)}
              </span>
              <span className="sr-only sm:hidden">{t('drive.sort.label')}</span>
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
