import type { TFunction } from 'i18next';
import {
  Download,
  Eye,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Info,
  Link,
  Pencil,
  Share2,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import type { DriveNode } from './api';

export interface NodeAction {
  key: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  run: () => void;
}

export interface ActionHandlers {
  open: (node: DriveNode) => void;
  download: (node: DriveNode) => void;
  rename: (node: DriveNode) => void;
  move: (nodes: DriveNode[]) => void;
  trash?: (nodes: DriveNode[]) => void;
  info: (node: DriveNode) => void;
  share?: (node: DriveNode) => void;
  /** Independent URLs for files and folders. */
  openInNewTab: (node: DriveNode) => void;
  copyLink: (node: DriveNode) => void;
}

/**
 * The item menu (right click, "⋯") for a selection. Only actions with an API so far:
 * Sharing joins at M5.
 */
export function nodeActions(
  selection: DriveNode[],
  handlers: ActionHandlers,
  t: TFunction,
): NodeAction[] {
  const [node] = selection;
  if (!node) return [];
  const move: NodeAction = {
    key: 'move',
    label:
      selection.length > 1
        ? t('drive.actions.moveCount', { count: selection.length })
        : t('drive.actions.move'),
    icon: FolderInput,
    run: () => {
      handlers.move(selection);
    },
  };
  const trash: NodeAction[] = handlers.trash
    ? [
        {
          key: 'trash',
          label: t('trash.move'),
          icon: Trash2,
          shortcut: t('trash.deleteShortcut'),
          run: () => {
            handlers.trash?.(selection);
          },
        },
      ]
    : [];
  if (selection.length > 1) return [move, ...trash];
  return [
    {
      key: 'open',
      label:
        node.kind === 'folder' ? t('drive.actions.open') : t('preview.open'),
      icon: node.kind === 'folder' ? FolderOpen : Eye,
      shortcut: '↵',
      run: () => {
        handlers.open(node);
      },
    },
    ...[
      {
        key: 'openInNewTab',
        label: t('drive.actions.openInNewTab'),
        icon: ExternalLink,
        run: () => {
          handlers.openInNewTab(node);
        },
      },
      {
        key: 'copyLink',
        label: t('drive.actions.copyLink'),
        icon: Link,
        run: () => {
          handlers.copyLink(node);
        },
      },
    ],
    ...(node.kind === 'file'
      ? [
          {
            key: 'download',
            label: t('drive.actions.download'),
            icon: Download,
            run: () => {
              handlers.download(node);
            },
          },
        ]
      : []),
    {
      key: 'rename',
      label: t('drive.actions.rename'),
      icon: Pencil,
      shortcut: 'F2',
      run: () => {
        handlers.rename(node);
      },
    },
    move,
    ...trash,
    ...(handlers.share
      ? [
          {
            key: 'share',
            label: t('sharing.action'),
            icon: Share2,
            run: () => handlers.share?.(node),
          },
        ]
      : []),
    {
      key: 'info',
      label: t('drive.actions.info'),
      icon: Info,
      shortcut: 'i',
      run: () => {
        handlers.info(node);
      },
    },
  ];
}

/** Drag-and-drop payload: the ids being moved (files-folders.md › Tương tác UI). */
export const DRAG_TYPE = 'application/x-qloud-nodes';

export function isExternalFileDrag(
  transfer: Pick<DataTransfer, 'types'>,
): boolean {
  return (
    transfer.types.includes('Files') && !transfer.types.includes(DRAG_TYPE)
  );
}

export function readDraggedIds(event: React.DragEvent): string[] | null {
  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return null;
  try {
    const ids: unknown = JSON.parse(
      event.dataTransfer.getData(DRAG_TYPE) || '[]',
    );
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}
