import { create } from 'zustand';

import type { DriveNode } from './api';

interface DriveState {
  /** Selected items, in the order they were picked (files-folders.md › Tương tác UI). */
  selected: DriveNode[];
  /** Where a Shift+click range starts. */
  anchorId: string | null;
  /** Select just this item (or nothing). */
  select: (node: DriveNode | null) => void;
  /** Ctrl/⌘+click: add or remove one item. */
  toggle: (node: DriveNode) => void;
  /** Shift+click: everything between the anchor and `node`, in the order shown. */
  selectRange: (visible: DriveNode[], node: DriveNode) => void;
  /** Ctrl/⌘+A. */
  selectAll: (visible: DriveNode[]) => void;
  /** Keep the selection in step with renamed or moved items. */
  update: (nodes: DriveNode[]) => void;
  /** The details panel (`i`, "Info" in the item menu). */
  isDetailOpen: boolean;
  setDetailOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  /** The "New folder" dialog, opened from the header or the empty state. */
  isCreatingFolder: boolean;
  setCreatingFolder: (open: boolean) => void;
}

export const useDriveStore = create<DriveState>()((set) => ({
  selected: [],
  anchorId: null,
  select: (node) => {
    set({ selected: node ? [node] : [], anchorId: node?.id ?? null });
  },
  toggle: (node) => {
    set(({ selected }) => ({
      selected: selected.some((item) => item.id === node.id)
        ? selected.filter((item) => item.id !== node.id)
        : [...selected, node],
      anchorId: node.id,
    }));
  },
  selectRange: (visible, node) => {
    set(({ anchorId }) => {
      const from = visible.findIndex((item) => item.id === anchorId);
      const to = visible.findIndex((item) => item.id === node.id);
      if (from === -1 || to === -1)
        return { selected: [node], anchorId: node.id };
      const [start, end] = from < to ? [from, to] : [to, from];
      // The anchor stays put, so the next Shift+click resizes the same range.
      return { selected: visible.slice(start, end + 1), anchorId };
    });
  },
  selectAll: (visible) => {
    set({ selected: visible, anchorId: visible[0]?.id ?? null });
  },
  update: (nodes) => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    set(({ selected }) => ({
      selected: selected.map((item) => byId.get(item.id) ?? item),
    }));
  },
  isDetailOpen: false,
  setDetailOpen: (open) => {
    set(({ isDetailOpen }) => ({
      isDetailOpen: typeof open === 'function' ? open(isDetailOpen) : open,
    }));
  },
  isCreatingFolder: false,
  setCreatingFolder: (open) => {
    set({ isCreatingFolder: open });
  },
}));

/** The one selected item, for actions that need exactly one. */
export function single(selected: DriveNode[]): DriveNode | null {
  return selected.length === 1 ? (selected[0] ?? null) : null;
}
