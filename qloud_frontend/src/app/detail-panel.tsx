import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FileText, Info, Share2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  NodeDetails,
  SelectionSummary,
} from '@/features/drive/components/node-details';
import { VersionPanel } from '@/features/versions/version-panel';
import { useDriveStore } from '@/features/drive/store';
import { useMediaQuery } from '@/lib/use-media-query';

/** Marks the mobile details sheet so shortcuts can tell it from other dialogs. */
export const DETAIL_SHEET_SELECTOR = '[data-detail-sheet]';

interface DetailPanelProps {
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
}

export function DetailPanel({
  isOpen,
  triggerRef,
  onClose,
  onOpenChange,
}: DetailPanelProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const selectionKey = useDriveStore((state) =>
    state.selected.map((node) => node.id).join(':'),
  );
  const isDesktopPanel = useMediaQuery('(min-width: 1280px)');

  if (isDesktopPanel) {
    return isOpen ? (
      <aside
        className="w-80 shrink-0 border-l border-border"
        aria-label={t('details.title')}
      >
        <PanelContent key={selectionKey} isDialog={false} onClose={onClose} />
      </aside>
    ) : null;
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          data-detail-sheet=""
          className="fixed inset-x-0 bottom-0 z-50 h-[min(68vh,32rem)] overflow-hidden rounded-t-2xl border-t border-border shadow-soft outline-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <div className="absolute top-2 left-1/2 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-border" />
          <PanelContent key={selectionKey} isDialog onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PanelContentProps {
  /** Inside the mobile sheet the heading also labels the Radix dialog. */
  isDialog: boolean;
  onClose: () => void;
}

function PanelContent({
  isDialog,
  onClose,
}: PanelContentProps): React.JSX.Element {
  const { t } = useTranslation();
  const selected = useDriveStore((state) => state.selected);
  const node = selected.length === 1 ? selected[0] : undefined;
  const versionsEnabled =
    node?.kind === 'file' && !('trashed_at' in node && node.trashed_at);
  const [tabState, setTabState] = React.useState<{
    id: string | undefined;
    tab: 'info' | 'versions';
  }>({ id: undefined, tab: 'info' });
  const tab =
    versionsEnabled && tabState.id === node.id ? tabState.tab : 'info';
  const panelId = React.useId();
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const heading = <h2 className="font-semibold">{t('details.title')}</h2>;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-16 items-center justify-between border-b border-border px-5">
        {isDialog ? (
          <>
            <Dialog.Title asChild>{heading}</Dialog.Title>
            <Dialog.Description className="sr-only">
              {t('details.emptyDescription')}
            </Dialog.Description>
          </>
        ) : (
          heading
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('shell.closeDetails')}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div
        role="tabpanel"
        id={`${panelId}-${tab}-panel`}
        aria-labelledby={`${panelId}-${tab}-tab`}
        className="flex min-h-0 flex-1 flex-col"
        tabIndex={0}
      >
        {tab === 'versions' && node ? (
          <VersionPanel key={node.id} node={node} />
        ) : selected.length > 1 ? (
          <SelectionSummary nodes={selected} />
        ) : selected[0] ? (
          <NodeDetails node={selected[0]} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
              <Info className="size-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">{t('details.emptyTitle')}</p>
            <p className="mt-1 max-w-56 text-sm leading-6 text-muted-foreground">
              {t('details.emptyDescription')}
            </p>
          </div>
        )}
      </div>
      <div
        role="tablist"
        aria-label={t('details.title')}
        className="grid grid-cols-3 border-t border-border px-3 py-2 text-xs text-muted-foreground"
      >
        {(['info', 'versions'] as const).map((value, index) => (
          <button
            key={value}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${panelId}-${value}-tab`}
            aria-controls={`${panelId}-${value}-panel`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            disabled={value === 'versions' && !versionsEnabled}
            className={`flex flex-col items-center gap-1.5 rounded-md px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${tab === value ? 'bg-secondary text-foreground' : ''}`}
            onClick={() => {
              setTabState({ id: node?.id, tab: value });
            }}
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                !versionsEnabled || event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 1
                    : 1 - index;
              setTabState({
                id: node?.id,
                tab: next === 0 ? 'info' : 'versions',
              });
              tabRefs.current[next]?.focus();
            }}
          >
            {value === 'info' ? (
              <Info className="size-4" aria-hidden="true" />
            ) : (
              <FileText className="size-4" aria-hidden="true" />
            )}
            {t(`details.tabs.${value}`)}
          </button>
        ))}
        <span
          className="flex flex-col items-center gap-1.5 rounded-md px-2 py-2"
          aria-hidden="true"
        >
          <Share2 className="size-4" aria-hidden="true" />
          {t('details.tabs.sharing')}
        </span>
      </div>
    </div>
  );
}
