import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { ApiError } from '@/lib/api/errors';

import { useMe } from '@/features/settings/use-me';

import { useNode } from './api';
import { compactId, folderPath, spaceOf, uuidFromUrl } from './paths';
import { LoadFailed } from './components/browser-states';

/**
 * `/drive/files/:id` and `/shared/files/:id`: a file opens in its folder's viewer
 * (`?preview=`), in the space it belongs to (M8-22). A file shared on its own,
 * whose folder the viewer cannot see, opens over the /shared list instead.
 */
export function FileLinkPage() {
  const { t } = useTranslation();
  const { fileId } = useParams();
  const node = useNode(fileId ? uuidFromUrl(fileId) : undefined);
  const me = useMe();
  const parent = useNode(
    node.data?.kind === 'file' ? (node.data.parent_id ?? undefined) : undefined,
  );
  const parentUnavailable =
    parent.error instanceof ApiError && parent.error.status === 404;
  if (
    me.isError ||
    node.isError ||
    (node.data && node.data.kind !== 'file') ||
    (parent.isError && !parentUnavailable)
  )
    return (
      <LoadFailed
        title={t('preview.failed')}
        onRetry={() => {
          void node.refetch();
          void me.refetch();
          void parent.refetch();
        }}
      />
    );
  if (!node.data || !me.data)
    return <p role="status">{t('preview.loading')}</p>;
  const preview = `?preview=${compactId(node.data.id)}`;
  if (parentUnavailable || !node.data.parent_id)
    return <Navigate replace to={`/shared${preview}`} />;
  if (!parent.data) return <p role="status">{t('preview.loading')}</p>;
  return (
    <Navigate
      replace
      to={`${folderPath(
        node.data.parent_id === me.data.root_folder_id
          ? undefined
          : node.data.parent_id,
        undefined,
        spaceOf(node.data, me.data),
      )}${preview}`}
    />
  );
}
