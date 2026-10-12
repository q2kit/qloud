import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/features/auth/components/form-field';
import type { NodeAction } from '@/features/drive/actions';
import type { DriveNode } from '@/features/drive/api';
import { FileBrowser } from '@/features/drive/components/file-browser';
import { CenteredState } from '@/features/drive/components/browser-states';
import { useDrivePreferences } from '@/features/drive/preferences';
import { useDriveStore } from '@/features/drive/store';
import { useTrash, useRestoreTrash, useDeleteTrash } from './api';
import { DeleteDialog } from './delete-dialog';

export function TrashPage(): React.JSX.Element {
  const { t } = useTranslation();
  const preferences = useDrivePreferences();
  const list = useTrash(preferences.ordering);
  const restore = useRestoreTrash();
  const remove = useDeleteTrash();
  const store = useDriveStore();
  const { select, selected, setDetailOpen } = store;
  const [confirm, setConfirm] = React.useState<{ ids: string[] | null } | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const nodes = React.useMemo(
    () => list.data?.pages.flatMap((page) => page.results) ?? [],
    [list.data],
  );
  React.useEffect(() => {
    select(null);
    setDetailOpen(false);
    return () => {
      select(null);
    };
  }, [select, setDetailOpen]);
  const busy = restore.isPending || remove.isPending;
  const actionsFor = (): NodeAction[] => {
    const chosen = useDriveStore.getState().selected;
    if (!chosen.length || busy) return [];
    const ids = chosen.map((node) => node.id);
    const valid = (): boolean => {
      setError(ids.length > 1000 ? t('trash.tooMany') : null);
      return ids.length <= 1000;
    };
    return [
      {
        key: 'restore',
        label: t('trash.restore'),
        icon: RotateCcw,
        run: () => {
          if (valid())
            restore.mutate(ids, {
              onSuccess: () => {
                select(null);
              },
              onError: () => {
                setError(t('trash.actionFailed'));
              },
            });
        },
      },
      {
        key: 'delete',
        label: t('trash.delete'),
        icon: Trash2,
        run: () => {
          if (valid()) {
            remove.reset();
            setConfirm({ ids });
          }
        },
      },
    ];
  };
  const choose = (node: DriveNode): void => {
    select(node);
  };
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t('navigation.trash')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('trash.description')}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy || !nodes.length}
          onClick={() => {
            remove.reset();
            setConfirm({ ids: null });
          }}
        >
          <Trash2 />
          {t('trash.empty')}
        </Button>
      </div>
      <FileBrowser
        nodes={nodes}
        selected={selected}
        view={preferences.view}
        onView={preferences.setView}
        ordering={preferences.ordering}
        onOrdering={preferences.setOrdering}
        actionsFor={actionsFor}
        onClearSelection={() => {
          select(null);
        }}
        onSelectAll={store.selectAll}
        onSelect={(node, { range, toggle }) => {
          if (range) store.selectRange(nodes, node);
          else if (toggle) store.toggle(node);
          else select(node);
        }}
        onOpen={choose}
        draggable={false}
        enabled={list.isSuccess && !busy}
        loadingLabel={t('trash.loading')}
        errorTitle={t('trash.loadFailed')}
        pending={list.isPending}
        failed={list.isError}
        onRetry={() => void list.refetch()}
        feedback={error && <FormAlert>{error}</FormAlert>}
        hasMore={list.hasNextPage}
        isLoadingMore={list.isFetchingNextPage}
        onLoadMore={() => {
          if (!list.isFetchingNextPage) void list.fetchNextPage();
        }}
        emptyState={
          <CenteredState
            icon={<Trash2 className="size-6 text-primary" aria-hidden="true" />}
            title={t('trash.emptyState')}
            description={t('trash.emptyDescription')}
          />
        }
      />
      <DeleteDialog
        open={confirm !== null}
        empty={confirm?.ids === null}
        pending={remove.isPending}
        failed={remove.isError}
        onClose={() => {
          setConfirm(null);
        }}
        onConfirm={() => {
          if (!confirm) return;
          remove.mutate(confirm.ids, {
            onSuccess: () => {
              setConfirm(null);
              select(null);
            },
          });
        }}
      />
    </section>
  );
}
