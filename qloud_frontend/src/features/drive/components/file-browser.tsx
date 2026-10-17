import * as React from 'react';

import { useShortcut } from '@/features/shortcuts/context';
import { useMediaQuery } from '@/lib/use-media-query';

import type { DriveNode } from '../api';
import { DESKTOP_INPUT_QUERY } from '../desktop-input';
import { DriveToolbar, type DriveToolbarProps } from './drive-toolbar';
import { LoadingSkeleton, LoadFailed } from './browser-states';
import { NodeCollection, type NodeCollectionProps } from './node-collection';
import { useMarquee } from './use-marquee';

interface FileBrowserProps
  extends Omit<NodeCollectionProps, 'selectedIds'>, DriveToolbarProps {
  loadingLabel?: string;
  errorTitle?: string;
  enabled: boolean;
  pending: boolean;
  failed: boolean;
  onRetry: () => void;
  onSelectAll: (nodes: DriveNode[]) => void;
  onClearSelection: () => void;
  onCreate?: () => void;
  onDelete?: () => void;
  emptyState: React.ReactNode;
  feedback?: React.ReactNode;
}

/** Shared file presentation for Drive, Recent, Shared and Trash; pages supply actions/data. */
export function FileBrowser(props: FileBrowserProps): React.JSX.Element {
  const {
    nodes,
    selected,
    enabled,
    onSelectAll,
    onClearSelection,
    onCreate,
    onDelete,
  } = props;
  const contentRef = React.useRef<HTMLDivElement>(null);
  const desktopInput = useMediaQuery(DESKTOP_INPUT_QUERY);
  const selectedIds = React.useMemo(
    () => new Set(selected.map((node) => node.id)),
    [selected],
  );
  const marquee = useMarquee({
    containerRef: contentRef,
    selectedIds,
    enabled,
    canDoubleClick: desktopInput && Boolean(onCreate),
    onSelect: (ids) => {
      const chosen = new Set(ids);
      onSelectAll(nodes.filter((node) => chosen.has(node.id)));
    },
    onClear: onClearSelection,
    onCreate: () => onCreate?.(),
  });
  // Same checks as the item menu: a shortcut runs only an action the menu offers.
  const runAction = (key: string) => {
    const [node] = selected;
    if (selected.length !== 1 || !node) return;
    props
      .actionsFor(node)
      .find((action) => action.key === key)
      ?.run();
  };
  useShortcut(
    'selectAll',
    () => {
      onSelectAll(nodes);
    },
    { enabled },
  );
  useShortcut('trash', () => onDelete?.(), {
    enabled: enabled && selected.length > 0 && Boolean(onDelete),
  });
  useShortcut('clearSelection', onClearSelection, { enabled });
  useShortcut(
    'share',
    () => {
      runAction('share');
    },
    { enabled },
  );
  useShortcut(
    'download',
    () => {
      runAction('download');
    },
    { enabled },
  );
  useShortcut(
    'toggleView',
    () => {
      props.onView(props.view === 'grid' ? 'list' : 'grid');
    },
    { enabled },
  );
  return (
    <>
      <DriveToolbar {...props} />
      {props.feedback}
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
        {props.pending ? (
          <LoadingSkeleton view={props.view} label={props.loadingLabel} />
        ) : props.failed ? (
          <LoadFailed onRetry={props.onRetry} title={props.errorTitle} />
        ) : nodes.length === 0 ? (
          props.emptyState
        ) : (
          <NodeCollection {...props} selectedIds={selectedIds} />
        )}
      </div>
    </>
  );
}
