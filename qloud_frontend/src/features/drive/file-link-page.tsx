import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { useMe } from '@/features/settings/use-me';

import { useNode } from './api';
import { compactId, folderPath, uuidFromUrl } from './paths';
import { LoadFailed } from './components/browser-states';

export function FileLinkPage() {
  const { t } = useTranslation();
  const { fileId } = useParams();
  const node = useNode(fileId ? uuidFromUrl(fileId) : undefined);
  const me = useMe();
  if (me.isError || node.isError || (node.data && node.data.kind !== 'file'))
    return (
      <LoadFailed
        title={t('preview.failed')}
        onRetry={() => {
          void node.refetch();
          void me.refetch();
        }}
      />
    );
  if (!node.data || !me.data)
    return <p role="status">{t('preview.loading')}</p>;
  return (
    <Navigate
      replace
      to={`${folderPath(node.data.parent_id === me.data.root_folder_id ? undefined : (node.data.parent_id ?? undefined))}?preview=${compactId(node.data.id)}`}
    />
  );
}
