import {
  FileUp,
  FolderOpen,
  FolderPlus,
  FolderX,
  RotateCw,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-field';
import { ResumeUploads } from '@/features/upload/components/resume-uploads';
import { useUploader } from '@/features/upload/context';
import { treeFromDrop } from '@/features/upload/drop';
import { useFolderUploader } from '@/features/upload/folder-context';
import { ApiError } from '@/lib/api/errors';

import { nodeActions, type ActionHandlers } from './actions';
import {
  downloadNode,
  useChildren,
  useMove,
  useNode,
  useRename,
  type DriveNode,
} from './api';
import { DriveBreadcrumb } from './components/drive-breadcrumb';
import { DriveToolbar } from './components/drive-toolbar';
import { MoveDialog } from './components/move-dialog';
import { NameDialog } from './components/name-dialog';
import { useMarquee } from './components/use-marquee';
import {
  NodeCollection,
  type SelectModifiers,
} from './components/node-collection';
import { driveErrorMessage } from './errors';
import { compactId, folderPath, folderUrl } from './paths';
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
  const folderId = useCurrentFolderId();
  const { folderId: rawFolderId } = useParams();
  const folder = useNode(folderId);
  const { view, setView, ordering, setOrdering } = useDrivePreferences();
  const children = useChildren(folderId, ordering);
  const store = useDriveStore();
  const { selected, select } = store;
  const rename = useRename();
  const move = useMove();
  const [renaming, setRenaming] = React.useState<Renaming | null>(null);
  const [moving, setMoving] = React.useState<Moving | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const uploader = useUploader();
  const folderUploader = useFolderUploader();
  // Files dragged in from the computer (ui-ux.md: "Kéo file vào đây để upload").
  const [fileDrag, setFileDrag] = React.useState<{
    over: string | null;
  } | null>(null);
  const dragDepth = React.useRef(0);
  const uploadFrom = (
    dataTransfer: DataTransfer,
    parentId: string | undefined,
  ): void => {
    if (!parentId) return;
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
      if (!event.dataTransfer.types.includes('Files')) return;
      dragDepth.current += 1;
      setFileDrag((current) => current ?? { over: null });
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setFileDrag(null);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDrop: (event: React.DragEvent) => {
      dragDepth.current = 0;
      setFileDrag(null);
      if (!event.dataTransfer.types.includes('Files')) return;
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
  const selectedIds = React.useMemo(
    () => new Set(selected.map((node) => node.id)),
    [selected],
  );
  const contentRef = React.useRef<HTMLDivElement>(null);
  const marquee = useMarquee({
    containerRef: contentRef,
    selectedIds,
    enabled: Boolean(folder.data) && children.isSuccess && !folder.isError,
    onSelect: (ids) => {
      const chosen = new Set(ids);
      store.selectAll(nodes.filter((node) => chosen.has(node.id)));
    },
    onClear: () => {
      select(null);
    },
    onCreate: () => {
      store.setCreatingFolder(true);
    },
  });
  // Older links carry the dashed UUID: show the compact form (paths.ts).
  React.useEffect(() => {
    if (rawFolderId && rawFolderId !== compactId(rawFolderId)) {
      void navigate(folderPath(rawFolderId), { replace: true });
    }
  }, [rawFolderId, navigate]);

  const crumbs = folder.data?.breadcrumb;
  const parentCrumb = crumbs?.at(-1);
  const parent = React.useMemo(
    () =>
      parentCrumb ? { id: parentCrumb.id, isRoot: crumbs?.length === 1 } : null,
    [parentCrumb, crumbs?.length],
  );

  // Ctrl/⌘+A, Esc and Backspace anywhere on the page, not only inside the list; otherwise the
  // browser would select all the page's text. Typing, dialogs and menus keep them.
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        useDriveStore.getState().selectAll(nodes);
      } else if (event.key === 'Escape') {
        useDriveStore.getState().select(null);
      } else if (
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
  }, [nodes, parent, navigate]);

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
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const items = ids.flatMap((id) => byId.get(id) ?? []);
    if (items.length && items.every((node) => node.id !== target.id))
      moveTo(items, target);
  };

  const handlers: ActionHandlers = {
    open,
    download: open,
    rename: (node) => {
      setRenaming({ node, name: node.name });
    },
    move: (items) => {
      setMoving({ nodes: items });
    },
    info: () => {
      store.setDetailOpen(true);
    },
    openInNewTab: (node) => {
      window.open(folderUrl(node.id), '_blank', 'noopener');
    },
    copyLink: (node) => {
      setActionError(null);
      navigator.clipboard.writeText(folderUrl(node.id)).then(
        () => {
          setAnnouncement(t('drive.linkCopied', { name: node.name }));
        },
        () => {
          setActionError(t('drive.errors.copyFailed'));
        },
      );
    },
  };

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
      {...fileDragHandlers}
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
      <DriveToolbar
        selected={selected}
        view={view}
        ordering={ordering}
        onView={setView}
        onOrdering={setOrdering}
        actions={nodeActions(selected, handlers, t)}
        onClearSelection={() => {
          select(null);
        }}
      />
      {actionError && <FormAlert>{actionError}</FormAlert>}
      <p className="sr-only" role="status">
        {announcement}
      </p>

      <div
        ref={contentRef}
        data-testid="folder-content"
        className="flex min-h-40 flex-1 flex-col"
        onPointerDown={marquee.onPointerDown}
        onDoubleClick={marquee.onDoubleClick}
      >
        {marquee.box && (
          <div
            aria-hidden="true"
            data-testid="selection-box"
            className="pointer-events-none fixed z-30 rounded-sm border border-primary bg-primary/10"
            style={{
              left: marquee.box.left - window.scrollX,
              top: marquee.box.top - window.scrollY,
              width: marquee.box.right - marquee.box.left,
              height: marquee.box.bottom - marquee.box.top,
            }}
          />
        )}
        {children.isPending ? (
          <LoadingSkeleton view={view} />
        ) : children.isError ? (
          <LoadFailed onRetry={() => void children.refetch()} />
        ) : nodes.length === 0 ? (
          <EmptyFolder
            onCreate={() => {
              store.setCreatingFolder(true);
            }}
            onUpload={(files) => {
              if (folderId) uploader.add(files, folderId);
            }}
          />
        ) : (
          <NodeCollection
            nodes={nodes}
            view={view}
            selectedIds={selectedIds}
            hasMore={children.hasNextPage}
            isLoadingMore={isFetchingNextPage}
            onLoadMore={loadMore}
            onSelect={onSelect}
            onOpen={open}
            onOpenInNewTab={handlers.openInNewTab}
            onRename={handlers.rename}
            // Read the store directly: the menu opens right after the item got selected.
            actionsFor={() =>
              nodeActions(useDriveStore.getState().selected, handlers, t)
            }
            dragIdsFor={(node) =>
              selectedIds.has(node.id) ? [...selectedIds] : [node.id]
            }
            onDropOnFolder={dropOn}
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
        )}
      </div>

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
  onUpload,
}: {
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
