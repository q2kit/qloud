import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/settings/use-me';
import { formatDate } from '@/features/drive/format';
import { uuidFromUrl, compactId } from '@/features/drive/paths';
import { ApiError } from '@/lib/api/errors';
import {
  actions,
  useReport,
  useReports,
  useResolveReport,
  type ReportAction,
  type ReportStatus,
  type ReportDetail,
} from './api';

export function ModerationPage() {
  const { t } = useTranslation();
  const me = useMe();
  if (me.isError) return <p role="alert">{t('report.errors.failed')}</p>;
  if (!me.data) return <p role="status">{t('sharing.loading')}</p>;
  if (!me.data.is_superuser)
    return <p role="alert">{t('moderation.denied')}</p>;
  return <ModerationBrowser />;
}
function ModerationBrowser() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = React.useState<ReportStatus | undefined>('open');
  const selected = params.get('report');
  const id = selected ? uuidFromUrl(selected) : undefined;
  const list = useReports(status, true);
  const detail = useReport(id, true);
  return (
    <section className="space-y-5">
      <h1 className="text-xl font-semibold">{t('navigation.moderation')}</h1>
      <label className="block text-sm">
        {t('moderation.status')}
        <select
          className="ml-2 h-10 rounded-md border border-input bg-background px-3"
          value={status ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            setStatus(
              value === 'open' || value === 'actioned' || value === 'dismissed'
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
      {list.isPending ? (
        <p role="status">{t('sharing.loading')}</p>
      ) : list.isError ? (
        <div>
          <p role="alert">{t('report.errors.failed')}</p>
          <Button onClick={() => void list.refetch()}>
            {t('preview.retry')}
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.data.pages
            .flatMap((page) => page.results)
            .map((report) => (
              <li key={report.id}>
                <button
                  className="w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-muted"
                  aria-pressed={id === report.id}
                  onClick={() => {
                    setParams({ report: compactId(report.id) });
                  }}
                >
                  <span className="block break-words font-medium">
                    {report.node_name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t(`report.reasons.${report.reason}`)} ·{' '}
                    {t(`moderation.statuses.${report.status}`)} ·{' '}
                    {formatDate(report.created_at, i18n.language)}
                  </span>
                </button>
              </li>
            ))}
          {!list.data.pages.some((page) => page.results.length) && (
            <li>{t('moderation.empty')}</li>
          )}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="outline"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('sharing.more')}
        </Button>
      )}
      {selected &&
        (detail.isPending ? (
          <p role="status">{t('sharing.loading')}</p>
        ) : detail.isError ? (
          <div>
            <p role="alert">{t('report.errors.failed')}</p>
            <Button onClick={() => void detail.refetch()}>
              {t('preview.retry')}
            </Button>
          </div>
        ) : (
          <ReportPanel key={detail.data.id} report={detail.data} />
        ))}
    </section>
  );
}
function ReportPanel({ report }: { report: ReportDetail }) {
  const { t, i18n } = useTranslation();
  const change = useResolveReport(report.id);
  const [action, setAction] = React.useState<ReportAction>('revoke_link');
  const [note, setNote] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const error =
    change.error instanceof ApiError
      ? t(
          `moderation.errors.${change.error.code === 'report_resolved' ? 'resolved' : change.error.code === 'moderation_target_unavailable' ? 'unavailable' : change.error.code === 'validation_error' ? 'guard' : 'failed'}`,
        )
      : t('report.errors.failed');
  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="break-words text-lg font-semibold">{report.node_name}</h2>
      <p>
        {t(`report.reasons.${report.reason}`)} ·{' '}
        {t(`moderation.statuses.${report.status}`)}
      </p>
      <p className="break-words whitespace-pre-wrap">{report.message}</p>
      <dl className="space-y-2 break-all text-sm">
        {(
          [
            'reporter_email',
            'reporter_user_id',
            'owner_uuid',
            'node_uuid',
            'link_uuid',
          ] as const
        ).map((key) => (
          <div key={key}>
            <dt className="text-muted-foreground">
              {t(`moderation.fields.${key}`)}
            </dt>
            <dd>
              {report[key] === ''
                ? t('moderation.anonymous')
                : (report[key] ?? t('moderation.anonymous'))}
            </dd>
          </div>
        ))}
      </dl>
      {report.resolution && (
        <section
          aria-label={t('moderation.audit')}
          className="space-y-2 border-t border-border pt-3"
        >
          <h3 className="font-medium">{t('moderation.audit')}</h3>
          <p>
            {t(`moderation.actions.${report.resolution.action}`)} ·{' '}
            {formatDate(report.resolution.created_at, i18n.language)}
          </p>
          <p className="break-all">{report.resolution.actor_uuid}</p>
          <p className="break-words whitespace-pre-wrap">
            {report.resolution.note}
          </p>
        </section>
      )}
      {report.status === 'open' && (
        <form
          className="space-y-3 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            setConfirm(true);
          }}
        >
          <label className="block text-sm">
            {t('moderation.action')}
            <select
              disabled={change.isPending || confirm}
              value={action}
              onChange={(event) => {
                const value = actions.find(
                  (item) => item === event.target.value,
                );
                if (value) setAction(value);
              }}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
            >
              {actions.map((item) => (
                <option key={item} value={item}>
                  {t(`moderation.actions.${item}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            {t(`moderation.effects.${action}`)}
          </p>
          <label className="block text-sm">
            {t('moderation.note')}
            <textarea
              required
              maxLength={2000}
              value={note}
              disabled={change.isPending || confirm}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-3"
            />
          </label>
          {change.isError && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {confirm ? (
            <div className="space-y-2">
              <p>
                {t('moderation.confirm', {
                  action: t(`moderation.actions.${action}`),
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={change.isPending}
                  onClick={() => {
                    change.mutate(
                      { action, note: note.trim() },
                      {
                        onError: () => {
                          setConfirm(false);
                        },
                      },
                    );
                  }}
                >
                  {t(
                    change.isPending
                      ? 'moderation.processing'
                      : 'moderation.confirmButton',
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={change.isPending}
                  onClick={() => {
                    setConfirm(false);
                  }}
                >
                  {t('moderation.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button disabled={!note.trim()}>{t('moderation.review')}</Button>
          )}
        </form>
      )}
    </article>
  );
}
