import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cursorOf, driveKeys } from '@/features/drive/api';
import { formatBytes } from '@/features/drive/format';
import { ApiError } from '@/lib/api/errors';

import {
  activeUploads,
  uploadApi,
  uploadKeys,
  type UploadSession,
} from '../api';
import { useUploader } from '../context';
import { useUploadStore } from '../store';

/** Server sessions stay in Query; a File is attached only after the user selects it. */
export function ResumeUploads() {
  const { t } = useTranslation();
  const items = useUploadStore((state) => state.items);
  const query = useInfiniteQuery({
    queryKey: uploadKeys.active,
    queryFn: ({ pageParam }) => activeUploads(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => cursorOf(page.next),
  });
  const attached = new Set(items.map((item) => item.sessionId));
  const sessions =
    query.data?.pages
      .flatMap((page) => page.results)
      .filter((session) => !attached.has(session.id)) ?? [];
  if (!query.isError && !sessions.length && !query.hasNextPage) return null;
  return (
    <section
      aria-label={t('upload.resume.title')}
      className="mb-4 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-semibold">{t('upload.resume.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('upload.resume.description')}
      </p>
      {query.isError && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void query.refetch();
          }}
        >
          {t('upload.resume.retry')}
        </Button>
      )}
      <ul className="mt-2 divide-y divide-border">
        {sessions.map((session) => (
          <ResumeRow key={session.id} session={session} />
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t('upload.resume.more')}
        </Button>
      )}
    </section>
  );
}

function ResumeRow({ session }: { session: UploadSession }) {
  const { t, i18n } = useTranslation();
  const engine = useUploader();
  const queryClient = useQueryClient();
  const input = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const abort = useMutation({
    mutationFn: () => uploadApi.abort(session.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: uploadKeys.active });
    },
    onError: () => {
      setError('upload_failed');
    },
  });
  const select = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (!(await engine.restore(file, session)))
        setError('fingerprint_mismatch');
      else void queryClient.invalidateQueries({ queryKey: driveKeys.all });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : 'upload_failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li
      aria-label={session.filename}
      className="flex flex-wrap items-center gap-2 py-2"
    >
      <div className="min-w-0 flex-1 basis-32">
        <p className="truncate text-sm font-medium" title={session.filename}>
          {session.filename}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(session.size, i18n.language)}
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {t(`upload.errors.${error}`, {
              defaultValue: t('upload.errors.upload_failed'),
            })}
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={t('upload.resume.pick', { name: session.filename })}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void select(file);
          event.target.value = '';
        }}
      />
      <Button
        size="sm"
        disabled={busy || abort.isPending}
        onClick={() => input.current?.click()}
      >
        {t('upload.resume.select')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || abort.isPending}
        aria-label={t('upload.actions.cancel', { name: session.filename })}
        onClick={() => {
          abort.mutate();
        }}
      >
        {t('upload.resume.cancel')}
      </Button>
    </li>
  );
}
