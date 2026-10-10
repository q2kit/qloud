import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { MoreHorizontal } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { DRAG_TYPE, readDraggedIds, type NodeAction } from '../actions';
import type { DriveNode } from '../api';
import { formatBytes, formatDate } from '../format';
import type { DriveView } from '../preferences';
import { NodeIcon } from './node-icon';

/** files-folders.md: virtualize once a folder has more than 200 items. */
export const VIRTUALIZE_AFTER = 200;
const GRID_MIN_WIDTH = 168;
const GRID_ROW_HEIGHT = 152;
const LIST_ROW_HEIGHT = 52;

export interface SelectModifiers {
  /** Ctrl or ⌘: add or remove one item. */
  toggle: boolean;
  /** Shift: a range from the anchor. */
  range: boolean;
}

interface NodeCollectionProps {
  nodes: DriveNode[];
  view: DriveView;
  selectedIds: ReadonlySet<string>;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (node: DriveNode, modifiers: SelectModifiers) => void;
  onOpen: (node: DriveNode) => void;
  onRename: (node: DriveNode) => void;
  /** The item menu for whatever is selected once `node` is part of the selection. */
  actionsFor: (node: DriveNode) => NodeAction[];
  /** Ids dragged when a drag starts on `node`: the selection if it holds `node`. */
  dragIdsFor: (node: DriveNode) => string[];
  onDropOnFolder: (folder: DriveNode, ids: string[]) => void;
}

interface ItemContext {
  dragging: ReadonlySet<string>;
  dropTargetId: string | null;
  setDragging: (ids: string[]) => void;
  setDropTargetId: (id: string | null) => void;
  onKeyDown: (event: React.KeyboardEvent, index: number) => void;
}

function useColumns(
  ref: React.RefObject<HTMLElement | null>,
  view: DriveView,
): number {
  const [columns, setColumns] = React.useState(1);
  React.useEffect(() => {
    const element = ref.current;
    if (!element || view === 'list') {
      setColumns(1);
      return;
    }
    const measure = (): void => {
      setColumns(Math.max(1, Math.floor(element.clientWidth / GRID_MIN_WIDTH)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, view]);
  return columns;
}

export function NodeCollection(props: NodeCollectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const { nodes, view, hasMore, isLoadingMore, onLoadMore } = props;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const columns = useColumns(containerRef, view);
  const virtual = nodes.length > VIRTUALIZE_AFTER;
  const [dragging, setDraggingState] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);

  const focusNode = (node: DriveNode): void => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
      ?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const node = nodes[index];
    if (!node) return;
    const modifier = event.ctrlKey || event.metaKey;
    const step = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const next = nodes[Math.min(nodes.length - 1, Math.max(0, index + step))];
      if (next) {
        // Shift+arrows grow the range from the anchor, like Shift+click.
        props.onSelect(next, { toggle: false, range: event.shiftKey });
        focusNode(next);
      }
    } else if (event.key === ' ' && modifier) {
      event.preventDefault();
      props.onSelect(node, { toggle: true, range: false });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      props.onOpen(node);
    } else if (event.key === 'F2') {
      event.preventDefault();
      props.onRename(node);
    }
  };

  const context: ItemContext = {
    dragging,
    dropTargetId,
    setDragging: (ids) => {
      setDraggingState(new Set(ids));
    },
    setDropTargetId,
    onKeyDown,
  };

  return (
    <div ref={containerRef}>
      {view === 'list' && (
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1fr)_12rem_6rem_2.25rem] gap-4 border-b border-border px-3 pb-2 text-xs font-medium text-muted-foreground sm:grid"
        >
          <span>{t('drive.columns.name')}</span>
          <span>{t('drive.columns.modified')}</span>
          <span className="text-right">{t('drive.columns.size')}</span>
        </div>
      )}
      <div
        role="listbox"
        aria-label={t('drive.items')}
        aria-multiselectable="true"
      >
        {virtual ? (
          <VirtualRows
            {...props}
            columns={columns}
            context={context}
            containerRef={containerRef}
          />
        ) : (
          <div
            className={
              view === 'grid' ? gridClassName : 'divide-y divide-border'
            }
          >
            {nodes.map((node, index) => (
              <NodeItem
                key={node.id}
                {...props}
                node={node}
                index={index}
                context={context}
              />
            ))}
          </div>
        )}
      </div>
      {hasMore && (
        <LoadMore
          isLoading={isLoadingMore}
          onLoadMore={onLoadMore}
          auto={!virtual}
        />
      )}
    </div>
  );
}

const gridClassName =
  'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]';

function VirtualRows({
  columns,
  containerRef,
  context,
  ...props
}: NodeCollectionProps & {
  columns: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  context: ItemContext;
}): React.JSX.Element {
  const { nodes, view, hasMore, isLoadingMore, onLoadMore } = props;
  const perRow = view === 'grid' ? columns : 1;
  const rowCount = Math.ceil(nodes.length / perRow);
  // Rows are positioned relative to the page; measure where the list starts.
  const [scrollMargin, setScrollMargin] = React.useState(0);
  React.useLayoutEffect(() => {
    setScrollMargin(containerRef.current?.offsetTop ?? 0);
  }, [containerRef]);
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => (view === 'grid' ? GRID_ROW_HEIGHT : LIST_ROW_HEIGHT),
    overscan: 6,
    scrollMargin,
  });
  const rows = virtualizer.getVirtualItems();
  const last = rows.at(-1);

  React.useEffect(() => {
    // Near the end of what is loaded: fetch the next page before it is needed.
    if (last && last.index >= rowCount - 4 && hasMore && !isLoadingMore)
      onLoadMore();
  }, [last, rowCount, hasMore, isLoadingMore, onLoadMore]);

  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {rows.map((row) => (
        <div
          key={row.key}
          className={cn(
            'absolute inset-x-0',
            view === 'grid' ? 'grid gap-3' : 'border-b border-border',
          )}
          style={{
            transform: `translateY(${String(row.start - scrollMargin)}px)`,
            gridTemplateColumns:
              view === 'grid'
                ? `repeat(${String(perRow)}, minmax(0, 1fr))`
                : undefined,
            paddingBottom: view === 'grid' ? '0.75rem' : undefined,
          }}
        >
          {nodes
            .slice(row.index * perRow, row.index * perRow + perRow)
            .map((node, offset) => (
              <NodeItem
                key={node.id}
                {...props}
                node={node}
                index={row.index * perRow + offset}
                context={context}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function MenuItems({
  actions,
  Item,
}: {
  actions: NodeAction[];
  Item: typeof ContextMenuItem | typeof DropdownMenuItem;
}): React.JSX.Element {
  return (
    <>
      {actions.map((action) => (
        <Item key={action.key} onSelect={action.run}>
          <action.icon />
          <span className="flex-1">{action.label}</span>
          {action.shortcut && (
            <kbd className="font-sans text-xs text-muted-foreground">
              {action.shortcut}
            </kbd>
          )}
        </Item>
      ))}
    </>
  );
}

function NodeItem({
  node,
  index,
  view,
  selectedIds,
  context,
  onSelect,
  onOpen,
  actionsFor,
  dragIdsFor,
  onDropOnFolder,
}: NodeCollectionProps & {
  node: DriveNode;
  index: number;
  context: ItemContext;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const selected = selectedIds.has(node.id);
  // Menus act on the selection; opening one on an unselected item selects it first.
  const [actions, setActions] = React.useState<NodeAction[]>([]);
  const prepareMenu = (open: boolean): void => {
    if (!open) return;
    if (!selected) onSelect(node, { toggle: false, range: false });
    setActions(actionsFor(node));
  };
  const size =
    node.kind === 'folder' ? '—' : formatBytes(node.size, i18n.language);
  const isDropTarget = context.dropTargetId === node.id;
  const canReceive = node.kind === 'folder' && !context.dragging.has(node.id);

  const dropHandlers =
    node.kind === 'folder'
      ? {
          onDragOver: (event: React.DragEvent) => {
            if (!canReceive || readDraggedIds(event) === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            context.setDropTargetId(node.id);
          },
          onDragLeave: () => {
            if (isDropTarget) context.setDropTargetId(null);
          },
          onDrop: (event: React.DragEvent) => {
            const ids = readDraggedIds(event);
            context.setDropTargetId(null);
            if (!canReceive || !ids?.length) return;
            event.preventDefault();
            onDropOnFolder(node, ids);
          },
        }
      : {};

  const props = {
    role: 'option',
    'aria-selected': selected,
    'data-node-id': node.id,
    // The name alone: the size or kind line under it is not part of it.
    'aria-label': node.name,
    tabIndex: selected || (selectedIds.size === 0 && index === 0) ? 0 : -1,
    title: node.name,
    draggable: true,
    onClick: (event: React.MouseEvent) => {
      onSelect(node, {
        toggle: event.ctrlKey || event.metaKey,
        range: event.shiftKey,
      });
    },
    onDoubleClick: () => {
      onOpen(node);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      context.onKeyDown(event, index);
    },
    onDragStart: (event: React.DragEvent) => {
      const ids = dragIdsFor(node);
      if (!selected) onSelect(node, { toggle: false, range: false });
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      context.setDragging(ids);
    },
    onDragEnd: () => {
      context.setDragging([]);
      context.setDropTargetId(null);
    },
    ...dropHandlers,
  } as const;
  const state = isDropTarget
    ? 'border-primary bg-primary/15 ring-2 ring-primary'
    : selected
      ? 'border-primary bg-primary/10 ring-1 ring-primary'
      : 'border-border hover:bg-accent/60';
  const moreButton = (
    <DropdownMenu onOpenChange={prepareMenu}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // Mouse and touch only: from the keyboard the item's own menu (Shift+F10) opens.
          tabIndex={-1}
          aria-label={t('drive.actions.more', { name: node.name })}
          className="size-8 shrink-0 opacity-100 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0 data-[state=open]:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
          }}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Focus stays on the item rather than the hidden-until-hover button.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <MenuItems actions={actions} Item={DropdownMenuItem} />
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const item =
    view === 'grid' ? (
      <div
        {...props}
        className={cn(
          'group relative flex cursor-default select-none flex-col gap-3 rounded-lg border bg-card p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          state,
        )}
      >
        <span className="flex h-20 items-center justify-center rounded-md bg-secondary">
          <NodeIcon node={node} className="size-9" />
        </span>
        <span className="flex min-w-0 items-end gap-1">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {node.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground tabular-nums">
              {node.kind === 'folder' ? t('drive.kind.folder') : size}
            </span>
          </span>
          {moreButton}
        </span>
      </div>
    ) : (
      <div
        {...props}
        className={cn(
          'group grid cursor-default select-none grid-cols-[minmax(0,1fr)_auto_2.25rem] items-center gap-4 rounded-md border border-transparent px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_12rem_6rem_2.25rem]',
          selected || isDropTarget ? state : 'hover:bg-accent/60',
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <NodeIcon node={node} className="size-5" />
          <span className="truncate text-sm font-medium">{node.name}</span>
        </span>
        <span className="hidden truncate text-sm text-muted-foreground tabular-nums sm:block">
          {formatDate(node.updated_at, i18n.language)}
        </span>
        <span className="text-right text-sm text-muted-foreground tabular-nums">
          {size}
        </span>
        {moreButton}
      </div>
    );

  return (
    <ContextMenu onOpenChange={prepareMenu}>
      <ContextMenuTrigger asChild>{item}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuItems actions={actions} Item={ContextMenuItem} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function LoadMore({
  isLoading,
  onLoadMore,
  auto,
}: {
  isLoading: boolean;
  onLoadMore: () => void;
  /** Load when the button scrolls into view; it stays as the keyboard fallback. */
  auto: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = ref.current;
    if (!auto || !element || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [auto, onLoadMore]);
  return (
    <div ref={ref} className="flex justify-center py-4">
      <Button
        variant="outline"
        size="sm"
        disabled={isLoading}
        onClick={onLoadMore}
      >
        {isLoading ? t('drive.loadingMore') : t('drive.loadMore')}
      </Button>
    </div>
  );
}
