import * as React from 'react';

import { readStorage, writeStorage } from '@/lib/storage';

import { ORDERINGS, type Ordering } from './api';

export type DriveView = 'grid' | 'list';

const VIEW_KEY = 'qloud.drive.view';
const ORDERING_KEY = 'qloud.drive.ordering';

function isOrdering(value: string | null): value is Ordering {
  return ORDERINGS.some((ordering) => ordering === value);
}

/** View and sort order, remembered in this browser only. */
export function useDrivePreferences(): {
  view: DriveView;
  setView: (view: DriveView) => void;
  ordering: Ordering;
  setOrdering: (ordering: Ordering) => void;
} {
  const [view, setViewState] = React.useState<DriveView>(() =>
    readStorage(VIEW_KEY) === 'list' ? 'list' : 'grid',
  );
  const [ordering, setOrderingState] = React.useState<Ordering>(() => {
    const stored = readStorage(ORDERING_KEY);
    return isOrdering(stored) ? stored : 'name';
  });
  return {
    view,
    setView: (next) => {
      setViewState(next);
      writeStorage(VIEW_KEY, next);
    },
    ordering,
    setOrdering: (next) => {
      setOrderingState(next);
      writeStorage(ORDERING_KEY, next);
    },
  };
}
