import {
  SHORTCUTS,
  type Binding,
  type Combo,
  type ShortcutId,
} from './definitions';
import { matchesCombo } from './keys';

export interface ShortcutOptions {
  enabled?: boolean;
  /** Let a Ctrl/⌘ binding run from a text field (single keys never do). */
  allowInInput?: boolean;
  /** Overlays (dialog, menu…) that may be open, e.g. the one owning the shortcut. */
  within?: string;
}

interface Entry {
  id: ShortcutId;
  run: (event: KeyboardEvent) => void;
  options: ShortcutOptions;
}

/** How long the second key of a sequence ("G then D") may wait. */
export const SEQUENCE_TIMEOUT = 1000;

const TYPING =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** Typeahead belongs to these; the Drive list opts out with `data-shortcut-scope`. */
const TYPEAHEAD =
  '[role="menu"], [role="menuitem"], [role="listbox"]:not([data-shortcut-scope])';
const OVERLAYS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]:not([data-shortcut-scope])';

function blocked(
  event: KeyboardEvent,
  combo: { mod?: boolean },
  options: ShortcutOptions,
): boolean {
  if (event.repeat) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(TYPING) && !(combo.mod && options.allowInInput))
    return true;
  if (
    target?.closest(TYPEAHEAD) &&
    !(options.within && target.closest(options.within))
  )
    return true;
  const overlays = document.querySelectorAll(OVERLAYS);
  for (const overlay of overlays) {
    // Menus and listboxes nested in an allowed overlay belong to it.
    if (!options.within || !overlay.closest(options.within)) return true;
  }
  return false;
}

/** The press at `position` of a `length`-press binding of `id` that `event` matches. */
function pressOf(
  event: KeyboardEvent,
  id: ShortcutId,
  length: number,
  position: number,
): Combo | undefined {
  const bindings: readonly Binding[] = SHORTCUTS[id].bindings;
  for (const binding of bindings) {
    const combo = binding[position];
    if (binding.length === length && combo && matchesCombo(event, combo))
      return combo;
  }
  return undefined;
}

/** One window listener for every registered shortcut (features/shortcuts). */
export class ShortcutDispatcher {
  private entries: Entry[] = [];
  private pending: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  register(entry: Entry): () => void {
    this.entries.push(entry);
    return () => {
      this.entries = this.entries.filter((item) => item !== entry);
    };
  }

  handle = (event: KeyboardEvent): void => {
    // Safari marks the key that ends an IME composition only by keyCode 229.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const composing = event.isComposing || event.keyCode === 229;
    if (event.defaultPrevented || composing) return;
    const started = this.pending;
    this.pending = null;
    // Latest registration wins: the innermost screen owns a shared key.
    const entries = this.entries
      .filter((entry) => entry.options.enabled !== false)
      .reverse();
    const tryRun = (length: number, position: number): boolean => {
      for (const entry of entries) {
        const combo = pressOf(event, entry.id, length, position);
        if (combo && !blocked(event, combo, entry.options)) {
          event.preventDefault();
          entry.run(event);
          return true;
        }
      }
      return false;
    };

    // The second press of a sequence comes first: "G then D" is not "D".
    if (
      started !== null &&
      this.now() - started <= SEQUENCE_TIMEOUT &&
      tryRun(2, 1)
    )
      return;
    if (tryRun(1, 0)) return;
    const opensSequence = entries.some((entry) => {
      const combo = pressOf(event, entry.id, 2, 0);
      return combo !== undefined && !blocked(event, combo, entry.options);
    });
    if (opensSequence) this.pending = this.now();
  };
}
