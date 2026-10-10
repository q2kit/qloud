import * as Dialog from '@radix-ui/react-dialog';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { useUploadStore } from '../store';
import { useUploader } from '../context';

/**
 * An uploaded name is taken in its folder (files-folders.md): keep both (a ` (n)`
 * suffix) or skip. "Replace" (a new version) arrives with M7-01.
 */
export function ConflictDialog(): React.JSX.Element {
  const { t } = useTranslation();
  const engine = useUploader();
  const items = useUploadStore((state) => state.items);
  const conflicts = items.filter((item) => item.status === 'conflict');
  const [forAll, setForAll] = React.useState(false);
  const [current] = conflicts;
  // Other conflicts now, and files not yet checked that may clash too.
  const others =
    items.filter(
      (item) => item.status === 'conflict' || item.status === 'queued',
    ).length - 1;

  const answer = (choice: 'rename' | 'skip'): void => {
    if (!current) return;
    engine.resolveConflict(current.id, choice, forAll);
    setForAll(false);
  };

  return (
    <Dialog.Root open={current !== undefined}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-soft outline-none"
          // An answer is needed: Esc or a click outside means "skip".
          onEscapeKeyDown={() => {
            answer('skip');
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-semibold">
            {t('upload.conflict.title')}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {t('upload.conflict.description', { name: current?.name ?? '' })}
          </Dialog.Description>
          {others > 0 && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={forAll}
                onChange={(event) => {
                  setForAll(event.target.checked);
                }}
              />
              {t('upload.conflict.forAll', { count: others })}
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                answer('skip');
              }}
            >
              {t('upload.conflict.skip')}
            </Button>
            <Button
              onClick={() => {
                answer('rename');
              }}
            >
              {t('upload.conflict.keepBoth')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
