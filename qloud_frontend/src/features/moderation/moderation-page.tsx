import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { NotFoundPage } from '@/app/pages';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/settings/use-me';
import { ArrowLeft, FileWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/features/drive/format';
import { uuidFromUrl, compactId } from '@/features/drive/paths';
import { useReport, useReports, type ReportStatus } from './api';
import { StatusBadge } from './moderation-status';
import { ReportPanel } from './moderation-detail';

export function ModerationPage() {
  const { t } = useTranslation();
  const me = useMe();
  if (me.isError) return <p role="alert">{t('report.errors.failed')}</p>;
  if (!me.data) return <p role="status">{t('sharing.loading')}</p>;
  if (!me.data.is_superuser) return <NotFoundPage />;
  return <ModerationBrowser />;
}
function ModerationBrowser() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = React.useState<ReportStatus | undefined>('open');
  const selected = params.get('report');
  const id = selected ? uuidFromUrl(selected) : undefined;
  const scopedNode = params.get('node');
  const nodeId = scopedNode ? uuidFromUrl(scopedNode) : undefined;
  const list = useReports(status, true, nodeId);
  const detail = useReport(id, true);
  const closeDetail = () => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('report');
      return next;
    });
  };
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t('navigation.moderation')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('moderation.introduction')}
        </p>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)]">
        <section
          aria-label={t('moderation.queue')}
          className={cn('min-w-0 space-y-3', selected && 'hidden lg:block')}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t('moderation.queue')}</h2>
            <label className="flex items-center gap-2 text-sm">
              {t('moderation.status')}
              <select
                className="h-9 rounded-md border border-input bg-background px-2"
                value={status ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setStatus(
                    value === 'open' ||
                      value === 'actioned' ||
                      value === 'dismissed'
                      ? value
                      : undefined,
                  );
                }}
              >
                <option value="">{t('moderation.all')}</option>
                {(['open', 'actioned', 'dismissed'] as const).map((item) => (
                  <option key={item} value={item}>
                    {t(`moderation.statuses.${item}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {nodeId && (
            <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
              <p>{t('moderation.nodeFilter')}</p>
              <p className="break-all font-mono text-xs">{nodeId}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setParams((previous) => {
                    const next = new URLSearchParams(previous);
                    next.delete('node');
                    return next;
                  });
                }}
              >
                {t('moderation.clearFilter')}
              </Button>
            </div>
          )}
          {list.isPending ? (
            <p role="status">{t('sharing.loading')}</p>
          ) : list.isError ? (
            <div className="space-y-2">
              <p role="alert">{t('report.errors.failed')}</p>
              <Button onClick={() => void list.refetch()}>
                {t('preview.retry')}
              </Button>
            </div>
          ) : (
            <ul className="space-y-2 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
              {list.data.pages
                .flatMap((page) => page.results)
                .map((report) => (
                  <li key={report.id}>
                    <button
                      className={cn(
                        'w-full space-y-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                        id === report.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border',
                      )}
                      aria-pressed={id === report.id}
                      onClick={() => {
                        setParams((previous) => {
                          const next = new URLSearchParams(previous);
                          next.set('report', compactId(report.id));
                          return next;
                        });
                      }}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 break-words font-semibold">
                          {report.node_name}
                        </span>
                        <StatusBadge status={report.status} />
                      </span>
                      <span className="block text-sm">
                        {t(`report.reasons.${report.reason}`)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(report.created_at, i18n.language)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t('moderation.relatedCounts', {
                          total: report.node_report_count,
                          open: report.node_open_report_count,
                        })}
                      </span>
                    </button>
                  </li>
                ))}
              {!list.data.pages.some((page) => page.results.length) && (
                <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  {t('moderation.empty')}
                </li>
              )}
            </ul>
          )}
          {list.hasNextPage && (
            <Button
              variant="outline"
              className="w-full"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('sharing.more')}
            </Button>
          )}
        </section>
        <div
          className={cn('min-w-0 space-y-3', !selected && 'hidden lg:block')}
        >
          {selected ? (
            <>
              <Button
                variant="ghost"
                className="lg:hidden"
                onClick={closeDetail}
              >
                <ArrowLeft />
                {t('moderation.backToQueue')}
              </Button>
              {!id ? (
                <p role="alert">{t('report.errors.failed')}</p>
              ) : detail.isPending ? (
                <p role="status">{t('sharing.loading')}</p>
              ) : detail.isError ? (
                <div className="space-y-2">
                  <p role="alert">{t('report.errors.failed')}</p>
                  <Button onClick={() => void detail.refetch()}>
                    {t('preview.retry')}
                  </Button>
                </div>
              ) : (
                <ReportPanel
                  key={detail.data.id}
                  report={detail.data}
                  onRelated={() => {
                    setStatus(undefined);
                    setParams({ node: compactId(detail.data.node_uuid) });
                  }}
                />
              )}
            </>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
              <FileWarning className="size-8" />
              <p className="font-medium">{t('moderation.selectReport')}</p>
              <p className="max-w-sm text-sm">
                {t('moderation.selectReportDescription')}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
