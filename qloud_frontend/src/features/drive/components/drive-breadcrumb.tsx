import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { readDraggedIds } from '../actions';
import type { DriveNode, DriveNodeDetail } from '../api';
import { folderPath } from '../paths';

/** S-05: the breadcrumb is the page title; the current folder is the `<h1>`. */
export function DriveBreadcrumb({
  folder,
  onDrop,
}: {
  folder: DriveNodeDetail;
  /** Dropping dragged items on an ancestor moves them there (ui-ux.md). */
  onDrop: (
    target: Pick<DriveNode, 'id' | 'name' | 'is_root'>,
    ids: string[],
  ) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [over, setOver] = React.useState<string | null>(null);
  const label = (node: { name: string }, index: number): string =>
    // The root's stored name is technical; show the translated one.
    index === 0 ? t('shell.breadcrumbRoot') : node.name;
  const ancestors = folder.breadcrumb;
  // Narrow screens: the root and the parent, with an ellipsis between.
  const hidden = ancestors.length > 2 ? ancestors.slice(1, -1) : [];

  return (
    <nav aria-label={t('drive.breadcrumb')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {ancestors.map((node, index) => (
          <li
            key={node.id}
            className={
              hidden.includes(node)
                ? 'hidden items-center gap-1 md:flex'
                : 'flex min-w-0 items-center gap-1'
            }
          >
            {index === 1 && hidden.length > 0 && (
              <span className="md:hidden" aria-hidden="true">
                …
                <ChevronRight className="ml-1 inline size-3.5" />
              </span>
            )}
            <Link
              to={folderPath(index === 0 ? undefined : node.id)}
              className={
                over === node.id
                  ? 'truncate rounded-sm bg-primary/15 px-1 text-foreground ring-2 ring-primary'
                  : 'truncate rounded-sm hover:text-foreground hover:underline'
              }
              onDragOver={(event) => {
                if (readDraggedIds(event) === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setOver(node.id);
              }}
              onDragLeave={() => {
                setOver(null);
              }}
              onDrop={(event) => {
                const ids = readDraggedIds(event);
                setOver(null);
                if (!ids?.length) return;
                event.preventDefault();
                onDrop(
                  { id: node.id, name: node.name, is_root: index === 0 },
                  ids,
                );
              }}
            >
              {label(node, index)}
            </Link>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          </li>
        ))}
        <li className="min-w-0">
          <h1
            aria-current="page"
            className="truncate text-xl font-semibold tracking-tight text-foreground"
          >
            {folder.is_root ? t('shell.breadcrumbRoot') : folder.name}
          </h1>
        </li>
      </ol>
    </nav>
  );
}
