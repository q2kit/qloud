import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  SHORTCUT_GROUPS,
  SHORTCUT_IDS,
  SHORTCUTS,
  type Binding,
} from './definitions';
import { comboKeys, isMac } from './keys';

export const SHORTCUTS_DIALOG_SELECTOR = '[data-shortcuts-dialog]';

function Keys({ binding, mac }: { binding: Binding; mac: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {binding.map((combo, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('shortcuts.then')}
            </span>
          )}
          {comboKeys(combo, mac).map((name) => (
            <Kbd key={name}>{name}</Kbd>
          ))}
        </React.Fragment>
      ))}
    </span>
  );
}

/** Arrow alternatives with the same modifiers read as one cluster: "Shift ↑ ↓". */
function arrowCluster(bindings: readonly Binding[]): Binding | null {
  const combos = bindings.map((binding) =>
    binding.length === 1 ? binding[0] : undefined,
  );
  const [first] = combos;
  if (
    bindings.length < 2 ||
    !first ||
    !combos.every(
      (combo) =>
        combo?.key.startsWith('Arrow') &&
        combo.mod === first.mod &&
        combo.shift === first.shift &&
        combo.alt === first.alt,
    )
  )
    return null;
  return combos.filter((combo) => combo !== undefined);
}

function ClusterKeys({ combos, mac }: { combos: Binding; mac: boolean }) {
  const names = combos.flatMap((combo, index) => {
    const keys = comboKeys(combo, mac);
    // Modifiers once, then every arrow.
    return index === 0 ? keys : keys.slice(-1);
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {names.map((name) => (
        <Kbd key={name}>{name}</Kbd>
      ))}
    </span>
  );
}

function Kbd({ children }: React.PropsWithChildren): React.JSX.Element {
  return (
    <kbd className="min-w-6 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-sans text-xs text-foreground shadow-[inset_0_-1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

/** The `?` sheet: every shortcut, generated from definitions.ts. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const mac = isMac();
  const listRef = React.useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          data-shortcuts-dialog=""
          onOpenAutoFocus={(event) => {
            // The list, not the close button: arrows and Page Down scroll it.
            event.preventDefault();
            listRef.current?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(40rem,calc(100dvh_-_2rem))] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-panel shadow-soft outline-none"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div>
              <Dialog.Title className="text-base font-semibold">
                {t('shortcuts.title')}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {t('shortcuts.description')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('shortcuts.close')}
              >
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <div
            ref={listRef}
            tabIndex={-1}
            className="grid gap-x-8 gap-y-6 overflow-y-auto p-5 outline-none md:grid-cols-2"
          >
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group} aria-labelledby={`shortcuts-${group}`}>
                <h3
                  id={`shortcuts-${group}`}
                  className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  {t(`shortcuts.groups.${group}`)}
                </h3>
                <dl className="divide-y divide-border">
                  {SHORTCUT_IDS.filter(
                    (id) => SHORTCUTS[id].group === group,
                  ).map((id) => {
                    const bindings: readonly Binding[] = SHORTCUTS[id].bindings;
                    const cluster = arrowCluster(bindings);
                    return (
                      <div
                        key={id}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <dt className="min-w-0">
                          {t(`shortcuts.actions.${id}`)}
                        </dt>
                        <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          {cluster ? (
                            <ClusterKeys combos={cluster} mac={mac} />
                          ) : (
                            bindings.map((binding, index) => (
                              <React.Fragment key={index}>
                                {index > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {t('shortcuts.or')}
                                  </span>
                                )}
                                <Keys binding={binding} mac={mac} />
                              </React.Fragment>
                            ))
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
