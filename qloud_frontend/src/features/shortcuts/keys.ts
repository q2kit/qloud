import {
  SHORTCUTS,
  type Binding,
  type Combo,
  type ShortcutId,
} from './definitions';

export function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

const isLetter = (key: string) => /^[a-z]$/i.test(key);

/**
 * Whether `event` is the press `combo`, by `event.key` so non-QWERTY layouts work.
 * Shift is implied by symbols like `?`, so it is only compared for letters and
 * named keys.
 */
export function matchesCombo(event: KeyboardEvent, combo: Combo): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (mod !== Boolean(combo.mod) || event.altKey !== Boolean(combo.alt))
    return false;
  if (isLetter(combo.key))
    return (
      event.key.toLowerCase() === combo.key &&
      event.shiftKey === Boolean(combo.shift)
    );
  if (event.key !== combo.key) return false;
  return combo.key.length === 1 || event.shiftKey === Boolean(combo.shift);
}

/** For handlers on an element (Enter, F2, arrows): a one-press binding of `id`. */
export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  const bindings: readonly Binding[] = SHORTCUTS[id].bindings;
  return bindings.some(
    ([combo, ...rest]) =>
      combo !== undefined && rest.length === 0 && matchesCombo(event, combo),
  );
}

const NAMES: Record<string, { mac: string; other: string }> = {
  ArrowUp: { mac: '↑', other: '↑' },
  ArrowDown: { mac: '↓', other: '↓' },
  ArrowLeft: { mac: '←', other: '←' },
  ArrowRight: { mac: '→', other: '→' },
  Enter: { mac: '↵', other: '↵' },
  Escape: { mac: 'Esc', other: 'Esc' },
  Backspace: { mac: '⌫', other: 'Backspace' },
  Delete: { mac: '⌦', other: 'Del' },
  ' ': { mac: 'Space', other: 'Space' },
};

/** The keys of one press, for <kbd>: ["⌘", "K"] on a Mac, ["Ctrl", "K"] elsewhere. */
export function comboKeys(combo: Combo, mac = isMac()): string[] {
  const keys: string[] = [];
  if (combo.mod) keys.push(mac ? '⌘' : 'Ctrl');
  if (combo.alt) keys.push(mac ? '⌥' : 'Alt');
  if (combo.shift) keys.push(mac ? '⇧' : 'Shift');
  const name = NAMES[combo.key];
  keys.push(name ? name[mac ? 'mac' : 'other'] : combo.key.toUpperCase());
  return keys;
}

/** A compact label for menus: "⌘K" / "Ctrl+K", "G D" for a sequence. */
export function shortcutLabel(id: ShortcutId, mac = isMac()): string {
  const [binding] = SHORTCUTS[id].bindings;
  return binding
    .map((combo) => comboKeys(combo, mac).join(mac ? '' : '+'))
    .join(' ');
}

const ARIA_NAMES: Record<string, string> = { ' ': 'Space' };

/**
 * `aria-keyshortcuts` for the one-press bindings of `id` (ARIA has no syntax for
 * sequences). `mod` lists both Control and Meta.
 */
export function ariaKeyshortcuts(id: ShortcutId): string | undefined {
  const bindings: readonly Binding[] = SHORTCUTS[id].bindings;
  const values = bindings
    .flatMap(([combo, ...rest]) =>
      combo !== undefined && rest.length === 0 ? [combo] : [],
    )
    .flatMap((combo) => {
      const name = isLetter(combo.key)
        ? combo.key.toUpperCase()
        : (ARIA_NAMES[combo.key] ?? combo.key);
      const rest = [combo.alt && 'Alt', combo.shift && 'Shift', name].filter(
        Boolean,
      );
      return combo.mod
        ? [['Control', ...rest].join('+'), ['Meta', ...rest].join('+')]
        : [rest.join('+')];
    });
  return values.length ? values.join(' ') : undefined;
}
