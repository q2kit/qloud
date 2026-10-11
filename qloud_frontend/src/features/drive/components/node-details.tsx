import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ShareDialog } from '@/features/sharing/share-dialog';
import { useNode } from '../api';
import { useTranslation } from 'react-i18next';

import type { DriveNode } from '../api';
import { formatBytes, formatDate } from '../format';
import { NodeIcon } from './node-icon';

/** "Info" in the details panel for the selected item. */
export function NodeDetails({ node }: { node: DriveNode }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const detail = useNode(node.id);
  const [sharing, setSharing] = React.useState(false);
  const rows: [string, string][] = [
    [
      t('details.fields.type'),
      node.kind === 'folder'
        ? t('drive.kind.folder')
        : (node.mime_type ?? t('drive.kind.file')),
    ],
    ...(node.kind === 'file'
      ? ([
          [t('details.fields.size'), formatBytes(node.size, i18n.language)],
        ] as [string, string][])
      : []),
    [t('details.fields.modified'), formatDate(node.updated_at, i18n.language)],
    [t('details.fields.created'), formatDate(node.created_at, i18n.language)],
  ];
  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <span className="flex size-16 items-center justify-center rounded-xl bg-secondary">
          <NodeIcon node={node} className="size-8" />
        </span>
        <p className="w-full break-words text-sm font-medium">
          {node.is_root ? t('shell.breadcrumbRoot') : node.name}
        </p>
      </div>
      <dl className="space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {detail.data?.capabilities.can_share && (
        <Button
          className="mt-5"
          variant="outline"
          onClick={() => {
            setSharing(true);
          }}
        >
          {t('sharing.action')}
        </Button>
      )}
      {sharing && (
        <ShareDialog
          node={node}
          onClose={() => {
            setSharing(false);
          }}
        />
      )}
    </div>
  );
}

/** Several items selected: how many, and how much the files weigh. */
export function SelectionSummary({
  nodes,
}: {
  nodes: DriveNode[];
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const files = nodes.filter((node) => node.kind === 'file');
  const folders = nodes.length - files.length;
  const bytes = files.reduce((total, node) => total + node.size, 0);
  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <p className="mb-6 text-center text-sm font-medium">
        {t('drive.selection.count', { count: nodes.length })}
      </p>
      <dl className="space-y-3 text-sm">
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">{t('drive.kind.folder')}</dt>
          <dd className="tabular-nums">{folders}</dd>
        </div>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">{t('drive.kind.file')}</dt>
          <dd className="tabular-nums">
            {files.length} · {formatBytes(bytes, i18n.language)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
