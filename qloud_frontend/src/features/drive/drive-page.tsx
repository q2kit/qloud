import { FolderOpen, FolderPlus, FolderX, RotateCw } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-field';
import { ApiError } from '@/lib/api/errors';

import {
  downloadNode,
  useChildren,
  useNode,
  useRename,
  type DriveNode,
} from './api';
import { DriveBreadcrumb } from './components/drive-breadcrumb';
import { DriveToolbar } from './components/drive-toolbar';
import { NameDialog } from './components/name-dialog';
import { NodeCollection } from './components/node-collection';
import { driveErrorMessage } from './errors';
import { folderPath } from './paths';
import { useDrivePreferences } from './preferences';
import { useDriveStore } from './store';
import { useCurrentFolderId } from './use-current-folder';

interface Renaming {
  node: DriveNode;
  /** The name to show: the current one, or the one the server just refused. */
  name: string;
  error?: string;
}

/** S-05: one folder of the Drive (files-folders.md). */
export function DrivePage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const folderId = useCurrentFolderId();
  const folder = useNode(folderId);
  const { view, setView, ordering, setOrdering } = useDrivePreferences();
  const children = useChildren(folderId, ordering);
  const selected = useDriveStore((state) => state.selected);
  const select = useDriveStore((state) => state.select);
  const setCreatingFolder = useDriveStore((state) => state.setCreatingFolder);
  const rename = useRename();
  const [renaming, setRenaming] = React.useState<Renaming | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // A selection from another folder means nothing here (a just-created folder is kept).
  React.useEffect(() => {
    if (selected && selected.parent_id !== folderId) select(null);
  }, [folderId, selected, select]);

  const nodes = React.useMemo(
    () => children.data?.pages.flatMap((page) => page.results) ?? [],
    [children.data],
  );
  const { fetchNextPage, isFetchingNextPage } = children;
  const loadMore = React.useCallback(() => {
    if (!isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, isFetchingNextPage]);

  const open = (node: DriveNode): void => {
    setActionError(null);
    if (node.kind === 'folder') {
      void navigate(folderPath(node.id));
      return;
    }
    // Until the viewer (M3) exists, opening a file downloads it.
    downloadNode(node.id).catch(() => {
      setActionError(t('drive.errors.downloadFailed'));
    });
  };

  const submitRename = ({ node }: Renaming, raw: string): void => {
    const name = raw.trim();
    setRenaming(null);
    if (name === node.name) return;
    select({ ...node, name });
    rename.mutate(
      { node, name },
      {
        onError: (error) => {
          select(node);
          setRenaming({ node, name, error: driveErrorMessage(error, t) });
        },
      },
    );
  };

  if (folder.isError) {
    return (
      <FolderUnavailable
        error={folder.error}
        onRetry={() => void folder.refetch()}
      />
    );
  }

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex min-h-9 items-center border-b border-border pb-4">
        {folder.data ? (
          <DriveBreadcrumb folder={folder.data} />
        ) : (
          <div
            className="h-7 w-48 animate-pulse rounded-md bg-secondary"
            aria-hidden="true"
          />
        )}
      </div>
      <DriveToolbar
        selected={selected}
        view={view}
        ordering={ordering}
        onView={setView}
        onOrdering={setOrdering}
        onRename={(node) => {
          setRenaming({ node, name: node.name });
        }}
        onDownload={open}
      />
      {actionError && <FormAlert>{actionError}</FormAlert>}

      {children.isPending ? (
        <LoadingSkeleton view={view} />
      ) : children.isError ? (
        <LoadFailed onRetry={() => void children.refetch()} />
      ) : nodes.length === 0 ? (
        <EmptyFolder
          onCreate={() => {
            setCreatingFolder(true);
          }}
        />
      ) : (
        <NodeCollection
          nodes={nodes}
          view={view}
          selectedId={selected?.id ?? null}
          hasMore={children.hasNextPage}
          isLoadingMore={isFetchingNextPage}
          onLoadMore={loadMore}
          onSelect={select}
          onOpen={open}
          onRename={(node) => {
            setRenaming({ node, name: node.name });
          }}
        />
      )}

      <NameDialog
        open={renaming !== null}
        title={t('drive.dialogs.rename')}
        submitLabel={t('drive.actions.save')}
        initialName={renaming?.name ?? ''}
        keepExtension={renaming?.node.kind === 'file'}
        error={renaming?.error}
        onOpenChange={(next) => {
          if (!next) setRenaming(null);
        }}
        onSubmit={(name) => {
          if (renaming) submitRename(renaming, name);
        }}
      />
    </section>
  );
}

function LoadingSkeleton({
  view,
}: {
  view: 'grid' | 'list';
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('drive.loading')}
      className={
        view === 'grid'
          ? 'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3'
          : 'space-y-2'
      }
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className={
            view === 'grid'
              ? 'h-36 animate-pulse rounded-lg bg-secondary'
              : 'h-11 animate-pulse rounded-md bg-secondary'
          }
        />
      ))}
    </div>
  );
}

function CenteredState({
  icon,
  title,
  description,
  children,
}: React.PropsWithChildren<{
  icon: React.ReactNode;
  title: string;
  description: string;
}>): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-soft">
          {icon}
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {children && (
          <div className="mt-6 flex justify-center gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}

function EmptyFolder({
  onCreate,
}: {
  onCreate: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <CenteredState
      icon={<FolderOpen className="size-6 text-primary" aria-hidden="true" />}
      title={t('drive.empty.title')}
      description={t('drive.empty.description')}
    >
      <Button onClick={onCreate}>
        <FolderPlus />
        {t('drive.actions.newFolder')}
      </Button>
    </CenteredState>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div role="alert">
      <CenteredState
        icon={
          <RotateCw className="size-6 text-destructive" aria-hidden="true" />
        }
        title={t('drive.errors.loadFailed')}
        description={t('drive.errors.loadFailedDescription')}
      >
        <Button variant="outline" onClick={onRetry}>
          <RotateCw />
          {t('drive.actions.retry')}
        </Button>
      </CenteredState>
    </div>
  );
}

function FolderUnavailable({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  // Missing and not allowed are the same 404 by design (api.md).
  if (error instanceof ApiError && error.status === 404) {
    return (
      <CenteredState
        icon={
          <FolderX
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
        }
        title={t('drive.errors.notFoundTitle')}
        description={t('drive.errors.notFoundDescription')}
      >
        <Button asChild>
          <Link to={folderPath(undefined)}>{t('navigation.home')}</Link>
        </Button>
      </CenteredState>
    );
  }
  return <LoadFailed onRetry={onRetry} />;
}
