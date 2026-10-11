import * as Dialog from '@radix-ui/react-dialog';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-field';

export function DeleteDialog({
  open,
  empty,
  pending,
  failed,
  onConfirm,
  onClose,
}: {
  open: boolean;
  empty: boolean;
  pending: boolean;
  failed: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-soft outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById('trash-cancel')?.focus();
          }}
        >
          <Dialog.Title className="text-base font-semibold">
            {t(empty ? 'trash.emptyTitle' : 'trash.deleteTitle')}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {t('trash.deleteWarning')}
          </Dialog.Description>
          {failed && <FormAlert>{t('trash.actionFailed')}</FormAlert>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              id="trash-cancel"
              variant="ghost"
              disabled={pending}
              onClick={onClose}
            >
              {t('drive.actions.cancel')}
            </Button>
            <Button disabled={pending} onClick={onConfirm}>
              {t(empty ? 'trash.empty' : 'trash.delete')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
