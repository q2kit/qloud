import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { storageLevel, useStorage } from './api';

/** Shown while the storage is full: uploads stop, viewing and deleting still work. */
export function StorageFullBanner({
  showLink = true,
}: {
  showLink?: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const storage = useStorage();
  if (!storage.data || storageLevel(storage.data) !== 'full') return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
    >
      <CircleAlert
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{t('storage.full.title')}</span>{' '}
        {t('storage.full.description')}{' '}
        {showLink && (
          <Link
            to="/settings/storage"
            className="font-medium underline underline-offset-2"
          >
            {t('storage.full.manage')}
          </Link>
        )}
      </p>
    </div>
  );
}
