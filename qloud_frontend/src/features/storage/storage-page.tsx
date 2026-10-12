import { ArrowLeft, FolderOpen, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { NodeIcon } from '@/features/drive/components/node-icon';
import { formatBytes } from '@/features/drive/format';
import { folderPath } from '@/features/drive/paths';
import { useTrashNodes } from '@/features/trash/api';
import { cn } from '@/lib/utils';
import {
  storageLevel,
  useLargestFiles,
  useStorage,
  type StorageUsage,
} from './api';
import { StorageFullBanner } from './storage-banner';
import { StorageBreakdown } from './storage-breakdown';
import { barWidth, LEVEL_BAR, LEVEL_TEXT } from './levels';

function Card({
  title,
  action,
  children,
}: React.PropsWithChildren<{
  title: string;
  action?: React.ReactNode;
}>): React.JSX.Element {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Whole percent, never rounded up to look full, and "< 1" for a little use. */
function percentLabel(percent: number, locale: string): string {
  const format = new Intl.NumberFormat(locale);
  if (percent > 0 && percent < 1) return `< ${format.format(1)}`;
  return format.format(Math.floor(percent));
}

function Overview({ usage }: { usage: StorageUsage }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const level = storageLevel(usage);
  const bytes = (value: number) => formatBytes(value, i18n.language);
  const percent =
    usage.quota_bytes > 0 ? (usage.used_bytes / usage.quota_bytes) * 100 : 100;
  const summary = t('storage.summary', {
    used: bytes(usage.used_bytes),
    quota: bytes(usage.quota_bytes),
  });
  return (
    <Card title={t('storage.overview')}>
      <p className="text-2xl font-semibold tracking-tight">{summary}</p>
      <div
        role="progressbar"
        aria-label={t('storage.used')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(percent, 100))}
        aria-valuetext={summary}
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-accent"
      >
        <div
          className={cn('h-full rounded-full', LEVEL_BAR[level])}
          style={{ width: barWidth(percent) }}
        />
      </div>
      <p className={cn('mt-2 text-sm', LEVEL_TEXT[level])}>
        {t(`storage.level.${level}`, {
          percent: percentLabel(percent, i18n.language),
        })}
      </p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('storage.reserved')}</dt>
          <dd className="font-medium">{bytes(usage.reserved_bytes)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('storage.maxFileSize')}</dt>
          <dd className="font-medium">{bytes(usage.max_file_size_bytes)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function LargestFiles(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const files = useLargestFiles();
  const trash = useTrashNodes();
  const items = files.data?.pages.flatMap((page) => page.results) ?? [];
  let content: React.ReactNode;
  if (files.isPending)
    content = (
      <div
        role="status"
        aria-label={t('storage.loading')}
        className="space-y-2"
      >
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-12 animate-pulse rounded-md bg-secondary"
          />
        ))}
      </div>
    );
  else if (files.isError)
    content = (
      <div role="alert" className="text-sm">
        <p>{t('storage.largestFailed')}</p>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => void files.refetch()}
        >
          {t('storage.retry')}
        </Button>
      </div>
    );
  else if (items.length === 0)
    content = (
      <p className="text-sm text-muted-foreground">{t('storage.noFiles')}</p>
    );
  else
    content = (
      <>
        {trash.isError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {t('storage.trashFailed')}
          </p>
        )}
        <ol className="divide-y divide-border">
          {items.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
            >
              <NodeIcon node={file} className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {file.name}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatBytes(file.size, i18n.language)}
              </span>
              <span className="-ml-2 flex w-full flex-wrap gap-1 sm:ml-0 sm:w-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('storage.openFolderLabel', { name: file.name })}
                  onClick={() =>
                    void navigate(
                      folderPath(file.parent_id ?? undefined, file.id),
                    )
                  }
                >
                  <FolderOpen aria-hidden="true" />
                  {t('storage.openFolder')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={trash.isPending}
                  aria-label={t('storage.trashLabel', { name: file.name })}
                  onClick={() => {
                    trash.mutate([file.id]);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  {t('storage.trash')}
                </Button>
              </span>
            </li>
          ))}
        </ol>
        {files.hasNextPage && (
          <Button
            variant="outline"
            className="mt-3 w-full"
            disabled={files.isFetchingNextPage}
            onClick={() => void files.fetchNextPage()}
          >
            {t(files.isFetchingNextPage ? 'storage.loading' : 'storage.more')}
          </Button>
        )}
      </>
    );
  return <Card title={t('storage.largest')}>{content}</Card>;
}

/** S-14 (ui-ux.md): where the quota goes and what can be cleaned up. */
export function StoragePage(): React.JSX.Element {
  const { t } = useTranslation();
  const storage = useStorage();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link
        to="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('navigation.settings')}
      </Link>
      <StorageFullBanner showLink={false} />
      {storage.isPending ? (
        <div
          role="status"
          aria-label={t('storage.loading')}
          className="h-48 animate-pulse rounded-lg bg-secondary"
        />
      ) : storage.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-border p-5 text-sm"
        >
          <p>{t('storage.failed')}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void storage.refetch()}
          >
            {t('storage.retry')}
          </Button>
        </div>
      ) : (
        <>
          <Overview usage={storage.data} />
          <StorageBreakdown usage={storage.data} />
        </>
      )}
      <LargestFiles />
    </div>
  );
}
