import { Plus } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBottomClearance } from '@/lib/bottom-obstacles';

interface CreateFabProps {
  /** The menu content, the same as the header button's. */
  children: React.ReactNode;
}

/** The floating "+" at the bottom right on mobile (ui-ux.md › Responsive). */
export function CreateFab({ children }: CreateFabProps): React.JSX.Element {
  const { t } = useTranslation();
  // Sits above the upload tray and toasts instead of covering them.
  const clearance = useBottomClearance();
  const bottom =
    clearance > 0
      ? `calc(${String(clearance)}px + 0.75rem)`
      : 'calc(1rem + env(safe-area-inset-bottom))';

  // Portalled: the sticky header's backdrop blur would otherwise contain `fixed`.
  return createPortal(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('shell.create')}
          data-create-fab=""
          className="fixed right-[calc(1rem+env(safe-area-inset-right))] z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition-[bottom,opacity] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none [&_svg]:size-6"
          style={{ bottom }}
        >
          <Plus aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      {children}
    </DropdownMenu>,
    document.body,
  );
}
