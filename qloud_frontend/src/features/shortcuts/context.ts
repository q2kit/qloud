import * as React from 'react';

import type { ShortcutId } from './definitions';
import type { ShortcutDispatcher, ShortcutOptions } from './dispatcher';

export interface ShortcutContextValue {
  dispatcher: ShortcutDispatcher;
  openHelp: () => void;
}

/** Only the signed-in shell provides it; elsewhere (public links) shortcuts are off. */
export const ShortcutContext = React.createContext<ShortcutContextValue | null>(
  null,
);

/** Run `handler` on shortcut `id` while mounted and enabled. */
export function useShortcut(
  id: ShortcutId,
  handler: (event: KeyboardEvent) => void,
  { enabled = true, allowInInput = false, within }: ShortcutOptions = {},
): void {
  const context = React.useContext(ShortcutContext);
  const latest = React.useRef(handler);
  React.useLayoutEffect(() => {
    latest.current = handler;
  });
  React.useEffect(() => {
    if (!context) return;
    return context.dispatcher.register({
      id,
      run: (event) => {
        latest.current(event);
      },
      options: { enabled, allowInInput, within },
    });
  }, [context, id, enabled, allowInInput, within]);
}

/** Opens the `?` dialog, for the command palette. */
export function useShortcutHelp(): (() => void) | undefined {
  return React.useContext(ShortcutContext)?.openHelp;
}
