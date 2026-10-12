import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Download, History, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useNode, type DriveNode } from '@/features/drive/api';
import { formatBytes, formatDate } from '@/features/drive/format';
import { ApiError } from '@/lib/api/errors';
import {
  downloadVersion,
  refreshVersionNode,
  useVersionChange,
  useVersions,
  type FileVersion,
} from './api';

export function VersionPanel({ node }: { node: DriveNode }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const query = useVersions(node.id);
  const detail = useNode(node.id);
  const mutation = useVersionChange(node);
  const client = useQueryClient();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const actionRef = React.useRef<HTMLButtonElement | null>(null);
  const [confirmation, setConfirmation] = React.useState<{
    action: 'restore' | 'delete';
    version: FileVersion;
  } | null>(null);
  const [download, setDownload] = React.useState<string | null>(null);
  const [downloadError, setDownloadError] = React.useState<unknown>(null);
  const errorMessage = (error: unknown) =>
    t(
      error instanceof ApiError && error.status === 404
        ? 'versions.unavailable'
        : error instanceof ApiError && error.code === 'current_version'
          ? 'versions.currentError'
          : 'versions.failed',
    );
  const canEdit = !detail.isError && detail.data?.capabilities.can_edit;
  const canDelete =
    !detail.isError && detail.data?.capabilities.can_delete_versions;
  const pending = mutation.isPending || download !== null;

  if (query.isPending)
    return (
      <div
        role="status"
        aria-label={t('versions.loading')}
        className="flex-1 space-y-4 overflow-y-auto p-5"
      >
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-28 animate-pulse rounded-lg bg-secondary"
          />
        ))}
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="flex-1 overflow-y-auto p-5 text-sm">
        <p>{errorMessage(query.error)}</p>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => {
            void query.refetch();
            void detail.refetch();
          }}
        >
          {t('versions.retry')}
        </Button>
      </div>
    );
  const items = query.data.pages.flatMap((page) => page.results);
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="min-h-0 flex-1 overflow-y-auto p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="mb-4 break-words text-sm font-medium">
        {detail.data?.name ?? node.name}
      </p>
      {Boolean(mutation.error ?? downloadError) && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {errorMessage(mutation.error ?? downloadError)}
        </p>
      )}
      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <History className="mx-auto mb-3 size-8" aria-hidden="true" />
          <p>{t('versions.empty')}</p>
        </div>
      ) : (
        <ol className="space-y-3">
          {items.map((version) => (
            <li
              key={version.id}
              className="rounded-lg border border-border p-3"
              aria-label={t('versions.number', {
                number: version.version_number,
              })}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {t('versions.number', { number: version.version_number })}
                </span>
                {version.is_current && (
                  <span className="rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                    {t('versions.current')}
                  </span>
                )}
                {version.keep_forever && (
                  <span className="text-xs text-muted-foreground">
                    {t('versions.kept')}
                  </span>
                )}
              </div>
              <p className="mt-2 break-words text-xs text-muted-foreground">
                {formatDate(version.created_at, i18n.language)} ·{' '}
                {formatBytes(version.size, i18n.language)}
              </p>
              <p className="mt-1 break-words text-xs">
                {version.original_name}
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {version.mime_type}
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {version.uploaded_by?.display_name.trim()
                  ? version.uploaded_by.display_name
                  : t(
                      version.uploaded_by
                        ? 'versions.unnamedUploader'
                        : 'versions.deletedUploader',
                    )}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label={t('versions.downloadLabel', {
                    number: version.version_number,
                  })}
                  onClick={() => {
                    setDownload(version.id);
                    setDownloadError(null);
                    void downloadVersion(node.id, version.id)
                      .catch((error: unknown) => {
                        setDownloadError(error);
                        void refreshVersionNode(client, node);
                      })
                      .finally(() => {
                        setDownload(null);
                      });
                  }}
                >
                  <Download aria-hidden="true" />
                  {t('versions.download')}
                </Button>
                {!version.is_current && canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={t('versions.restoreLabel', {
                      number: version.version_number,
                    })}
                    onClick={(event) => {
                      actionRef.current = event.currentTarget;
                      mutation.reset();
                      setConfirmation({ action: 'restore', version });
                    }}
                  >
                    {t('versions.restore')}
                  </Button>
                )}
                {!version.is_current && canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={t('versions.deleteLabel', {
                      number: version.version_number,
                    })}
                    onClick={(event) => {
                      actionRef.current = event.currentTarget;
                      mutation.reset();
                      setConfirmation({ action: 'delete', version });
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    {t('versions.delete')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {query.hasNextPage && (
        <Button
          className="mt-4 w-full"
          variant="outline"
          disabled={query.isFetchingNextPage || pending}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t(query.isFetchingNextPage ? 'versions.loading' : 'versions.more')}
        </Button>
      )}
      <Dialog.Root
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setConfirmation(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
          <Dialog.Content
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100%_-_2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-panel p-5 shadow-soft"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (actionRef.current?.isConnected) actionRef.current.focus();
              else panelRef.current?.focus();
            }}
            onEscapeKeyDown={(event) => {
              if (mutation.isPending) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (mutation.isPending) event.preventDefault();
            }}
          >
            <Dialog.Title className="font-semibold">
              {t(
                confirmation?.action === 'restore'
                  ? 'versions.confirmRestore'
                  : 'versions.confirmDelete',
                { number: confirmation?.version.version_number },
              )}
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
              {t(
                confirmation?.action === 'restore'
                  ? 'versions.restoreDescription'
                  : 'versions.deleteDescription',
              )}
            </Dialog.Description>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => {
                  setConfirmation(null);
                }}
              >
                {t('versions.cancel')}
              </Button>
              <Button
                className={
                  confirmation?.action === 'delete'
                    ? 'bg-destructive text-destructive-foreground'
                    : undefined
                }
                disabled={mutation.isPending}
                onClick={() => {
                  if (!confirmation) return;
                  mutation.mutate(confirmation, {
                    onSettled: () => {
                      setConfirmation(null);
                    },
                  });
                }}
              >
                {t(
                  mutation.isPending
                    ? 'versions.working'
                    : confirmation?.action === 'restore'
                      ? 'versions.restore'
                      : 'versions.delete',
                )}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
