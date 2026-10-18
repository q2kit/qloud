import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useBottomObstacle } from '@/lib/bottom-obstacles';

import { useFolderUploader } from '../folder-context';

export function FolderUploadFeedback() {
  const { t } = useTranslation();
  const { busy, error, clearError, conflict } = useFolderUploader();
  const obstacleRef = useBottomObstacle('folder-upload');
  return (
    <>
      {(busy || error) && (
        <div
          ref={obstacleRef}
          className="fixed inset-x-2 bottom-2 z-40 rounded-lg border border-border bg-card p-4 shadow-soft sm:inset-x-auto sm:right-4 sm:max-w-sm"
          role={error ? 'alert' : 'status'}
        >
          <p className="text-sm">
            {error
              ? t(`upload.errors.${error}`, {
                  defaultValue: t('upload.errors.folder_failed'),
                })
              : t('upload.folder.preparing')}
          </p>
          {error && (
            <Button variant="ghost" size="sm" onClick={clearError}>
              {t('upload.folder.dismiss')}
            </Button>
          )}
        </div>
      )}
      <Dialog.Root open={Boolean(conflict)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
          <Dialog.Content
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-soft outline-none"
            onEscapeKeyDown={() => conflict?.answer('skip')}
            onPointerDownOutside={(event) => {
              event.preventDefault();
            }}
          >
            <Dialog.Title className="text-base font-semibold">
              {t('upload.folder.title')}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('upload.folder.description', { name: conflict?.name })}
            </Dialog.Description>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => conflict?.answer('skip')}>
                {t('upload.conflict.skip')}
              </Button>
              <Button
                variant="outline"
                onClick={() => conflict?.answer('rename')}
              >
                {t('upload.conflict.keepBoth')}
              </Button>
              <Button onClick={() => conflict?.answer('reuse')}>
                {t('upload.folder.merge')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
