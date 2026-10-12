import {
  Clock3,
  Download,
  Eye,
  FolderOpen,
  Info,
  ExternalLink,
  Link,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { FormAlert } from '@/features/auth/components/form-field';
import { useMe } from '@/features/settings/use-me';

import type { NodeAction } from './actions';
import { downloadNode, useRecent, type DriveNode } from './api';
import { CenteredState } from './components/browser-states';
import { FileBrowser } from './components/file-browser';
import { FileViewer } from './components/file-viewer';
import { useOpenPreview } from './use-open-preview';
import { folderPath, nodeUrl } from './paths';
import { useDrivePreferences } from './preferences';
import { useDriveStore } from './store';

export function RecentPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openPreview = useOpenPreview();
  const me = useMe();
  const recent = useRecent();
  const { view, setView } = useDrivePreferences();
  const store = useDriveStore();
  const { selected, select } = store;
  const [actionError, setActionError] = React.useState<string | null>(null);
  const nodes = React.useMemo(
    () => recent.data?.pages.flatMap((page) => page.results) ?? [],
    [recent.data],
  );
  React.useEffect(() => {
    select(null);
    return () => {
      select(null);
    };
  }, [select]);
  const open = (node: DriveNode): void => {
    setActionError(null);
    openPreview(node);
  };
  const actionsFor = (): NodeAction[] => {
    const [node] = useDriveStore.getState().selected;
    if (!node || useDriveStore.getState().selected.length !== 1) return [];
    return [
      {
        key: 'open',
        label: t('preview.open'),
        icon: Eye,
        shortcut: '↵',
        run: () => {
          open(node);
        },
      },
      {
        key: 'download',
        label: t('drive.actions.download'),
        icon: Download,
        run: () => {
          void downloadNode(node.id).catch(() => {
            setActionError(t('drive.errors.downloadFailed'));
          });
        },
      },
      {
        key: 'openInNewTab',
        label: t('drive.actions.openInNewTab'),
        icon: ExternalLink,
        run: () => {
          window.open(nodeUrl(node), '_blank', 'noopener');
        },
      },
      {
        key: 'copyLink',
        label: t('drive.actions.copyLink'),
        icon: Link,
        run: () => {
          void navigator.clipboard.writeText(nodeUrl(node)).catch(() => {
            setActionError(t('drive.errors.copyFailed'));
          });
        },
      },
      {
        key: 'location',
        label: t('drive.actions.openLocation'),
        icon: FolderOpen,
        run: () => {
          if (node.parent_id)
            void navigate(
              folderPath(
                node.parent_id === me.data?.root_folder_id
                  ? undefined
                  : node.parent_id,
                node.id,
              ),
            );
        },
      },
      {
        key: 'info',
        label: t('drive.actions.info'),
        icon: Info,
        run: () => {
          store.setDetailOpen(true);
        },
      },
    ];
  };
  return (
    <section className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4">
      <div className="border-b border-border pb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          {t('navigation.recent')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('recent.description')}
        </p>
      </div>
      <FileBrowser
        nodes={nodes}
        selected={selected}
        view={view}
        onView={setView}
        ordering="-updated_at"
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
        onOpenInNewTab={(node) => {
          window.open(nodeUrl(node), '_blank', 'noopener');
        }}
        draggable={false}
        enabled={recent.isSuccess}
        loadingLabel={t('recent.loading')}
        errorTitle={t('recent.loadFailed')}
        pending={recent.isPending}
        failed={recent.isError}
        onRetry={() => void recent.refetch()}
        feedback={actionError && <FormAlert>{actionError}</FormAlert>}
        hasMore={recent.hasNextPage}
        isLoadingMore={recent.isFetchingNextPage}
        onLoadMore={() => {
          if (!recent.isFetchingNextPage) void recent.fetchNextPage();
        }}
        emptyState={
          <CenteredState
            icon={<Clock3 className="size-6 text-primary" aria-hidden="true" />}
            title={t('recent.emptyTitle')}
            description={t('recent.emptyDescription')}
          />
        }
      />
      <FileViewer
        nodes={nodes}
        hasMore={recent.hasNextPage}
        loadingMore={recent.isFetchingNextPage}
        loadMore={() => recent.fetchNextPage()}
      />
    </section>
  );
}
