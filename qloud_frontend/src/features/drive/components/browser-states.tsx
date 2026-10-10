import { RotateCw } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function LoadingSkeleton({
  view,
  label,
}: {
  label?: string;
  view: 'grid' | 'list';
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={label ?? t('drive.loading')}
      className={
        view === 'grid'
          ? 'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3'
          : 'space-y-2'
      }
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className={
            view === 'grid'
              ? 'h-36 animate-pulse rounded-lg bg-secondary'
              : 'h-11 animate-pulse rounded-md bg-secondary'
          }
        />
      ))}
    </div>
  );
}

export function CenteredState({
  icon,
  title,
  description,
  children,
}: React.PropsWithChildren<{
  icon: React.ReactNode;
  title: string;
  description: string;
}>): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-soft">
          {icon}
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {children && (
          <div className="mt-6 flex justify-center gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}

export function LoadFailed({
  onRetry,
  title,
}: {
  onRetry: () => void;
  title?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div role="alert">
      <CenteredState
        icon={
          <RotateCw className="size-6 text-destructive" aria-hidden="true" />
        }
        title={title ?? t('drive.errors.loadFailed')}
        description={t('drive.errors.loadFailedDescription')}
      >
        <Button variant="outline" onClick={onRetry}>
          <RotateCw />
          {t('drive.actions.retry')}
        </Button>
      </CenteredState>
    </div>
  );
}
