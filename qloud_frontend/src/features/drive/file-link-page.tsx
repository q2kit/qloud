import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import { ApiError } from '@/lib/api/errors';

import { useMe } from '@/features/settings/use-me';

import { useNode } from './api';
import { compactId, folderPath, uuidFromUrl } from './paths';
import { FileViewer } from './components/file-viewer';
import { LoadFailed } from './components/browser-states';

export function FileLinkPage() {
  const { t } = useTranslation();
  const { fileId } = useParams();
  const navigate = useNavigate();
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
  if (parentUnavailable || !node.data.parent_id)
    return (
      <FileViewer
        nodes={[node.data]}
        hasMore={false}
        loadingMore={false}
        loadMore={() => Promise.resolve()}
        standalone={{
          fileId: node.data.id,
          onClose: () => {
            void navigate('/drive', { replace: true });
          },
        }}
      />
    );
  if (!parent.data) return <p role="status">{t('preview.loading')}</p>;
  return (
    <Navigate
      replace
      to={`${folderPath(node.data.parent_id === me.data.root_folder_id ? undefined : node.data.parent_id)}?preview=${compactId(node.data.id)}`}
    />
  );
}
