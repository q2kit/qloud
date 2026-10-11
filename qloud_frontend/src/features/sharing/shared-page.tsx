import * as React from 'react';
import { Download, Eye, FolderOpen, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { FormAlert } from '@/features/auth/components/form-field';
import { downloadNode, type DriveNode } from '@/features/drive/api';
import { FileBrowser } from '@/features/drive/components/file-browser';
import { CenteredState } from '@/features/drive/components/browser-states';
import { folderPath, compactId } from '@/features/drive/paths';
import { useDrivePreferences } from '@/features/drive/preferences';
import { useDriveStore } from '@/features/drive/store';
import type { NodeAction } from '@/features/drive/actions';
import { useShared } from './api';

export function SharedPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { view, setView, ordering, setOrdering } = useDrivePreferences();
  const query = useShared(ordering);
  const store = useDriveStore();
  const { select } = store;
  const [error, setError] = React.useState('');
  const nodes = React.useMemo(
    () => query.data?.pages.flatMap((p) => p.results) ?? [],
    [query.data],
  );
  React.useEffect(() => {
    select(null);
    return () => {
      select(null);
    };
  }, [select]);
  const open = (node: DriveNode) => {
    void navigate(
      node.kind === 'folder'
        ? folderPath(node.id)
        : `/drive/files/${compactId(node.id)}`,
    );
  };
  const actionsFor = (): NodeAction[] => {
    const selection = useDriveStore.getState().selected;
    const node = selection[0];
    if (!node || selection.length !== 1) return [];
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
                void downloadNode(node.id).catch(() => {
                  setError(t('drive.errors.downloadFailed'));
                });
              },
            },
          ]
        : []),
    ];
  };
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('navigation.shared')}</h1>
      <p className="text-sm text-muted-foreground">
        {t('sharing.sharedDescription')}
      </p>
      <FileBrowser
        nodes={nodes}
        selected={store.selected}
        view={view}
        onView={setView}
        ordering={ordering}
        onOrdering={setOrdering}
        actions={actionsFor()}
        actionsFor={actionsFor}
        onClearSelection={() => {
          select(null);
        }}
        onSelectAll={store.selectAll}
        onSelect={(node, { range, toggle }) => {
          if (range) store.selectRange(nodes, node);
          else if (toggle) store.toggle(node);
          else select(node);
        }}
        onOpen={open}
        draggable={false}
        enabled={query.isSuccess}
        pending={query.isPending}
        failed={query.isError}
        onRetry={() => void query.refetch()}
        hasMore={query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => {
          if (!query.isFetchingNextPage) void query.fetchNextPage();
        }}
        feedback={error && <FormAlert>{error}</FormAlert>}
        emptyState={
          <CenteredState
            icon={<Share2 className="size-6 text-primary" />}
            title={t('sharing.empty')}
            description={t('sharing.emptyDescription')}
          />
        }
      />
    </section>
  );
}
