import * as React from 'react';

import type { DriveNode } from '../api';
import { usePreview } from '../preview-api';
import { NodeIcon } from './node-icon';

export function NodeThumbnail({
  node,
  list = false,
}: {
  node: DriveNode;
  list?: boolean;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = React.useState(false);
  const eligible =
    node.kind === 'file' &&
    /^(image\/(jpeg|png|gif|webp|avif)|application\/pdf)$/i.test(
      (node.mime_type ?? '').split(';')[0]?.trim() ?? '',
    );
  React.useEffect(() => {
    const element = ref.current;
    if (!eligible || !element || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(Boolean(entry?.isIntersecting));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [eligible]);
  const preview = usePreview(node, eligible && visible, true);
  const src = preview.data?.thumbnail?.url;
  const [failedUrl, setFailedUrl] = React.useState<string>();
  return (
    <span
      ref={ref}
      className={
        list
          ? 'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded'
          : 'flex h-20 items-center justify-center overflow-hidden rounded-md bg-secondary'
      }
    >
      {src && failedUrl !== src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="size-full object-contain"
          onError={() => {
            setFailedUrl(src);
          }}
        />
      ) : (
        <NodeIcon node={node} className={list ? 'size-5' : 'size-9'} />
      )}
    </span>
  );
}
