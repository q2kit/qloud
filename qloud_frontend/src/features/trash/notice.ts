import { create } from 'zustand';

interface TrashNoticeState {
  notice: { ids: string[]; expiresAt: number } | null;
  show: (ids: string[]) => void;
  clear: () => void;
  forget: (ids: string[]) => void;
}

// UI action IDs only; server data stays in TanStack Query.
export const useTrashNotice = create<TrashNoticeState>((set) => ({
  notice: null,
  show: (ids) => {
    set({ notice: { ids, expiresAt: Date.now() + 8000 } });
  },
  forget: (ids) => {
    set((state) => {
      if (!state.notice) return {};
      const remaining = state.notice.ids.filter((id) => !ids.includes(id));
      return {
        notice: remaining.length ? { ...state.notice, ids: remaining } : null,
      };
    });
  },
  clear: () => {
    set({ notice: null });
  },
}));
