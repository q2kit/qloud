import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRestoreTrash } from './api';
import { useTrashNotice } from './notice';

export function TrashToast(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { notice, clear } = useTrashNotice();
  const restore = useRestoreTrash();
  const reset = restore.reset;
  React.useEffect(() => {
    reset();
  }, [notice?.expiresAt, reset]);
  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      clear,
      Math.max(0, notice.expiresAt - Date.now()),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice, clear]);
  React.useEffect(
    () => () => {
      clear();
    },
    [clear],
  );
  if (!notice) return null;
  return (
    <div
      role="status"
      className="fixed bottom-5 left-4 z-50 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-foreground shadow-soft sm:left-auto sm:right-6"
    >
      <span>{t(restore.isError ? 'trash.undoFailed' : 'trash.moved')}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={restore.isPending}
        onClick={() => {
          restore.mutate(notice.ids, {
            onSuccess: () => {
              // A later trash action may have replaced this toast while restore was pending.
              if (useTrashNotice.getState().notice === notice) clear();
            },
          });
        }}
      >
        {t('trash.undo')}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('trash.dismiss')}
        onClick={clear}
      >
        <X />
      </Button>
    </div>
  );
}
