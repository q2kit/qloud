import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import type { DriveNode } from '../api';

type IconKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'archive'
  | 'sheet'
  | 'code'
  | 'file';

function kindOf(node: Pick<DriveNode, 'kind' | 'mime_type'>): IconKind {
  if (node.kind === 'folder') return 'folder';
  const mime = node.mime_type ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'text';
  if (/zip|compressed|tar|rar|7z/.test(mime)) return 'archive';
  if (/sheet|excel|csv/.test(mime)) return 'sheet';
  if (/json|javascript|xml|x-python|x-sh/.test(mime)) return 'code';
  return 'file';
}

export function NodeIcon({
  node,
  className,
}: {
  node: Pick<DriveNode, 'kind' | 'mime_type'>;
  className?: string;
}): React.JSX.Element {
  const kind = kindOf(node);
  const props = {
    'aria-hidden': true,
    className: cn(
      'shrink-0',
      kind === 'folder' ? 'text-primary' : 'text-muted-foreground',
      className,
    ),
  } as const;
  switch (kind) {
    case 'folder':
      return <Folder {...props} />;
    case 'image':
      return <FileImage {...props} />;
    case 'video':
      return <FileVideo {...props} />;
    case 'audio':
      return <FileAudio {...props} />;
    case 'text':
      return <FileText {...props} />;
    case 'archive':
      return <FileArchive {...props} />;
    case 'sheet':
      return <FileSpreadsheet {...props} />;
    case 'code':
      return <FileCode {...props} />;
    case 'file':
      return <File {...props} />;
  }
}
