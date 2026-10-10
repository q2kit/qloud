import type { TFunction } from 'i18next';

import { ApiError } from '@/lib/api/errors';

const KNOWN = new Set([
  'name_conflict',
  'invalid_target',
  'invalid_move',
  'root_folder',
  'not_found',
]);

/** A translated message for a failed drive request (`drive.errors.*`). */
export function driveErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (KNOWN.has(error.code)) return t(`drive.errors.${error.code}`);
    // Name rules (drive.names) come back as a field error, translated by the server.
    const fields = error.details.fields as
      Record<string, string[] | undefined> | undefined;
    const fieldMessage = fields?.name?.[0];
    if (fieldMessage) return fieldMessage;
  }
  return t('drive.errors.generic');
}
