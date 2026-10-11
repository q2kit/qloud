import * as Dialog from '@radix-ui/react-dialog';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { useNode, type DriveNode } from '@/features/drive/api';
import { formatDate } from '@/features/drive/format';
import { useLinks, useShares, useSharingChange, type ShareRole } from './api';

export function ShareDialog({
  node,
  onClose,
}: {
  node: DriveNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-soft outline-none">
          <Dialog.Title className="break-words text-lg font-semibold">
            {t('sharing.title', { name: node.name })}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {t('sharing.inherited')}
          </Dialog.Description>
          <ShareForm node={node} />
          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <Button variant="outline">{t('sharing.close')}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function ShareForm({ node }: { node: DriveNode }) {
  const { t, i18n } = useTranslation();
  const detail = useNode(node.id);
  const allowed = detail.data?.capabilities.can_share === true;
  const shares = useShares(node.id, allowed);
  const links = useLinks(node.id, allowed);
  const change = useSharingChange(node.id);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<ShareRole>('viewer');
  const [expiry, setExpiry] = React.useState('');
  const [feedback, setFeedback] = React.useState('');
  const [localError, setLocalError] = React.useState('');
  const roleSelect = (
    value: ShareRole,
    onChange: (role: ShareRole) => void,
    label: string,
  ) => (
    <select
      aria-label={label}
      value={value}
      disabled={change.isPending}
      onChange={(event) => {
        onChange(event.target.value === 'editor' ? 'editor' : 'viewer');
      }}
      className="h-10 rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="viewer">{t('sharing.viewer')}</option>
      <option value="editor">{t('sharing.editor')}</option>
    </select>
  );
  const error =
    change.error instanceof ApiError
      ? t(
          `sharing.errors.${['invalid_share_recipient', 'invalid_share_target', 'share_exists'].includes(change.error.code) ? change.error.code : 'failed'}`,
        )
      : change.isError
        ? t('sharing.errors.failed')
        : localError;
  if (
    detail.isError &&
    !(detail.error instanceof ApiError && detail.error.status === 404)
  )
    return (
      <div className="mt-4 space-y-2">
        <p role="alert">{t('sharing.errors.failed')}</p>
        <Button onClick={() => void detail.refetch()}>
          {t('preview.retry')}
        </Button>
      </div>
    );
  if (detail.isError || (detail.data && !allowed))
    return (
      <p role="alert" className="mt-4">
        {t('sharing.errors.denied')}
      </p>
    );
  if (!detail.data)
    return (
      <p role="status" className="mt-4">
        {t('sharing.loading')}
      </p>
    );
  return (
    <div className="mt-5 space-y-5">
      <section aria-label={t('sharing.people')}>
        <h2 className="font-medium">{t('sharing.people')}</h2>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setFeedback('');
            setLocalError('');
            change.mutate(
              { kind: 'add', email: email.trim(), role },
              {
                onSuccess: () => {
                  setEmail('');
                  setFeedback(t('sharing.saved'));
                },
              },
            );
          }}
        >
          <label className="min-w-0 basis-full text-sm sm:flex-1 sm:basis-0">
            {t('sharing.email')}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
          <div className="flex items-end gap-2">
            {roleSelect(role, setRole, t('sharing.role'))}
            <Button type="submit" disabled={change.isPending || !email.trim()}>
              {t('sharing.add')}
            </Button>
          </div>
        </form>
        {shares.isPending ? (
          <p role="status">{t('sharing.loading')}</p>
        ) : shares.isError ? (
          <div className="mt-2 space-y-2">
            <p role="alert">{t('sharing.errors.failed')}</p>
            <Button onClick={() => void shares.refetch()}>
              {t('preview.retry')}
            </Button>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {shares.data.pages
              .flatMap((p) => p.results)
              .map((share) => (
                <li
                  key={share.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
                >
                  <span className="min-w-0 basis-full break-all text-sm sm:flex-1 sm:basis-0">
                    {share.grantee.display_name || share.grantee.email}
                    <span className="block text-xs text-muted-foreground">
                      {share.grantee.display_name ? share.grantee.email : null}
                    </span>
                  </span>
                  {roleSelect(
                    share.role,
                    (next) => {
                      change.mutate({ kind: 'role', id: share.id, role: next });
                    },
                    t('sharing.roleFor', { email: share.grantee.email }),
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={change.isPending}
                    aria-label={t('sharing.removeFor', {
                      email: share.grantee.email,
                    })}
                    onClick={() => {
                      change.mutate({ kind: 'remove', id: share.id });
                    }}
                  >
                    {t('sharing.remove')}
                  </Button>
                </li>
              ))}
          </ul>
        )}
        {shares.hasNextPage && (
          <Button
            variant="outline"
            disabled={shares.isFetchingNextPage}
            onClick={() => void shares.fetchNextPage()}
          >
            {t('sharing.more')}
          </Button>
        )}
      </section>
      <section aria-label={t('sharing.links')}>
        <h2 className="font-medium">{t('sharing.links')}</h2>
        {links.error instanceof ApiError && links.error.status === 404 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t('sharing.ownerOnly')}
          </p>
        ) : links.isPending ? (
          <p role="status">{t('sharing.loading')}</p>
        ) : links.isError ? (
          <div className="mt-2 space-y-2">
            <p role="alert">{t('sharing.errors.failed')}</p>
            <Button onClick={() => void links.refetch()}>
              {t('preview.retry')}
            </Button>
          </div>
        ) : (
          <>
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const date = expiry ? new Date(expiry) : null;
                setLocalError('');
                setFeedback('');
                if (
                  date &&
                  (!Number.isFinite(date.getTime()) ||
                    date.getTime() <= Date.now())
                ) {
                  setLocalError(t('sharing.errors.expiry'));
                  return;
                }
                change.mutate(
                  { kind: 'link', expires_at: date?.toISOString() ?? null },
                  {
                    onSuccess: () => {
                      setExpiry('');
                    },
                  },
                );
              }}
            >
              <label className="min-w-0 basis-full text-sm sm:flex-1 sm:basis-0">
                {t('sharing.expiry')}
                <input
                  type="datetime-local"
                  value={expiry}
                  onChange={(e) => {
                    setExpiry(e.target.value);
                  }}
                  className="mt-1 h-10 w-full min-w-0 rounded-md border border-input bg-background px-2"
                />
              </label>
              <Button disabled={change.isPending}>
                {t('sharing.createLink')}
              </Button>
            </form>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('sharing.noExpiry')}
            </p>
            <ul className="mt-3 space-y-3">
              {links.data.pages
                .flatMap((p) => p.results)
                .map((link) => {
                  const inactive =
                    Boolean(link.revoked_at) ||
                    (link.expires_at !== null &&
                      Date.parse(link.expires_at) <= now);
                  return (
                    <li
                      key={link.id}
                      className="space-y-2 border-t border-border pt-3"
                    >
                      <p className="text-sm">
                        {link.revoked_at
                          ? t('sharing.revoked')
                          : inactive
                            ? t('sharing.expired')
                            : link.expires_at
                              ? t('sharing.until', {
                                  date: formatDate(
                                    link.expires_at,
                                    i18n.language,
                                  ),
                                })
                              : t('sharing.active')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inactive}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(
                                new URL(
                                  `/s/${link.token}`,
                                  window.location.origin,
                                ).href,
                              )
                              .then(
                                () => {
                                  setFeedback(t('sharing.copied'));
                                },
                                () => {
                                  setLocalError(t('sharing.errors.copy'));
                                },
                              );
                          }}
                        >
                          {t('sharing.copy')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={
                            Boolean(link.revoked_at) || change.isPending
                          }
                          onClick={() => {
                            change.mutate({ kind: 'revoke', id: link.id });
                          }}
                        >
                          {t('sharing.revoke')}
                        </Button>
                      </div>
                    </li>
                  );
                })}
            </ul>
            {links.hasNextPage && (
              <Button
                variant="outline"
                disabled={links.isFetchingNextPage}
                onClick={() => void links.fetchNextPage()}
              >
                {t('sharing.more')}
              </Button>
            )}
          </>
        )}
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm">
        {feedback}
      </p>
    </div>
  );
}
