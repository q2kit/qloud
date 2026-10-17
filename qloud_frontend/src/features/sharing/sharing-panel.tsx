import * as React from 'react';
import { Link2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useNode, type DriveNode } from '@/features/drive/api';
import { formatDate } from '@/features/drive/format';
import { useMe } from '@/features/settings/use-me';
import { ApiError } from '@/lib/api/errors';
import { useAccess, useLinks } from './api';
import { ShareDialog } from './share-dialog';

/**
 * "Sharing" in the details panel (M8-10): read-only, loaded when the tab opens.
 * Viewers see the owner and their own access; editors also see who has access;
 * only the owner sees public links, as the API allows. Changes go through S-11.
 */
export function SharingPanel({ node }: { node: DriveNode }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const detail = useNode(node.id);
  const me = useMe();
  const canShare = detail.data?.capabilities.can_share === true;
  const isOwner = me.data !== undefined && detail.data?.owner.id === me.data.id;
  const access = useAccess(node.id, canShare);
  const links = useLinks(node.id, isOwner);
  const [managing, setManaging] = React.useState(false);
  // Expiry is judged when the tab opens; the dialog shows it live.
  const [now] = React.useState(() => Date.now());
  const [feedback, setFeedback] = React.useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const queries = [detail, me, ...(canShare ? [access] : [])];
  const linkQueries = isOwner ? [links] : [];
  const pending = [...queries, ...linkQueries].some((query) => query.isPending);
  const failed = [...queries, ...linkQueries].find((query) => query.isError);
  // refetch() ignores `enabled`: never ask for what the API refuses this caller.
  const retry = () => {
    for (const query of [...queries, ...linkQueries]) void query.refetch();
  };

  if (failed)
    return (
      <div role="alert" className="flex-1 overflow-y-auto p-5 text-sm">
        <p>
          {t(
            failed.error instanceof ApiError && failed.error.status === 404
              ? 'sharing.panel.unavailable'
              : 'sharing.panel.failed',
          )}
        </p>
        <Button variant="outline" className="mt-3" onClick={retry}>
          {t('sharing.panel.retry')}
        </Button>
      </div>
    );
  if (pending || !detail.data || !me.data)
    return (
      <div
        role="status"
        aria-label={t('sharing.loading')}
        className="flex-1 space-y-4 overflow-y-auto p-5"
      >
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-16 animate-pulse rounded-lg bg-secondary"
          />
        ))}
      </div>
    );

  // The API gives no owner email; for our own items /me has it.
  const ownerName =
    detail.data.owner.display_name.trim() ||
    (isOwner ? me.data.email : t('sharing.unnamedOwner'));
  // Grants on ancestors carry their node's id; the breadcrumb names it.
  const folders = new Map(
    detail.data.breadcrumb.map((folder) => [folder.id, folder.name]),
  );
  const grants = access.data?.pages.flatMap((page) => page.results) ?? [];
  const activeLinks = (
    links.data?.pages.flatMap((page) => page.results) ?? []
  ).filter(
    (link) =>
      !link.revoked_at &&
      (link.expires_at === null || Date.parse(link.expires_at) > now),
  );
  const myRole = isOwner
    ? null
    : detail.data.capabilities.can_edit
      ? 'editor'
      : 'viewer';

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 text-sm">
      <p className="break-words font-medium">{detail.data.name}</p>

      <section aria-labelledby={`${node.id}-owner`}>
        <h3
          id={`${node.id}-owner`}
          className="mb-2 text-xs font-medium text-muted-foreground"
        >
          {t('sharing.panel.owner')}
        </h3>
        <Person
          name={
            isOwner ? t('sharing.panel.you', { name: ownerName }) : ownerName
          }
        />
        {myRole && (
          <p className="mt-2 text-muted-foreground">
            {t(`sharing.panel.yourRole.${myRole}`)}
          </p>
        )}
      </section>

      {canShare && (
        <section aria-labelledby={`${node.id}-people`}>
          <h3
            id={`${node.id}-people`}
            className="mb-2 text-xs font-medium text-muted-foreground"
          >
            {t('sharing.people')}
          </h3>
          {grants.length === 0 ? (
            <p className="text-muted-foreground">
              {t('sharing.panel.noPeople')}
            </p>
          ) : (
            <ul className="space-y-3">
              {grants.map((grant) => (
                <li key={grant.id}>
                  <Person
                    name={
                      grant.grantee.display_name.trim() || grant.grantee.email
                    }
                    email={grant.grantee.email}
                    role={t(`sharing.${grant.role}`)}
                    source={
                      grant.node_id === node.id
                        ? undefined
                        : t('sharing.panel.inheritedFrom', {
                            name:
                              folders.get(grant.node_id) ??
                              t('sharing.panel.parentFolder'),
                          })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          {access.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={access.isFetchingNextPage}
              onClick={() => {
                void access.fetchNextPage();
              }}
            >
              {t('sharing.more')}
            </Button>
          )}
        </section>
      )}

      {canShare && (
        <section aria-labelledby={`${node.id}-links`}>
          <h3
            id={`${node.id}-links`}
            className="mb-2 text-xs font-medium text-muted-foreground"
          >
            {t('sharing.links')}
          </h3>
          {!isOwner ? (
            <p className="text-muted-foreground">{t('sharing.ownerOnly')}</p>
          ) : activeLinks.length === 0 ? (
            <p className="text-muted-foreground">
              {t('sharing.panel.noLinks')}
            </p>
          ) : (
            <ul className="space-y-3">
              {activeLinks.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Link2
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words">
                      {link.expires_at
                        ? t('sharing.until', {
                            date: formatDate(link.expires_at, i18n.language),
                          })
                        : t('sharing.active')}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(
                          new URL(`/s/${link.token}`, window.location.origin)
                            .href,
                        )
                        .then(
                          () => {
                            setFeedback({
                              text: t('sharing.copied'),
                              error: false,
                            });
                          },
                          () => {
                            setFeedback({
                              text: t('sharing.errors.copy'),
                              error: true,
                            });
                          },
                        );
                    }}
                  >
                    {t('sharing.copy')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {isOwner && links.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={links.isFetchingNextPage}
              onClick={() => {
                void links.fetchNextPage();
              }}
            >
              {t('sharing.more')}
            </Button>
          )}
          {feedback && (
            <p
              role={feedback.error ? 'alert' : 'status'}
              className={`mt-2 ${feedback.error ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {feedback.text}
            </p>
          )}
        </section>
      )}

      {canShare && (
        <Button
          variant="outline"
          onClick={() => {
            setManaging(true);
          }}
        >
          <Users aria-hidden="true" />
          {t('sharing.panel.manage')}
        </Button>
      )}
      {managing && (
        <ShareDialog
          node={node}
          onClose={() => {
            setManaging(false);
            retry();
          }}
        />
      )}
    </div>
  );
}

function Person({
  name,
  email,
  role,
  source,
}: {
  name: string;
  email?: string;
  role?: string;
  source?: string;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground uppercase"
        aria-hidden="true"
      >
        {name.trim().charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium">{name}</p>
        {email && email !== name && (
          <p className="break-words text-xs text-muted-foreground">{email}</p>
        )}
        {source && (
          <p className="break-words text-xs text-muted-foreground">{source}</p>
        )}
      </div>
      {role && <span className="shrink-0 text-xs">{role}</span>}
    </div>
  );
}
