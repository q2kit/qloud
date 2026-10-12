import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatBytes, formatDate } from '@/features/drive/format';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import {
  actions,
  useResolveReport,
  type ReportAction,
  type ReportDetail,
} from './api';
import { StatusBadge } from './moderation-status';

function Metadata({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}
function SubjectNode({
  node,
  uuid,
  title,
}: {
  node: ReportDetail['subject']['node'];
  uuid: string;
  title: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <h4 className="mb-3 text-sm font-medium">{title}</h4>
      <dl className="space-y-3">
        <Metadata label={t('moderation.name')}>
          {node?.name ?? t('moderation.deleted')}
        </Metadata>
        {node && (
          <Metadata label={t('moderation.fileInfo')}>
            {t(`moderation.kinds.${node.kind}`)}
            {node.kind === 'file' &&
              ` · ${formatBytes(node.size, i18n.language)} · ${node.mime_type ?? t('moderation.anonymous')}`}
          </Metadata>
        )}
        <Metadata label={t('moderation.currentState')}>
          {!node
            ? t('moderation.deleted')
            : t(
                node.trashed_at ? 'moderation.trashed' : 'moderation.available',
              )}
        </Metadata>
        <Metadata label={t('moderation.identifier')}>
          <span className="font-mono text-xs">{uuid}</span>
        </Metadata>
      </dl>
    </div>
  );
}
export function ReportPanel({
  report,
  onRelated,
}: {
  report: ReportDetail;
  onRelated: () => void;
}) {
  const { t, i18n } = useTranslation();
  const change = useResolveReport(report.id);
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
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
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="space-y-3 border-b border-border p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2
            ref={heading}
            tabIndex={-1}
            className="min-w-0 break-words text-xl font-semibold outline-none"
          >
            {report.node_name}
          </h2>
          <StatusBadge status={report.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('moderation.receivedAt', {
            time: formatDate(report.created_at, i18n.language),
          })}
        </p>
        <dl>
          <Metadata label={t('moderation.reportId')}>
            <span className="font-mono text-xs">{report.id}</span>
          </Metadata>
        </dl>
      </header>
      <div className="space-y-6 p-4 sm:p-5">
        <section
          className="space-y-3"
          aria-label={t('moderation.reportContent')}
        >
          <h3 className="font-semibold">{t('moderation.reportContent')}</h3>
          <p className="inline-block rounded-md bg-muted px-2.5 py-1 text-sm">
            {t(`report.reasons.${report.reason}`)}
          </p>
          <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
            {report.message || t('moderation.noMessage')}
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Metadata label={t('moderation.fields.reporter_email')}>
              {report.reporter_email || t('moderation.anonymous')}
            </Metadata>
            <Metadata label={t('moderation.fields.reporter_user_id')}>
              {report.reporter_user_id ?? t('moderation.anonymous')}
            </Metadata>
          </dl>
        </section>
        <section
          className="space-y-3 border-t border-border pt-5"
          aria-label={t('moderation.subject')}
        >
          <h3 className="font-semibold">{t('moderation.subject')}</h3>
          <div
            className={cn(
              'grid gap-3',
              report.node_uuid !== report.root_node_uuid && 'xl:grid-cols-2',
            )}
          >
            <SubjectNode
              node={report.subject.node}
              uuid={report.node_uuid}
              title={t('moderation.fields.node_uuid')}
            />
            {report.node_uuid !== report.root_node_uuid ? (
              <SubjectNode
                node={report.subject.root_node}
                uuid={report.root_node_uuid}
                title={t('moderation.rootNode')}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('moderation.sameRoot')}
              </p>
            )}
          </div>
          <dl className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-2">
            <Metadata label={t('moderation.fields.owner_uuid')}>
              {report.subject.owner ? (
                <>
                  <span className="block font-medium">
                    {report.subject.owner.display_name ||
                      report.subject.owner.email}
                  </span>
                  {report.subject.owner.display_name && (
                    <span className="block">{report.subject.owner.email}</span>
                  )}
                  <span className="block text-muted-foreground">
                    {t(
                      report.subject.owner.suspended_at
                        ? 'moderation.ownerSuspended'
                        : report.subject.owner.is_active
                          ? 'moderation.ownerActive'
                          : 'moderation.ownerInactive',
                    )}
                  </span>
                </>
              ) : (
                t('moderation.deleted')
              )}
            </Metadata>
            <Metadata label={t('moderation.ownerId')}>
              <span className="font-mono text-xs">{report.owner_uuid}</span>
            </Metadata>
            <Metadata label={t('moderation.linkState')}>
              {t(`moderation.linkStates.${report.subject.link_state}`)}
              {report.subject.link_revoke_reason && (
                <span className="block text-xs text-muted-foreground">
                  {t(
                    `moderation.revokeReasons.${report.subject.link_revoke_reason}`,
                  )}
                </span>
              )}
            </Metadata>
            <Metadata label={t('moderation.fields.link_uuid')}>
              <span className="font-mono text-xs">{report.link_uuid}</span>
            </Metadata>
            {report.subject.link_expires_at && (
              <Metadata label={t('moderation.expiresAt')}>
                {formatDate(report.subject.link_expires_at, i18n.language)}
              </Metadata>
            )}
            {report.subject.link_revoked_at && (
              <Metadata label={t('moderation.revokedAt')}>
                {formatDate(report.subject.link_revoked_at, i18n.language)}
              </Metadata>
            )}
          </dl>
        </section>
        <section
          className="space-y-3 rounded-lg bg-primary/5 p-4"
          aria-label={t('moderation.related')}
        >
          <h3 className="font-semibold">{t('moderation.related')}</h3>
          <p className="text-sm">
            {t('moderation.relatedCounts', {
              total: report.node_report_count,
              open: report.node_open_report_count,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('moderation.independentReports')}
          </p>
          <Button variant="outline" size="sm" onClick={onRelated}>
            {t('moderation.viewRelated')}
          </Button>
        </section>
        {report.resolution && (
          <section
            aria-label={t('moderation.audit')}
            className="space-y-3 border-t border-border pt-5"
          >
            <h3 className="font-semibold">{t('moderation.audit')}</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Metadata label={t('moderation.action')}>
                {t(`moderation.actions.${report.resolution.action}`)}
              </Metadata>
              <Metadata label={t('moderation.resolvedAt')}>
                {formatDate(report.resolution.created_at, i18n.language)}
              </Metadata>
              <Metadata label={t('moderation.resolver')}>
                {report.subject.resolver_name ?? t('moderation.deleted')}
                <span className="block font-mono text-xs text-muted-foreground">
                  {report.resolution.actor_uuid}
                </span>
              </Metadata>
            </dl>
            <p className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              {report.resolution.note}
            </p>
            <AuditResult report={report} />
          </section>
        )}
        {report.status === 'open' && (
          <form
            className="space-y-3 border-t border-border pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              setConfirm(true);
            }}
          >
            <h3 className="font-semibold">{t('moderation.resolve')}</h3>
            <div className="text-sm">
              <label htmlFor="moderation-action">
                {t('moderation.action')}
              </label>
              <Select
                disabled={change.isPending || confirm}
                value={action}
                onValueChange={(next) => {
                  const value = actions.find((item) => item === next);
                  if (value) setAction(value);
                }}
              >
                <SelectTrigger id="moderation-action" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {actions.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(`moderation.actions.${item}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
      </div>
    </article>
  );
}

function AuditResult({ report }: { report: ReportDetail }) {
  const { t } = useTranslation();
  const resolution = report.resolution;
  if (!resolution) return null;
  const targets = resolution.targets as Record<string, unknown>;
  const links = Array.isArray(targets.revoked_link_ids)
    ? targets.revoked_link_ids.filter(
        (id): id is string => typeof id === 'string',
      )
    : [];
  const revoked =
    resolution.action === 'revoke_link' || resolution.action === 'revoke_node';
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">{t('moderation.actualResult')}</p>
      <p>
        {t(
          resolution.action === 'dismiss'
            ? 'moderation.dismissResult'
            : revoked
              ? links.length
                ? 'moderation.revokedResult'
                : 'moderation.noChangeResult'
              : targets.changed === true
                ? 'moderation.suspendedResult'
                : 'moderation.noChangeResult',
          { count: links.length },
        )}
      </p>
      {links.length > 0 && (
        <ul className="space-y-1 font-mono text-xs text-muted-foreground">
          {links.map((id) => (
            <li key={id} className="break-all">
              {id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
