import { create } from 'zustand';

import type { DriveNode } from './api';

interface DriveState {
  /** The item the details panel shows; M2-07b adds multi-selection. */
  selected: DriveNode | null;
  select: (node: DriveNode | null) => void;
  /** The "New folder" dialog, opened from the header or the empty state. */
  isCreatingFolder: boolean;
  setCreatingFolder: (open: boolean) => void;
}

export const useDriveStore = create<DriveState>()((set) => ({
  selected: null,
  select: (node) => {
    set({ selected: node });
  },
  isCreatingFolder: false,
  setCreatingFolder: (open) => {
    set({ isCreatingFolder: open });
  },
}));
