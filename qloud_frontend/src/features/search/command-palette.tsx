import * as Dialog from '@radix-ui/react-dialog';
import { Search, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { nodeUrl } from '@/features/drive/paths';
import { NodeIcon } from '@/features/drive/components/node-icon';
import { cn } from '@/lib/utils';

import { useSearchSuggestions } from './api';

interface Props {
  canCreate: boolean;
  /** False also while the storage is full (quota.md). */
  canUpload: boolean;
  onCreateFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
}

export function CommandPalette(props: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const result = useSearchSuggestions(query, open);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    setQuery('');
    setActive(0);
  };
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k' &&
        !event.altKey &&
        !event.repeat
      ) {
        if (
          !open &&
          document.querySelector('[role="dialog"], [role="alertdialog"]')
        )
          return;
        event.preventDefault();
        if (!open && document.activeElement instanceof HTMLElement)
          triggerRef.current = document.activeElement;
        setOpen((current) => !current);
        setQuery('');
        setActive(0);
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const closeAndRun = (run: () => void) => {
    changeOpen(false);
    run();
  };
  const all = () => {
    void navigate(`/search?${new URLSearchParams({ q: query.trim() })}`);
  };
  const actions = query.trim()
    ? [
        ...result.nodes.map((node) => ({
          id: node.id,
          label: node.name,
          node,
          run: () => {
            void navigate(new URL(nodeUrl(node)).pathname);
          },
        })),
        { id: 'all', label: t('search.viewAll'), run: all, node: undefined },
      ]
    : [
        ...['drive', 'recent', 'shared', 'trash', 'settings'].map((path) => ({
          id: path,
          label: t(`navigation.${path}`),
          run: () => {
            void navigate(`/${path}`);
          },
          node: undefined,
        })),
        ...(props.canCreate
          ? [
              {
                id: 'create',
                label: t('drive.actions.newFolder'),
                run: props.onCreateFolder,
                node: undefined,
              },
            ]
          : []),
        ...(props.canUpload
          ? [
              {
                id: 'files',
                label: t('drive.actions.upload'),
                run: props.onUploadFiles,
                node: undefined,
              },
              {
                id: 'folder',
                label: t('upload.actions.folder'),
                run: props.onUploadFolder,
                node: undefined,
              },
            ]
          : []),
      ];
  const index = Math.min(active, Math.max(actions.length - 1, 0));
  const shortcut = t('shell.searchShortcut', {
    modifier: /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
      ? '⌘'
      : t('shell.keys.ctrl'),
  });
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Button
        className="hidden min-w-48 justify-between text-muted-foreground md:flex"
        variant="outline"
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          changeOpen(true);
        }}
      >
        <span className="flex items-center gap-2">
          <Search />
          {t('shell.search')}
        </span>
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px]">
          {shortcut}
        </kbd>
      </Button>
      <Button
        className="md:hidden"
        variant="ghost"
        size="icon"
        aria-label={t('shell.search')}
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          changeOpen(true);
        }}
      >
        <Search />
      </Button>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          className="fixed top-16 left-1/2 z-50 flex max-h-[calc(100dvh-6rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-soft outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="font-semibold">
              {t('search.paletteTitle')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('search.close')}
              >
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            {t('search.paletteDescription')}
          </Dialog.Description>
          <input
            ref={inputRef}
            role="combobox"
            aria-label={t('search.query')}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="search-options"
            aria-activedescendant={`search-option-${actions[index]?.id ?? ''}`}
            maxLength={255}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={query}
            placeholder={t('search.placeholder')}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActive(
                  (index +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    actions.length) %
                    actions.length,
                );
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const action = actions[index];
                if (action) closeAndRun(action.run);
              }
            }}
          />
          {query.trim() && (result.waiting || result.isFetching) && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('search.loading')}
            </p>
          )}
          {query.trim() && result.isError && (
            <div role="alert" className="text-sm text-destructive">
              {t('search.failed')}
              <Button variant="ghost" onClick={() => void result.refetch()}>
                {t('search.retry')}
              </Button>
            </div>
          )}
          {query.trim() &&
            !result.waiting &&
            result.isSuccess &&
            !result.nodes.length && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('search.empty')}
              </p>
            )}
          <div
            id="search-options"
            role="listbox"
            aria-label={t('search.suggestions')}
            className="min-h-0 overflow-y-auto"
          >
            {actions.map((action, i) => (
              <button
                key={action.id}
                id={`search-option-${action.id}`}
                role="option"
                aria-selected={index === i}
                type="button"
                tabIndex={-1}
                ref={(element) => {
                  if (index === i)
                    element?.scrollIntoView({ block: 'nearest' });
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm focus:ring-2 focus:ring-ring',
                  index === i && 'bg-accent text-accent-foreground',
                )}
                onPointerMove={() => {
                  setActive(i);
                }}
                onClick={() => {
                  closeAndRun(action.run);
                }}
              >
                {action.node && (
                  <NodeIcon node={action.node} className="size-5 shrink-0" />
                )}
                <span className="min-w-0 truncate">{action.label}</span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
