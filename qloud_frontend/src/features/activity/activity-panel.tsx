import * as React from 'react';
import { History, Shield, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { DriveNode } from '@/features/drive/api';
import { formatDate, formatRelative } from '@/features/drive/format';
import { useMe } from '@/features/settings/use-me';
import { ApiError } from '@/lib/api/errors';
import { useActivity, type ActivityEvent } from './api';

interface Folder {
  id: string | null;
  name: string | null;
  is_root: boolean;
}
interface Grantee {
  name?: string;
  email?: string;
}

/**
 * "Activity" in the details panel (M8-11b): who did what, newest first, loaded when
 * the tab opens. For a folder the API includes its whole subtree.
 */
export function ActivityPanel({
  node,
}: {
  node: DriveNode;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const query = useActivity(node.id);
  const me = useMe();
  // Relative times are judged when the tab opens, like the sharing tab's expiry.
  const [now] = React.useState(() => Date.now());

  if (query.isPending)
    return (
      <div
        role="status"
        aria-label={t('activity.loading')}
        className="flex-1 space-y-4 overflow-y-auto p-5"
      >
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-12 animate-pulse rounded-lg bg-secondary"
          />
        ))}
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="flex-1 overflow-y-auto p-5 text-sm">
        <p>
          {t(
            query.error instanceof ApiError && query.error.status === 404
              ? 'activity.unavailable'
              : 'activity.failed',
          )}
        </p>
        <Button
          variant="outline"
          className="mt-3"
          onClick={() => void query.refetch()}
        >
          {t('activity.retry')}
        </Button>
      </div>
    );

  const events = query.data.pages.flatMap((page) => page.results);
  const folderName = (folder: unknown): string => {
    const value = folder as Folder | null | undefined;
    if (!value?.name) return t('activity.hiddenFolder');
    return value.is_root ? t('shell.breadcrumbRoot') : value.name;
  };
  const actorName = (event: ActivityEvent): string => {
    if (event.actor_kind === 'system') return t('activity.system');
    if (event.actor_kind === 'moderator') return t('activity.moderator');
    if (!event.actor) return t('activity.deletedUser');
    if (event.actor.id === me.data?.id) return t('activity.you');
    // An empty name falls back to the email (editors only), then "Someone".
    const named = event.actor.display_name.trim();
    return named !== '' ? named : (event.actor.email ?? t('activity.someone'));
  };
  const sentence = (event: ActivityEvent): string => {
    const metadata = event.metadata as Record<string, unknown>;
    const grantee = metadata.grantee as Grantee | undefined;
    const granteeName = grantee?.name?.trim() ?? '';
    const versions = Array.isArray(metadata.versions) ? metadata.versions : [];
    const role = (value: unknown) =>
      t(value === 'editor' ? 'activity.roles.editor' : 'activity.roles.viewer');
    return t(`activity.actions.${event.action}`, {
      actor: actorName(event),
      name: event.node.name,
      from:
        event.action === 'node.move'
          ? folderName(metadata.from_folder)
          : (metadata.from_name ?? metadata.from_version),
      to: folderName(metadata.to_folder),
      version: metadata.version,
      count: versions.length,
      grantee:
        granteeName !== ''
          ? granteeName
          : (grantee?.email ?? t('activity.someone')),
      role: role(metadata.role),
      interpolation: { escapeValue: false },
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 text-sm">
      {events.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          <History className="mx-auto mb-3 size-8" aria-hidden="true" />
          <p>{t('activity.empty')}</p>
        </div>
      ) : (
        <ol className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground uppercase"
                aria-hidden="true"
              >
                {event.actor_kind === 'system' ? (
                  <Wrench className="size-4" />
                ) : event.actor_kind === 'moderator' ? (
                  <Shield className="size-4" />
                ) : (
                  actorName(event).trim().charAt(0)
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words">{sentence(event)}</p>
                <time
                  dateTime={event.created_at}
                  title={formatDate(event.created_at, i18n.language)}
                  className="text-xs text-muted-foreground"
                >
                  {formatRelative(event.created_at, i18n.language, now)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('activity.more')}
        </Button>
      )}
    </div>
  );
}
