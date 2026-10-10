import { useTranslation } from 'react-i18next';

import type { DriveNode } from '../api';
import { formatBytes, formatDate } from '../format';
import { NodeIcon } from './node-icon';

/** "Info" in the details panel for the selected item. */
export function NodeDetails({ node }: { node: DriveNode }): React.JSX.Element {
  const { t, i18n } = useTranslation();
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
    </div>
  );
}
