import * as React from 'react';

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
  onCreate?: () => void;
  emptyState: React.ReactNode;
  feedback?: React.ReactNode;
}

/** Shared file presentation for Drive, Recent, Shared and Trash; pages supply actions/data. */
export function FileBrowser(props: FileBrowserProps): React.JSX.Element {
  const { nodes, selected, enabled, onSelectAll, onClearSelection, onCreate } =
    props;
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
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !enabled ||
        event.defaultPrevented ||
        document.querySelector(
          '[role="menu"], [role="dialog"], [role="alertdialog"]',
        ) ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
          ))
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        onSelectAll(nodes);
      } else if (event.key === 'Escape') onClearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, nodes, onSelectAll, onClearSelection]);
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
