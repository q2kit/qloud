import * as React from 'react';
import { useNavigate } from 'react-router';

import { ShortcutContext, useShortcut } from './context';
import { ShortcutDispatcher } from './dispatcher';
import { ShortcutsDialog, SHORTCUTS_DIALOG_SELECTOR } from './shortcuts-dialog';

function AppShortcuts({
  helpOpen,
  setHelpOpen,
}: {
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  useShortcut(
    'help',
    () => {
      setHelpOpen(!helpOpen);
    },
    { within: SHORTCUTS_DIALOG_SELECTOR },
  );
  useShortcut('goDrive', () => void navigate('/drive'));
  useShortcut('goRecent', () => void navigate('/recent'));
  useShortcut('goShared', () => void navigate('/shared'));
  useShortcut('goTrash', () => void navigate('/trash'));
  useShortcut('goSettings', () => void navigate('/settings'));
  return <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />;
}

/** Shortcuts for the signed-in shell: one key listener, the `?` dialog, G-sequences. */
export function ShortcutProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const [dispatcher] = React.useState(() => new ShortcutDispatcher());
  const [helpOpen, setHelpOpen] = React.useState(false);
  React.useEffect(() => {
    window.addEventListener('keydown', dispatcher.handle);
    return () => {
      window.removeEventListener('keydown', dispatcher.handle);
    };
  }, [dispatcher]);
  const value = React.useMemo(
    () => ({
      dispatcher,
      openHelp: () => {
        setHelpOpen(true);
      },
    }),
    [dispatcher],
  );
  return (
    <ShortcutContext.Provider value={value}>
      {children}
      <AppShortcuts helpOpen={helpOpen} setHelpOpen={setHelpOpen} />
    </ShortcutContext.Provider>
  );
}
