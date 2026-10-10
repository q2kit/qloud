import { create } from 'zustand';

/** What the tray shows; the engine (engine.ts) owns files, requests and timers. */
export type UploadStatus =
  | 'queued'
  | 'conflict' // the name is taken: waiting for "keep both" or "skip"
  | 'uploading'
  | 'completing'
  | 'paused'
  | 'error'
  | 'done'
  | 'cancelled'
  | 'skipped';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  type: string;
  parentId: string;
  sessionId?: string;
  status: UploadStatus;
  /** Bytes in storage plus those of parts on their way. */
  loaded: number;
  /** A stable API code (`quota_exceeded`, `upload_failed`…) for an i18n message. */
  error?: string;
}

/** Still something to do: shown as active, and leaving the page warns (upload.md). */
export const ACTIVE: ReadonlySet<UploadStatus> = new Set([
  'queued',
  'conflict',
  'uploading',
  'completing',
]);

interface UploadState {
  items: UploadItem[];
  /** Bytes per second over the last few seconds. */
  speed: number;
  /** No network: parts wait and the queue resumes on its own. */
  offline: boolean;
  isTrayCollapsed: boolean;
  add: (items: UploadItem[]) => void;
  patch: (id: string, changes: Partial<UploadItem>) => void;
  setSpeed: (speed: number) => void;
  setOffline: (offline: boolean) => void;
  setTrayCollapsed: (collapsed: boolean) => void;
  /** Drop finished, cancelled and skipped rows; closes the tray once nothing is left. */
  clearFinished: () => void;
}

export const useUploadStore = create<UploadState>()((set) => ({
  items: [],
  speed: 0,
  offline: false,
  isTrayCollapsed: false,
  add: (items) => {
    set((state) => ({
      items: [...state.items, ...items],
      isTrayCollapsed: false,
    }));
  },
  patch: (id, changes) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    }));
  },
  setSpeed: (speed) => {
    set({ speed });
  },
  setOffline: (offline) => {
    set({ offline });
  },
  setTrayCollapsed: (collapsed) => {
    set({ isTrayCollapsed: collapsed });
  },
  clearFinished: () => {
    set((state) => ({
      items: state.items.filter(
        (item) =>
          ACTIVE.has(item.status) ||
          item.status === 'paused' ||
          item.status === 'error',
      ),
    }));
  },
}));
