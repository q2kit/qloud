import { FileUp, FolderOpen, FolderPlus, FolderX } from 'lucide-react';
import * as React from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import { useTranslation } from 'react-i18next';

import { ShareDialog } from '@/features/sharing/share-dialog';
import { useMe } from '@/features/settings/use-me';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-field';
import { StorageFullBanner } from '@/features/storage/storage-banner';
import { useUploadBlocked } from '@/features/storage/use-upload-blocked';
import { ResumeUploads } from '@/features/upload/components/resume-uploads';
import { useUploader } from '@/features/upload/context';
import { treeFromDrop } from '@/features/upload/drop';
import { useFolderUploader } from '@/features/upload/folder-context';
import { useTrashNodes } from '@/features/trash/api';
import { ApiError } from '@/lib/api/errors';

import {
  isExternalFileDrag,
  nodeActions,
  type ActionHandlers,
} from './actions';
import {
  downloadNode,
  useChildren,
  useMove,
  useNode,
  useRename,
  type DriveNode,
} from './api';
import { FileViewer } from './components/file-viewer';
import { useOpenPreview } from './use-open-preview';
import { DriveBreadcrumb } from './components/drive-breadcrumb';
import { FileBrowser } from './components/file-browser';
import { CenteredState, LoadFailed } from './components/browser-states';
import { MoveDialog } from './components/move-dialog';
import { NameDialog } from './components/name-dialog';
import type { SelectModifiers } from './components/node-collection';
import { driveErrorMessage } from './errors';
import { compactId, folderPath, nodeUrl, uuidFromUrl } from './paths';
import { useDrivePreferences } from './preferences';
import { useDriveStore } from './store';
import { useCurrentFolderId } from './use-current-folder';

interface Renaming {
  node: DriveNode;
  /** The name to show: the current one, or the one the server just refused. */
  name: string;
  error?: string;
}

interface Moving {
  nodes: DriveNode[];
  error?: string;
}

/** S-05: one folder of the Drive (files-folders.md). */
export function DrivePage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openPreview = useOpenPreview();
  const folderId = useCurrentFolderId();
  const { folderId: rawFolderId } = useParams();
  const folder = useNode(folderId);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get('select');
  const targetId = requestedId ? uuidFromUrl(requestedId) : undefined;
  const target = useNode(targetId);
  const appliedLocation = React.useRef<string | null>(null);
  const [revealedLocation, setRevealedLocation] = React.useState<string | null>(
    null,
  );
  const { view, setView, ordering, setOrdering } = useDrivePreferences();
  const children = useChildren(folderId, ordering);
  const store = useDriveStore();
  const { selected, select } = store;
  const me = useMe();
  const selectedDetail = useNode(
    selected.length === 1 ? selected[0]?.id : undefined,
  );
  const canWrite =
    folder.data?.is_root === true ||
    folder.data?.capabilities.can_edit === true;
  const canEditSelection =
    selected.length === 1
      ? (selectedDetail.data?.capabilities.can_edit ?? canWrite)
      : canWrite;
  const [sharing, setSharing] = React.useState<DriveNode | null>(null);
  const rename = useRename();
  const move = useMove();
  const trash = useTrashNodes();
  const [renaming, setRenaming] = React.useState<Renaming | null>(null);
  const [moving, setMoving] = React.useState<Moving | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const uploader = useUploader();
  const folderUploader = useFolderUploader();
  const uploadBlocked = useUploadBlocked(folderId);
  // Files dragged in from the computer (ui-ux.md: "Kéo file vào đây để upload").
  const [fileDrag, setFileDrag] = React.useState<{
    over: string | null;
  } | null>(null);
  const dragDepth = React.useRef(0);
  const uploadFrom = (
    dataTransfer: DataTransfer,
    parentId: string | undefined,
  ): void => {
    if (!parentId || !canWrite) return;
    if (uploadBlocked) {
      setActionError(t('storage.full.uploadBlocked'));
      return;
    }
    setActionError(null);
    void treeFromDrop(dataTransfer)
      .then((tree) => {
        if (tree.directories.length) folderUploader.addTree(tree, parentId);
        else
          uploader.add(
            tree.files.map(({ file }) => file),
            parentId,
          );
      })
      .catch(() => {
        setActionError(t('upload.errors.folder_failed'));
      });
  };
  const fileDragHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!isExternalFileDrag(event.dataTransfer)) return;
      dragDepth.current += 1;
      setFileDrag((current) => current ?? { over: null });
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!isExternalFileDrag(event.dataTransfer)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setFileDrag(null);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!isExternalFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDrop: (event: React.DragEvent) => {
      dragDepth.current = 0;
      setFileDrag(null);
      if (!isExternalFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      uploadFrom(event.dataTransfer, folderId);
    },
  };

  // A selection from another folder means nothing here (a just-created folder is kept).
  React.useEffect(() => {
    if (selected.some((node) => node.parent_id !== folderId)) select(null);
  }, [folderId, selected, select]);

  const nodes = React.useMemo(
    () => children.data?.pages.flatMap((page) => page.results) ?? [],
    [children.data],
  );
  // Validate the parent before walking cursor pages, including links to stale files.
  React.useEffect(() => {
    if (!targetId || appliedLocation.current === location.key || !folder.data)
      return;
    if (
      target.isError ||
      (target.data &&
        (target.data.kind !== 'file' || target.data.parent_id !== folderId))
    ) {
      appliedLocation.current = location.key;
      select(null);
      return;
    }
    if (
      !target.data ||
      !children.data ||
      children.isFetching ||
      children.isError
    )
      return;
    const node = nodes.find((item) => item.id === targetId);
    if (node) {
      appliedLocation.current = location.key;
      select(node);
    } else if (children.hasNextPage) {
      void children.fetchNextPage();
    } else {
      appliedLocation.current = location.key;
    }
  }, [
    targetId,
    target.data,
    target.isError,
    location.key,
    folder.data,
    folderId,
    children,
    nodes,
    select,
  ]);

  const locationUnavailable =
    Boolean(targetId) &&
    (target.isError ||
      Boolean(
        target.data &&
        (target.data.kind !== 'file' || target.data.parent_id !== folderId),
      ) ||
      (children.isSuccess &&
        !children.isFetching &&
        !children.hasNextPage &&
        !nodes.some((node) => node.id === targetId)));
  const revealId =
    revealedLocation !== location.key &&
    selected.some((node) => node.id === targetId) &&
    !locationUnavailable
      ? targetId
      : undefined;

  const selectedIds = React.useMemo(
    () => new Set(selected.map((node) => node.id)),
    [selected],
  );
  // Older links carry the dashed UUID: show the compact form (paths.ts).
  React.useEffect(() => {
    if (rawFolderId && rawFolderId !== compactId(rawFolderId)) {
      void navigate(folderPath(rawFolderId) + location.search, {
        replace: true,
      });
    }
  }, [rawFolderId, navigate, location.search]);

  const crumbs = folder.data?.breadcrumb;
  const parentCrumb = crumbs?.at(-1);
  const parent = React.useMemo(
    () =>
      parentCrumb
        ? {
            id: parentCrumb.id,
            isRoot: parentCrumb.id === me.data?.root_folder_id,
          }
        : null,
    [parentCrumb, me.data?.root_folder_id],
  );

  // Parent navigation belongs to Drive; selection shortcuts live in FileBrowser.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.defaultPrevented ||
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]',
        )
      ) {
        return;
      }
      if (
        event.key === 'Backspace' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        parent
      ) {
        // Like a file manager: back up to the parent folder (nothing at the root).
        event.preventDefault();
        void navigate(folderPath(parent.isRoot ? undefined : parent.id));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [parent, navigate]);

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
    openPreview(node);
  };

  const submitRename = ({ node }: Renaming, raw: string): void => {
    const name = raw.trim();
    setRenaming(null);
    if (name === node.name) return;
    store.update([{ ...node, name }]);
    rename.mutate(
      { node, name },
      {
        onError: (error) => {
          store.update([node]);
          setRenaming({ node, name, error: driveErrorMessage(error, t) });
        },
      },
    );
  };

  /** Optimistic: the items leave this folder at once and come back if the API refuses. */
  const moveTo = (
    items: DriveNode[],
    target: Pick<DriveNode, 'id' | 'name' | 'is_root'>,
  ): void => {
    const targetName = target.is_root ? t('shell.breadcrumbRoot') : target.name;
    setActionError(null);
    setAnnouncement('');
    setMoving(null);
    select(null);
    move.mutate(
      { nodes: items, targetId: target.id },
      {
        onSuccess: (moved) => {
          setAnnouncement(
            t('drive.move.done', { count: moved.length, target: targetName }),
          );
        },
        onError: (error) => {
          store.selectAll(items);
          setActionError(driveErrorMessage(error, t));
        },
      },
    );
  };

  const dropOn = (
    target: Pick<DriveNode, 'id' | 'name' | 'is_root'>,
    ids: string[],
  ): void => {
    if (!canWrite) return;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const items = ids.flatMap((id) => byId.get(id) ?? []);
    if (items.length && items.every((node) => node.id !== target.id))
      moveTo(items, target);
  };

  const handlers: ActionHandlers = {
    open,
    download: (node) => {
      void downloadNode(node.id).catch(() => {
        setActionError(t('drive.errors.downloadFailed'));
      });
    },
    rename: (node) => {
      setRenaming({ node, name: node.name });
    },
    move: (items) => {
      setMoving({ nodes: items });
    },
    trash: (items) => {
      if (trash.isPending) return;
      if (items.length > 1000) {
        setActionError(t('trash.tooMany'));
        return;
      }
      setActionError(null);
      select(null);
      trash.mutate(
        items.map((node) => node.id),
        {
          onError: () => {
            store.selectAll(items);
            setActionError(t('trash.actionFailed'));
          },
        },
      );
    },
    share: (node) => {
      setSharing(node);
    },
    info: () => {
      store.setDetailOpen(true);
    },
    openInNewTab: (node) => {
      window.open(nodeUrl(node), '_blank', 'noopener');
    },
    copyLink: (node) => {
      setActionError(null);
      navigator.clipboard.writeText(nodeUrl(node)).then(
        () => {
          setAnnouncement(t('drive.linkCopied', { name: node.name }));
        },
        () => {
          setActionError(t('drive.errors.copyFailed'));
        },
      );
    },
  };

  const actionsFor = () =>
    nodeActions(useDriveStore.getState().selected, handlers, t).filter(
      (action) => {
        if (action.key === 'share')
          return selectedDetail.data?.id ===
            useDriveStore.getState().selected[0]?.id
            ? selectedDetail.data?.capabilities.can_share === true
            : canWrite &&
                useDriveStore.getState().selected[0]?.is_root === false;
        if (['rename', 'move', 'trash'].includes(action.key))
          return canEditSelection;
        return true;
      },
    );

  const onSelect = (
    node: DriveNode,
    { toggle, range }: SelectModifiers,
  ): void => {
    if (range) store.selectRange(nodes, node);
    else if (toggle) store.toggle(node);
    else select(node);
  };

  if (folder.isError) {
    return (
      <FolderUnavailable
        error={folder.error}
        onRetry={() => void folder.refetch()}
      />
    );
  }

  const currentName = folder.data?.is_root
    ? t('shell.breadcrumbRoot')
    : folder.data?.name;

  return (
    <section
      className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4"
      {...(canWrite ? fileDragHandlers : {})}
    >
      {fileDrag && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-3 z-20 flex items-end justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5 pb-6"
        >
          <span className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-soft">
            {t('upload.dropHere', {
              folder: fileDrag.over ?? currentName ?? '',
            })}
          </span>
        </div>
      )}
      <div className="flex min-h-9 items-center border-b border-border pb-4">
        {folder.data ? (
          <DriveBreadcrumb folder={folder.data} onDrop={dropOn} />
        ) : (
          <div
            className="h-7 w-48 animate-pulse rounded-md bg-secondary"
            aria-hidden="true"
          />
        )}
      </div>
      <ResumeUploads />
      <FileBrowser
        nodes={nodes}
        revealId={revealId}
        onRevealed={() => {
          setRevealedLocation(location.key);
        }}
        selected={selected}
        view={view}
        ordering={ordering}
        onView={setView}
        onOrdering={setOrdering}
        onClearSelection={() => {
          select(null);
        }}
        onSelectAll={(items) => {
          store.selectAll(items);
        }}
        onCreate={
          canWrite
            ? () => {
                store.setCreatingFolder(true);
              }
            : undefined
        }
        enabled={Boolean(folder.data) && children.isSuccess && !folder.isError}
        pending={children.isPending}
        failed={children.isError}
        onRetry={() => void children.refetch()}
        feedback={
          <>
            {locationUnavailable && (
              <FormAlert>{t('drive.errors.locationUnavailable')}</FormAlert>
            )}
            <StorageFullBanner />
            {actionError && <FormAlert>{actionError}</FormAlert>}
            <p className="sr-only" role="status">
              {announcement}
            </p>
          </>
        }
        emptyState={
          <EmptyFolder
            canWrite={canWrite}
            canUpload={!uploadBlocked}
            onCreate={() => {
              store.setCreatingFolder(true);
            }}
            onUpload={(files) => {
              if (folderId) uploader.add(files, folderId);
            }}
          />
        }
        hasMore={children.hasNextPage}
        isLoadingMore={isFetchingNextPage}
        onLoadMore={loadMore}
        onSelect={onSelect}
        onOpen={open}
        onOpenInNewTab={handlers.openInNewTab}
        onRename={canEditSelection ? handlers.rename : undefined}
        onDelete={
          canEditSelection ? () => handlers.trash?.(selected) : undefined
        }
        actionsFor={actionsFor}
        dragIdsFor={(node) =>
          selectedIds.has(node.id) ? [...selectedIds] : [node.id]
        }
        draggable={canWrite}
        onDropOnFolder={canWrite ? dropOn : undefined}
        onDropFiles={(target, dataTransfer) => {
          dragDepth.current = 0;
          setFileDrag(null);
          uploadFrom(dataTransfer, target.id);
        }}
        onFileDragOverFolder={(target) => {
          setFileDrag((current) =>
            current ? { over: target?.name ?? null } : current,
          );
        }}
      />

      <FileViewer
        nodes={nodes}
        hasMore={children.hasNextPage}
        loadingMore={isFetchingNextPage}
        loadMore={() => children.fetchNextPage()}
      />
      {sharing && (
        <ShareDialog
          node={sharing}
          onClose={() => {
            setSharing(null);
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
      <MoveDialog
        nodes={moving?.nodes ?? null}
        startFolderId={folderId}
        error={moving?.error}
        onOpenChange={(next) => {
          if (!next) setMoving(null);
        }}
        onMove={(target) => {
          if (moving) moveTo(moving.nodes, target);
        }}
      />
    </section>
  );
}

function EmptyFolder({
  canWrite,
  canUpload,
  onCreate,
  onUpload,
}: {
  canWrite: boolean;
  canUpload: boolean;
  onCreate: () => void;
  onUpload: (files: File[]) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <CenteredState
      icon={<FolderOpen className="size-6 text-primary" aria-hidden="true" />}
      title={t('drive.empty.title')}
      description={t('drive.empty.description')}
    >
      {canWrite && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length > 0) onUpload(files);
              event.target.value = '';
            }}
          />
          <Button
            disabled={!canUpload}
            onClick={() => {
              input.current?.click();
            }}
          >
            <FileUp />
            {t('drive.actions.upload')}
          </Button>
          <Button variant="outline" onClick={onCreate}>
            <FolderPlus />
            {t('drive.actions.newFolder')}
          </Button>
        </>
      )}
    </CenteredState>
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
