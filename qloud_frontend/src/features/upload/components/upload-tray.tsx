import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Pause,
  Play,
  RotateCw,
  WifiOff,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { resendVerificationEmail } from '@/features/auth/api';
import { useSession } from '@/features/auth/use-auth';
import { NodeIcon } from '@/features/drive/components/node-icon';
import { formatBytes } from '@/features/drive/format';
import { useBottomObstacle } from '@/lib/bottom-obstacles';
import { cn } from '@/lib/utils';

import { ACTIVE, useUploadStore, type UploadItem } from '../store';
import { useUploader } from '../context';

function useSummary(items: UploadItem[], speed: number) {
  const active = items.filter((item) => ACTIVE.has(item.status));
  const finished = items.filter((item) => item.status === 'done').length;
  const counted = items.filter(
    (item) => item.status !== 'cancelled' && item.status !== 'skipped',
  );
  const remaining = active.reduce(
    (sum, item) => sum + item.size - item.loaded,
    0,
  );
  return {
    active: active.length,
    finished,
    total: counted.length,
    failed: items.filter((item) => item.status === 'error').length,
    paused: items.filter((item) => item.status === 'paused').length,
    seconds: speed > 0 ? Math.ceil(remaining / speed) : null,
  };
}

/** The upload tray (ui-ux.md): floating at the bottom right, a strip on small screens. */
export function UploadTray(): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const engine = useUploader();
  const items = useUploadStore((state) => state.items);
  const speed = useUploadStore((state) => state.speed);
  const offline = useUploadStore((state) => state.offline);
  const collapsed = useUploadStore((state) => state.isTrayCollapsed);
  const setCollapsed = useUploadStore((state) => state.setTrayCollapsed);
  const clearFinished = useUploadStore((state) => state.clearFinished);
  const summary = useSummary(items, speed);
  const obstacleRef = useBottomObstacle('upload-tray');
  if (items.length === 0) return null;

  const title =
    summary.active > 0
      ? t('upload.tray.uploading', {
          done: summary.finished,
          total: summary.total,
        })
      : t('upload.tray.finished', { count: summary.finished });
  const detail = offline
    ? t('upload.tray.offline')
    : summary.active > 0 && speed > 0
      ? t('upload.tray.speed', {
          speed: formatBytes(speed, i18n.language),
          time: formatDuration(summary.seconds ?? 0, i18n.language),
        })
      : null;

  return (
    <section
      ref={obstacleRef}
      aria-label={t('upload.tray.label')}
      className="fixed inset-x-2 bottom-2 z-30 overflow-hidden rounded-lg border border-border bg-card shadow-soft sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-sm font-semibold">{title}</p>
          {detail && (
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground tabular-nums">
              {offline && <WifiOff className="size-3.5" aria-hidden="true" />}
              {detail}
            </p>
          )}
        </div>
        {summary.active > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('upload.actions.pauseAll')}
            onClick={() => {
              engine.pauseAll();
            }}
          >
            <Pause />
          </Button>
        )}
        {summary.active === 0 && summary.paused > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('upload.actions.resumeAll')}
            onClick={() => {
              engine.resumeAll();
            }}
          >
            <Play />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? t('upload.tray.expand') : t('upload.tray.collapse')
          }
          onClick={() => {
            setCollapsed(!collapsed);
          }}
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </Button>
        {summary.active === 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('upload.tray.close')}
            onClick={clearFinished}
          >
            <X />
          </Button>
        )}
      </header>
      {!collapsed && (
        <>
          <ul className="max-h-[min(50vh,22rem)] divide-y divide-border overflow-y-auto">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} />
            ))}
          </ul>
          {summary.failed > 0 && (
            <div className="border-t border-border px-4 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  engine.retryFailed();
                }}
              >
                <RotateCw />
                {t('upload.actions.retryFailed', { count: summary.failed })}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function formatDuration(seconds: number, locale: string): string {
  const unit = seconds >= 3600 ? 'hour' : seconds >= 60 ? 'minute' : 'second';
  const value =
    unit === 'hour'
      ? seconds / 3600
      : unit === 'minute'
        ? seconds / 60
        : seconds;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'long',
    maximumFractionDigits: 0,
  }).format(Math.max(1, Math.ceil(value)));
}

function UploadRow({ item }: { item: UploadItem }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const engine = useUploader();
  const percent =
    item.size > 0 ? Math.round((item.loaded / item.size) * 100) : 100;
  const bytes = (value: number) => formatBytes(value, i18n.language);
  const status = {
    queued: t('upload.status.queued'),
    conflict: t('upload.status.conflict'),
    uploading: t('upload.status.uploading', {
      loaded: bytes(item.loaded),
      size: bytes(item.size),
    }),
    completing: t('upload.status.completing'),
    paused: t('upload.status.paused', {
      loaded: bytes(item.loaded),
      size: bytes(item.size),
    }),
    error: t(`upload.errors.${item.error ?? 'upload_failed'}`, {
      defaultValue: t('upload.errors.upload_failed'),
    }),
    done: bytes(item.size),
    cancelled: t('upload.status.cancelled'),
    skipped: t('upload.status.skipped'),
  }[item.status];
  const showBar = ['uploading', 'paused', 'completing', 'queued'].includes(
    item.status,
  );

  const action = (label: string, icon: React.ReactNode, run: () => void) => (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={label}
      onClick={run}
    >
      {icon}
    </Button>
  );

  return (
    <li className="flex items-center gap-3 px-4 py-2.5" aria-label={item.name}>
      <NodeIcon
        node={{ kind: 'file', mime_type: item.type || null }}
        className="size-5"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.name}>
          {item.name}
        </p>
        {showBar && (
          <div
            role="progressbar"
            aria-label={item.name}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width]',
                item.status === 'paused' ? 'bg-muted-foreground' : 'bg-primary',
              )}
              style={{ width: `${String(percent)}%` }}
            />
          </div>
        )}
        <p
          className={cn(
            'mt-1 truncate text-xs tabular-nums',
            item.status === 'error'
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {status}
        </p>
        {item.status === 'error' && item.error === 'email_not_verified' && (
          <ResendVerification />
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {item.status === 'done' && (
          <CircleCheck
            className="size-5 text-success"
            aria-label={t('upload.status.done')}
          />
        )}
        {(item.status === 'uploading' || item.status === 'queued') &&
          action(
            t('upload.actions.pause', { name: item.name }),
            <Pause />,
            () => {
              engine.pause(item.id);
            },
          )}
        {item.status === 'paused' &&
          action(
            t('upload.actions.resume', { name: item.name }),
            <Play />,
            () => {
              engine.resume(item.id);
            },
          )}
        {item.status === 'error' &&
          action(
            t('upload.actions.retry', { name: item.name }),
            <RotateCw />,
            () => {
              engine.retry(item.id);
            },
          )}
        {['queued', 'uploading', 'paused', 'error', 'conflict'].includes(
          item.status,
        ) &&
          action(
            t('upload.actions.cancel', { name: item.name }),
            <CircleX />,
            () => {
              engine.cancel(item.id);
            },
          )}
      </div>
    </li>
  );
}

function ResendVerification(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const [state, setState] = React.useState<
    'idle' | 'sending' | 'sent' | 'failed'
  >('idle');
  const email = session?.user?.email;
  if (!email) return null;
  if (state === 'sent') {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {t('upload.verify.sent', { email })}
      </p>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-1.5 h-7 px-2 text-xs"
      disabled={state === 'sending'}
      onClick={() => {
        setState('sending');
        resendVerificationEmail(email).then(
          () => {
            setState('sent');
          },
          () => {
            setState('failed');
          },
        );
      }}
    >
      {state === 'failed'
        ? t('upload.verify.failed')
        : t('upload.verify.resend')}
    </Button>
  );
}
