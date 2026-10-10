import { useWindowVirtualizer } from '@tanstack/react-virtual';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { DriveNode } from '../api';
import { formatBytes, formatDate } from '../format';
import type { DriveView } from '../preferences';
import { NodeIcon } from './node-icon';

/** files-folders.md: virtualize once a folder has more than 200 items. */
export const VIRTUALIZE_AFTER = 200;
const GRID_MIN_WIDTH = 168;
const GRID_ROW_HEIGHT = 152;
const LIST_ROW_HEIGHT = 52;

interface NodeCollectionProps {
  nodes: DriveNode[];
  view: DriveView;
  selectedId: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (node: DriveNode) => void;
  onOpen: (node: DriveNode) => void;
  onRename: (node: DriveNode) => void;
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

  // Keyboard: arrows move between items (a row is `columns` items in the grid).
  const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const node = nodes[index];
    if (!node) return;
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
        props.onSelect(next);
        containerRef.current
          ?.querySelector<HTMLElement>(`[data-node-id="${next.id}"]`)
          ?.focus();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      props.onOpen(node);
    } else if (event.key === 'F2') {
      event.preventDefault();
      props.onRename(node);
    }
  };

  return (
    <div ref={containerRef}>
      {view === 'list' && (
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1fr)_12rem_6rem] gap-4 border-b border-border px-3 pb-2 text-xs font-medium text-muted-foreground sm:grid"
        >
          <span>{t('drive.columns.name')}</span>
          <span>{t('drive.columns.modified')}</span>
          <span className="text-right">{t('drive.columns.size')}</span>
        </div>
      )}
      <div role="listbox" aria-label={t('drive.items')}>
        {virtual ? (
          <VirtualRows
            {...props}
            columns={columns}
            onKeyDown={onKeyDown}
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
                onKeyDown={onKeyDown}
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
  onKeyDown,
  ...props
}: NodeCollectionProps & {
  columns: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onKeyDown: (event: React.KeyboardEvent, index: number) => void;
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
                onKeyDown={onKeyDown}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function NodeItem({
  node,
  index,
  view,
  selectedId,
  onSelect,
  onOpen,
  onKeyDown,
}: NodeCollectionProps & {
  node: DriveNode;
  index: number;
  onKeyDown: (event: React.KeyboardEvent, index: number) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const selected = node.id === selectedId;
  const size =
    node.kind === 'folder' ? '—' : formatBytes(node.size, i18n.language);
  const common = {
    role: 'option',
    'aria-selected': selected,
    'data-node-id': node.id,
    // The name alone: the size or kind line under it is not part of it.
    'aria-label': node.name,
    tabIndex: selected || (selectedId === null && index === 0) ? 0 : -1,
    title: node.name,
    onClick: () => {
      onSelect(node);
    },
    onDoubleClick: () => {
      onOpen(node);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      onKeyDown(event, index);
    },
  } as const;
  const state = selected
    ? 'border-primary bg-primary/10 ring-1 ring-primary'
    : 'border-border hover:bg-accent/60';

  if (view === 'grid') {
    return (
      <div
        {...common}
        className={cn(
          'flex cursor-default select-none flex-col gap-3 rounded-lg border bg-card p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          state,
        )}
      >
        <span className="flex h-20 items-center justify-center rounded-md bg-secondary">
          <NodeIcon node={node} className="size-9" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {node.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {node.kind === 'folder' ? t('drive.kind.folder') : size}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div
      {...common}
      className={cn(
        'grid cursor-default select-none grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md border border-transparent px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_12rem_6rem]',
        selected ? state : 'hover:bg-accent/60',
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
    </div>
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
