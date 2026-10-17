/**
 * Every keyboard shortcut, in one place (ui-ux.md › Phím tắt). The `?` dialog, menu
 * labels and `aria-keyshortcuts` are all generated from this table.
 */

/** One key press. `mod` is Ctrl, or ⌘ on a Mac. Keys follow `KeyboardEvent.key`. */
export interface Combo {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** A binding is a sequence of presses: `[G, D]` is "G then D". */
export type Binding = readonly Combo[];

export type ShortcutGroup =
  'general' | 'navigation' | 'selection' | 'items' | 'viewer';

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  'general',
  'navigation',
  'selection',
  'items',
  'viewer',
];

interface Definition {
  group: ShortcutGroup;
  /** Alternatives: any one of them triggers the shortcut. */
  bindings: readonly Binding[];
}

const key = (name: string, extra: Omit<Combo, 'key'> = {}): Combo => ({
  key: name,
  ...extra,
});
const go = (second: string): Definition => ({
  group: 'navigation',
  bindings: [[key('g'), key(second)]],
});

export const SHORTCUTS = {
  palette: {
    group: 'general',
    bindings: [[key('k', { mod: true })], [key('/')]],
  },
  help: { group: 'general', bindings: [[key('?')]] },
  details: { group: 'general', bindings: [[key('i')]] },

  goDrive: go('d'),
  goRecent: go('r'),
  goShared: go('s'),
  goTrash: go('t'),
  goSettings: go(','),
  parentFolder: { group: 'navigation', bindings: [[key('Backspace')]] },

  moveSelection: {
    group: 'selection',
    bindings: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(
      (arrow) => [key(arrow)],
    ),
  },
  extendSelection: {
    group: 'selection',
    bindings: ['ArrowUp', 'ArrowDown'].map((arrow) => [
      key(arrow, { shift: true }),
    ]),
  },
  toggleSelection: {
    group: 'selection',
    bindings: [[key(' ', { mod: true })]],
  },
  selectAll: { group: 'selection', bindings: [[key('a', { mod: true })]] },
  clearSelection: { group: 'selection', bindings: [[key('Escape')]] },

  open: { group: 'items', bindings: [[key('Enter')]] },
  openInNewTab: {
    group: 'items',
    bindings: [[key('Enter', { mod: true })]],
  },
  rename: { group: 'items', bindings: [[key('F2')]] },
  trash: { group: 'items', bindings: [[key('Delete')]] },
  share: { group: 'items', bindings: [[key('s')]] },
  download: { group: 'items', bindings: [[key('d')]] },
  newFolder: { group: 'items', bindings: [[key('n', { shift: true })]] },
  upload: { group: 'items', bindings: [[key('u')]] },
  uploadFolder: { group: 'items', bindings: [[key('u', { shift: true })]] },
  toggleView: { group: 'items', bindings: [[key('v')]] },

  previousFile: { group: 'viewer', bindings: [[key('ArrowLeft')]] },
  nextFile: { group: 'viewer', bindings: [[key('ArrowRight')]] },
  viewerDownload: { group: 'viewer', bindings: [[key('d')]] },
  closeViewer: { group: 'viewer', bindings: [[key('Escape')]] },
} as const satisfies Record<string, Definition>;

export type ShortcutId = keyof typeof SHORTCUTS;

export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];
