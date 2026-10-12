import * as React from 'react';
import { Download, Eye, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useNode, downloadNode, type DriveNode } from '@/features/drive/api';
import { FileBrowser } from '@/features/drive/components/file-browser';
import { FileViewer } from '@/features/drive/components/file-viewer';
import {
  CenteredState,
  LoadFailed,
  LoadingSkeleton,
} from '@/features/drive/components/browser-states';
import { useDrivePreferences } from '@/features/drive/preferences';
import { compactId, uuidFromUrl } from '@/features/drive/paths';
import type { NodeAction } from '@/features/drive/actions';
import { ApiError } from '@/lib/api/errors';
import { ReportDialog } from '@/features/moderation/report-dialog';
import { Button } from '@/components/ui/button';
import { usePublicChildren } from './api';
import { PublicTokenContext } from './public-context';

export function PublicPage() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  return (
    <PublicTokenContext value={token}>
      <PublicBrowser key={token + (params.get('folder') ?? '')} token={token} />
    </PublicTokenContext>
  );
}
function PublicBrowser({ token }: { token: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const id = params.get('folder');
  const folderId = id ? uuidFromUrl(id) : undefined;
  const root = useNode(undefined, token);
  const current = useNode(folderId, token);
  const { view, setView, ordering, setOrdering } = useDrivePreferences();
  const children = usePublicChildren(
    token,
    folderId,
    ordering,
    root.data?.kind === 'folder' && current.data?.kind === 'folder',
  );
  const [selection, setSelection] = React.useState<DriveNode[]>([]);
  const [error, setError] = React.useState('');
  const [reporting, setReporting] = React.useState(false);
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (root.data?.kind === 'file' && !autoOpened.current) {
      autoOpened.current = true;
      const next = new URLSearchParams(params);
      next.set('preview', compactId(root.data.id));
      setParams(next, { replace: true });
    }
  }, [root.data, params, setParams]);
  const nodes = React.useMemo(
    () => children.data?.pages.flatMap((p) => p.results) ?? [],
    [children.data],
  );
  const href = (id?: string) => {
    const next = new URLSearchParams();
    if (id) next.set('folder', compactId(id));
    return `/s/${token}${next.size ? '?' + next.toString() : ''}`;
  };
  const open = (node: DriveNode) => {
    const next = new URLSearchParams(params);
    if (node.kind === 'folder') {
      next.set('folder', compactId(node.id));
      next.delete('preview');
    } else next.set('preview', compactId(node.id));
    setParams(next);
  };
  const actionsFor = (item?: DriveNode): NodeAction[] => {
    const chosen =
      item && !selection.some((node) => node.id === item.id)
        ? [item]
        : selection;
    const node = chosen[0];
    if (!node || chosen.length !== 1) return [];
    return [
      {
        key: 'open',
        icon: node.kind === 'folder' ? FolderOpen : Eye,
        label: t(
          node.kind === 'folder' ? 'drive.actions.open' : 'preview.open',
        ),
        run: () => {
          open(node);
        },
      },
      ...(node.kind === 'file'
        ? [
            {
              key: 'download',
              icon: Download,
              label: t('drive.actions.download'),
              run: () => {
                void downloadNode(node.id, token).catch(() => {
                  setError(t('drive.errors.downloadFailed'));
                });
              },
            },
          ]
        : []),
    ];
  };
  const failed = root.error ?? current.error;
  if (failed instanceof ApiError && failed.status === 404)
    return (
      <CenteredState
        icon={<FolderOpen className="size-6 text-muted-foreground" />}
        title={t('sharing.unavailable')}
        description={t('sharing.unavailableDescription')}
      >
        <Button
          onClick={() => {
            void root.refetch();
            void current.refetch();
          }}
        >
          {t('preview.retry')}
        </Button>
      </CenteredState>
    );
  if (failed)
    return (
      <LoadFailed
        onRetry={() => {
          void root.refetch();
          void current.refetch();
        }}
      />
    );
  if (!root.data || !current.data)
    return <LoadingSkeleton view={view} label={t('sharing.loading')} />;
  // A file link shows the same page as a folder link: name, report, the item.
  const isFile = root.data.kind === 'file';
  const items = isFile ? [root.data] : nodes;
  return (
    <section className="flex min-h-[60vh] flex-col gap-4">
      <nav
        aria-label={t('drive.breadcrumb')}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        {(isFile ? [] : current.data.breadcrumb).map((crumb) => (
          <Link
            className="text-primary underline"
            key={crumb.id}
            to={href(crumb.id === root.data.id ? undefined : crumb.id)}
          >
            {crumb.name}
          </Link>
        ))}
        <h1 className="text-xl font-semibold">{current.data.name}</h1>
      </nav>
      <Button
        variant="outline"
        className="self-start"
        onClick={() => {
          setReporting(true);
        }}
      >
        {t('report.button')}
      </Button>
      {reporting && (
        <ReportDialog
          token={token}
          node={current.data}
          onClose={() => {
            setReporting(false);
          }}
        />
      )}
      <FileBrowser
        nodes={items}
        selected={selection}
        view={view}
        onView={setView}
        ordering={ordering}
        {...(isFile ? { orderingLabel: null } : { onOrdering: setOrdering })}
        actionsFor={actionsFor}
        onClearSelection={() => {
          setSelection([]);
        }}
        onSelectAll={setSelection}
        onSelect={(node, { toggle, range }) => {
          if (range) {
            const anchor = items.findIndex((n) => n.id === selection[0]?.id);
            const end = items.findIndex((n) => n.id === node.id);
            setSelection(
              anchor < 0
                ? [node]
                : items.slice(Math.min(anchor, end), Math.max(anchor, end) + 1),
            );
          } else if (toggle)
            setSelection((old) =>
              old.some((n) => n.id === node.id)
                ? old.filter((n) => n.id !== node.id)
                : [...old, node],
            );
          else setSelection([node]);
        }}
        onOpen={open}
        draggable={false}
        enabled={isFile || children.isSuccess}
        pending={!isFile && children.isPending}
        failed={!isFile && children.isError}
        onRetry={() => void children.refetch()}
        hasMore={!isFile && children.hasNextPage}
        isLoadingMore={children.isFetchingNextPage}
        onLoadMore={() => {
          if (!children.isFetchingNextPage) void children.fetchNextPage();
        }}
        feedback={error && <p role="alert">{error}</p>}
        emptyState={
          <CenteredState
            icon={<FolderOpen className="size-6 text-primary" />}
            title={t('drive.empty.title')}
            description={t('sharing.publicEmpty')}
          />
        }
      />
      <FileViewer
        nodes={items}
        hasMore={!isFile && children.hasNextPage}
        loadingMore={children.isFetchingNextPage}
        loadMore={() => children.fetchNextPage()}
      />
    </section>
  );
}
