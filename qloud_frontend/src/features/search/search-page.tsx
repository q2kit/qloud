import { Download, Eye, FolderOpen, Info, Search } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import type { NodeAction } from '@/features/drive/actions';
import { downloadNode, type DriveNode } from '@/features/drive/api';
import { CenteredState } from '@/features/drive/components/browser-states';
import { FileBrowser } from '@/features/drive/components/file-browser';
import { nodeUrl } from '@/features/drive/paths';
import { useDrivePreferences } from '@/features/drive/preferences';
import { useDriveStore } from '@/features/drive/store';
import { FormAlert } from '@/features/auth/components/form-field';

import { SEARCH_TYPES, useSearchResults, type SearchFilters } from './api';

export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const owner = params.get('owner') ?? '';
  const after = params.get('modified_after') ?? '';
  const query = useSearchResults({
    q,
    ...(type ? { type: type as SearchFilters['type'] } : {}),
    ...(owner ? { owner: owner as SearchFilters['owner'] } : {}),
    ...(after ? { modified_after: after } : {}),
  });
  const { view, setView } = useDrivePreferences();
  const store = useDriveStore();
  const { select } = store;
  const [error, setError] = React.useState('');
  const nodes = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.results) ?? [],
    [query.data],
  );
  const scope = params.toString();
  React.useEffect(() => {
    select(null);
    return () => {
      select(null);
    };
  }, [select, scope]);
  const update = (field: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(field, value);
    else next.delete(field);
    setParams(next);
  };
  const open = (node: DriveNode) => {
    void navigate(new URL(nodeUrl(node)).pathname);
  };
  const actionsFor = (): NodeAction[] => {
    const selection = useDriveStore.getState().selected;
    const node = selection[0];
    if (!node || selection.length !== 1) return [];
    return [
      {
        key: 'open',
        label: t(
          node.kind === 'folder' ? 'drive.actions.open' : 'preview.open',
        ),
        icon: node.kind === 'folder' ? FolderOpen : Eye,
        run: () => {
          open(node);
        },
      },
      ...(node.kind === 'file'
        ? [
            {
              key: 'download',
              label: t('drive.actions.download'),
              icon: Download,
              run: () => {
                void downloadNode(node.id).catch(() => {
                  setError(t('drive.errors.downloadFailed'));
                });
              },
            },
          ]
        : []),
      {
        key: 'info',
        label: t('drive.actions.info'),
        icon: Info,
        run: () => {
          store.setDetailOpen(true);
        },
      },
    ];
  };
  const inputClass =
    'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring';
  const date = new Date(after);
  const dateValue =
    after && !Number.isNaN(date.getTime())
      ? `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      : '';
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('search.title')}</h1>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('q');
          update('q', typeof value === 'string' ? value.trim() : '');
        }}
      >
        <input
          key={q}
          name="q"
          defaultValue={q}
          aria-label={t('search.query')}
          maxLength={255}
          placeholder={t('search.placeholder')}
          className={inputClass}
        />
        <Button type="submit" aria-label={t('search.submit')}>
          <Search />
          <span className="hidden sm:inline">{t('search.submit')}</span>
        </Button>
      </form>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1 text-sm">
          <label htmlFor="search-type">{t('search.type')}</label>
          <select
            id="search-type"
            value={type}
            className={inputClass}
            onChange={(event) => {
              update('type', event.target.value);
            }}
          >
            <option value="">{t('search.allTypes')}</option>
            {SEARCH_TYPES.map((kind) => (
              <option value={kind} key={kind}>
                {t(`search.types.${kind}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="search-owner">{t('search.owner')}</label>
          <select
            id="search-owner"
            value={owner}
            className={inputClass}
            onChange={(event) => {
              update('owner', event.target.value);
            }}
          >
            <option value="">{t('search.allOwners')}</option>
            <option value="me">{t('search.mine')}</option>
            <option value="others">{t('search.others')}</option>
          </select>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="search-modifiedAfter">
            {t('search.modifiedAfter')}
          </label>
          <input
            type="date"
            id="search-modifiedAfter"
            value={dateValue}
            className={inputClass}
            onChange={(event) => {
              update(
                'modified_after',
                event.target.value
                  ? new Date(`${event.target.value}T00:00:00`).toISOString()
                  : '',
              );
            }}
          />
        </div>
      </div>
      <FileBrowser
        nodes={nodes}
        selected={store.selected}
        view={view}
        onView={setView}
        ordering="-updated_at"
        orderingLabel={t('search.relevance')}
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
        onOpen={open}
        onOpenInNewTab={(node) => {
          window.open(nodeUrl(node), '_blank', 'noopener');
        }}
        draggable={false}
        enabled={query.isSuccess}
        pending={Boolean(q.trim()) && query.isPending}
        failed={query.isError}
        onRetry={() => void query.refetch()}
        loadingLabel={t('search.loading')}
        errorTitle={t('search.failed')}
        feedback={error && <FormAlert>{error}</FormAlert>}
        hasMore={query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => {
          if (!query.isFetchingNextPage) void query.fetchNextPage();
        }}
        emptyState={
          <CenteredState
            icon={<Search className="size-6 text-primary" />}
            title={t(q.trim() ? 'search.empty' : 'search.start')}
            description={t(
              q.trim() ? 'search.emptyDescription' : 'search.placeholder',
            )}
          />
        }
      />
    </section>
  );
}
