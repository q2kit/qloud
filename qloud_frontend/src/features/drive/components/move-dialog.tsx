import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, FolderInput } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-field';

import { useChildren, useNode, type DriveNode } from '../api';
import { NodeIcon } from './node-icon';

interface MoveDialogProps {
  /** What is being moved; the dialog is open while this is set. */
  nodes: DriveNode[] | null;
  /** Where browsing starts: the folder the items are in. */
  startFolderId: string | undefined;
  error?: string;
  onMove: (target: DriveNode) => void;
  onOpenChange: (open: boolean) => void;
}

/** "Move to…": browse folders and pick the target (files-folders.md). */
export function MoveDialog({
  nodes,
  startFolderId,
  error,
  onMove,
  onOpenChange,
}: MoveDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={nodes !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(36rem,calc(100vh-2rem))] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card shadow-soft outline-none">
          <Dialog.Title className="px-5 pt-5 text-base font-semibold">
            {t('drive.dialogs.move', { count: nodes?.length ?? 0 })}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t('drive.move.description')}
          </Dialog.Description>
          {/* Radix unmounts the content when closed, so browsing restarts each time. */}
          {nodes && startFolderId && (
            <FolderPicker
              nodes={nodes}
              startFolderId={startFolderId}
              error={error}
              onMove={onMove}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FolderPicker({
  nodes,
  startFolderId,
  error,
  onMove,
}: {
  nodes: DriveNode[];
  startFolderId: string;
  error?: string;
  onMove: (target: DriveNode) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [folderId, setFolderId] = React.useState(startFolderId);
  const folder = useNode(folderId);
  const children = useChildren(folderId, 'name');
  const moving = new Set(nodes.map((node) => node.id));
  const folders =
    children.data?.pages
      .flatMap((page) => page.results)
      .filter((node) => node.kind === 'folder') ?? [];
  // Already where they are: nothing to do. Into one of them: refused by the API.
  const pointless = nodes.every((node) => node.parent_id === folderId);
  const insideMoving =
    moving.has(folderId) ||
    (folder.data?.breadcrumb.some((crumb) => moving.has(crumb.id)) ?? false);
  const label = (name: string, isRoot: boolean): string =>
    isRoot ? t('shell.breadcrumbRoot') : name;

  return (
    <>
      <nav aria-label={t('drive.breadcrumb')} className="px-5 pt-3">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {folder.data?.breadcrumb.map((crumb, index) => (
            <li key={crumb.id} className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-sm hover:text-foreground hover:underline"
                onClick={() => {
                  setFolderId(crumb.id);
                }}
              >
                {label(crumb.name, index === 0)}
              </button>
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </li>
          ))}
          <li className="font-medium text-foreground">
            {folder.data ? label(folder.data.name, folder.data.is_root) : '…'}
          </li>
        </ol>
      </nav>
      <div className="mt-3 min-h-40 flex-1 overflow-y-auto border-y border-border px-2 py-2">
        {children.isPending ? (
          <p className="px-3 py-2 text-sm text-muted-foreground" role="status">
            {t('drive.loadingMore')}
          </p>
        ) : folders.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {t('drive.move.noFolders')}
          </p>
        ) : (
          <ul aria-label={t('drive.move.folders')}>
            {folders.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  disabled={moving.has(child.id)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => {
                    setFolderId(child.id);
                  }}
                >
                  <NodeIcon node={child} className="size-5" />
                  <span className="flex-1 truncate">{child.name}</span>
                  <ChevronRight
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
            {children.hasNextPage && (
              <li className="px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void children.fetchNextPage()}
                >
                  {t('drive.loadMore')}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
      <div className="space-y-3 p-5">
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild>
            <Button type="button" variant="ghost">
              {t('drive.actions.cancel')}
            </Button>
          </Dialog.Close>
          <Button
            disabled={!folder.data || pointless || insideMoving}
            onClick={() => {
              if (folder.data) onMove(folder.data);
            }}
          >
            <FolderInput />
            {t('drive.actions.moveHere')}
          </Button>
        </div>
      </div>
    </>
  );
}
