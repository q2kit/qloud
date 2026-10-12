import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Download, Flag, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { ReportDialog } from '@/features/moderation/report-dialog';
import { usePublicToken } from '@/features/sharing/public-context';

import { Button } from '@/components/ui/button';

import { downloadNode, useNode, type DriveNode } from '../api';
import { compactId, uuidFromUrl } from '../paths';
import { usePreview } from '../preview-api';
import { NodeIcon } from './node-icon';
import { PreviewContent } from './preview-content';

export function FileViewer({
  nodes,
  hasMore,
  loadingMore,
  loadMore,
  standalone,
}: {
  nodes: DriveNode[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<unknown>;
  standalone?: { fileId: string; onClose: () => void };
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState: unknown = location.state;
  const [params, setParams] = useSearchParams();
  const rawId = params.get('preview');
  const id = standalone?.fileId ?? (rawId ? uuidFromUrl(rawId) : undefined);
  const token = usePublicToken();
  const [reporting, setReporting] = React.useState<DriveNode>();
  const node = useNode(id, token);
  const preview = usePreview(node.data, Boolean(id));
  const [failedUrl, setFailedUrl] = React.useState<string>();
  const [downloadFailed, setDownloadFailed] = React.useState(false);
  const files = nodes.filter((item) => item.kind === 'file');
  const index = files.findIndex((item) => item.id === id);
  const previous = files[index - 1];
  const next = files[index + 1];
  // Nothing to step to: a single file (file link, standalone viewer).
  const browsable = files.length > 1 || hasMore;
  const setFile = (nextId: string) => {
    document.querySelector<HTMLElement>('[data-file-viewer]')?.focus();
    const next = new URLSearchParams(params);
    next.set('preview', compactId(nextId));
    setParams(next, { replace: true, state: routeState });
  };
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const activeId = React.useRef(id);
  React.useEffect(() => {
    activeId.current = id;
  }, [id]);
  const pageAttempt = React.useRef('');
  React.useEffect(() => {
    const attempt = `${id ?? ''}:${String(nodes.length)}`;
    if (
      id &&
      node.data &&
      index < 0 &&
      hasMore &&
      !loadingMore &&
      pageAttempt.current !== attempt
    ) {
      pageAttempt.current = attempt;
      void loadMore().catch(() => undefined);
    }
  }, [id, node.data, index, hasMore, loadingMore, loadMore, nodes.length]);
  const nextPending = React.useRef(false);
  const nextFile = async () => {
    if (next) {
      setFile(next.id);
      return;
    }
    if (!hasMore || loadingMore || nextPending.current) return;
    nextPending.current = true;
    try {
      let more = true;
      while (more && activeId.current === id) {
        const result = (await loadMore()) as {
          data?: { pages: { results: DriveNode[] }[] };
          hasNextPage?: boolean;
          isError?: boolean;
        };
        if (result.isError || activeId.current !== id) return;
        const loaded =
          result.data?.pages
            .flatMap((page) => page.results)
            .filter((item) => item.kind === 'file') ?? [];
        const after = loaded[loaded.findIndex((item) => item.id === id) + 1];
        if (after) {
          setFile(after.id);
          return;
        }
        more = Boolean(result.hasNextPage);
      }
    } finally {
      nextPending.current = false;
    }
  };
  const close = () => {
    if (standalone) {
      standalone.onClose();
      return;
    }
    if (
      typeof routeState === 'object' &&
      routeState !== null &&
      'openedPreview' in routeState &&
      routeState.openedPreview === true
    ) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete('preview');
    setParams(next, { replace: true });
  };
  const link = preview.data;
  const contentFailed = Boolean(link?.url && failedUrl === link.url);
  const onContentError = React.useCallback(() => {
    setFailedUrl(link?.url ?? undefined);
  }, [link?.url]);
  const retry = () => {
    setFailedUrl(undefined);
    void preview.refetch();
    void node.refetch();
  };
  return (
    <Dialog.Root
      open={Boolean(id)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
          data-file-viewer
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none"
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return;
            if (
              event.target instanceof Element &&
              event.target.closest(
                'video, audio, input, textarea, select, [data-preview-controls], [data-report-dialog]',
              )
            )
              return;
            if (event.key === 'ArrowLeft' && previous) {
              event.preventDefault();
              setFile(previous.id);
            }
            if (event.key === 'ArrowRight' && index >= 0) {
              event.preventDefault();
              void nextFile();
            }
          }}
        >
          {reporting && token && (
            <ReportDialog
              token={token}
              node={reporting}
              onClose={() => {
                setReporting(undefined);
              }}
            />
          )}
          <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">
              {node.data?.name ?? t('preview.title')}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {t('preview.description')}
            </Dialog.Description>
            {browsable && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('preview.previous')}
                  disabled={index <= 0}
                  onClick={() => {
                    if (previous) setFile(previous.id);
                  }}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('preview.next')}
                  disabled={
                    index < 0 || (!files[index + 1] && !hasMore) || loadingMore
                  }
                  onClick={() => void nextFile()}
                >
                  <ChevronRight />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('drive.actions.download')}
              disabled={node.data?.kind !== 'file'}
              onClick={() => {
                if (id) {
                  setDownloadFailed(false);
                  void downloadNode(id, token).catch(() => {
                    setDownloadFailed(true);
                  });
                }
              }}
            >
              <Download />
            </Button>
            {token && node.data?.kind === 'file' && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('report.button')}
                onClick={() => {
                  setReporting(node.data);
                }}
              >
                <Flag />
              </Button>
            )}
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('preview.close')}
              >
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
            {node.isError ||
            node.data?.kind === 'folder' ||
            preview.isError ||
            contentFailed ? (
              <div className="flex flex-col items-center gap-3" role="alert">
                <p>{t('preview.failed')}</p>
                <Button onClick={retry}>{t('preview.retry')}</Button>
              </div>
            ) : !link ? (
              <p role="status">{t('preview.loading')}</p>
            ) : link.kind === 'unsupported' ? (
              <div className="flex flex-col items-center gap-3">
                {node.data && <NodeIcon node={node.data} className="size-16" />}
                <p>{t('preview.unsupported')}</p>
              </div>
            ) : (
              <PreviewContent
                key={id}
                link={link}
                name={node.data?.name ?? ''}
                onError={onContentError}
              />
            )}
          </div>
          {downloadFailed && (
            <p role="alert" className="p-3 text-center text-destructive">
              {t('drive.errors.downloadFailed')}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
