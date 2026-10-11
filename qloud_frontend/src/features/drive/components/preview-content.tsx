import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import type { PreviewLink } from '../preview-api';

const PdfPreview = React.lazy(() => import('./pdf-preview'));

export function PreviewContent({
  link,
  name,
  onError,
}: {
  link: PreviewLink;
  name: string;
  onError: () => void;
}) {
  const { t } = useTranslation();
  if (!link.url) return null;
  switch (link.kind) {
    case 'image':
      return (
        <img
          src={link.url}
          alt={name}
          className="max-h-full max-w-full object-contain"
          onError={onError}
        />
      );
    case 'pdf':
      return (
        <React.Suspense fallback={<p role="status">{t('preview.loading')}</p>}>
          <PdfPreview url={link.url} onError={onError} />
        </React.Suspense>
      );
    case 'video':
      return (
        <MediaPreview url={link.url} video name={name} onError={onError} />
      );
    case 'audio':
      return <MediaPreview url={link.url} name={name} onError={onError} />;
    case 'text':
      return <TextPreview url={link.url} onError={onError} />;
    default:
      return null;
  }
}

function TextPreview({ url, onError }: { url: string; onError: () => void }) {
  const { t } = useTranslation();
  const text = useQuery({
    queryKey: ['preview-text', url],
    queryFn: async ({ signal }) => {
      // This is object storage, not the application API; source bytes go directly to S3.
      const response = await fetch(url, { signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Source unavailable');
      const body = await response.text();
      if (body.length >= 1_000_000)
        throw new Error('Source exceeds preview limit');
      return body;
    },
    retry: false,
  });
  React.useEffect(() => {
    if (text.isError) onError();
  }, [text.isError, onError]);
  if (text.isPending) return <p role="status">{t('preview.loading')}</p>;
  return (
    <pre className="size-full overflow-auto whitespace-pre-wrap break-words p-4 text-sm">
      {text.data}
    </pre>
  );
}

function MediaPreview({
  url,
  video = false,
  name,
  onError,
}: {
  url: string;
  video?: boolean;
  name: string;
  onError: () => void;
}) {
  const ref = React.useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const position = React.useRef(0);
  const playing = React.useRef(false);
  const restoring = React.useRef(true);
  const Tag = video ? 'video' : 'audio';
  React.useEffect(() => {
    const element = ref.current;
    // Setup must restore the source after StrictMode replays cleanup in development.
    restoring.current = true;
    if (element) element.src = url;
    return () => {
      if (element) {
        position.current = element.currentTime;
        // Source replacement queues pause/timeupdate events; these aren't user intent.
        restoring.current = true;
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [url]);
  return (
    <Tag
      ref={ref}
      controls
      preload="metadata"
      aria-label={name}
      className={video ? 'max-h-full max-w-full' : 'w-full max-w-xl'}
      onTimeUpdate={(event) => {
        if (!restoring.current)
          position.current = event.currentTarget.currentTime;
      }}
      onPlay={() => {
        playing.current = true;
      }}
      onPause={() => {
        if (!restoring.current) playing.current = false;
      }}
      onLoadedMetadata={(event) => {
        event.currentTarget.currentTime = position.current;
        restoring.current = false;
        if (playing.current)
          void event.currentTarget.play().catch(() => undefined);
      }}
      onError={onError}
    />
  );
}
