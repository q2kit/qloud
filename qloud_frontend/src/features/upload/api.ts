import { api } from '@/lib/api/client';
import { unwrap } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';

/** The upload session API (M2-04, upload.md); the engine is its only caller. */
export type UploadSession = components['schemas']['UploadSession'];
export type UploadSessionDetail = components['schemas']['UploadSessionDetail'];
export type UploadedNode = components['schemas']['Node'];
export type OnConflict = 'fail' | 'rename';

export interface PartUrl {
  part_number: number;
  url: string;
}

export interface UploadApi {
  create: (input: {
    parentId: string;
    file: File;
    fingerprint: string;
    onConflict: OnConflict;
  }) => Promise<UploadSession>;
  partUrls: (sessionId: string, partNumbers: number[]) => Promise<PartUrl[]>;
  detail: (sessionId: string) => Promise<UploadSessionDetail>;
  complete: (sessionId: string) => Promise<UploadedNode>;
  abort: (sessionId: string) => Promise<void>;
}

export const uploadApi: UploadApi = {
  create: async ({ parentId, file, fingerprint, onConflict }) =>
    unwrap(
      await api.POST('/api/v1/uploads', {
        body: {
          parent_id: parentId,
          filename: file.name,
          size: file.size,
          mime_type: file.type,
          fingerprint,
          on_conflict: onConflict,
        },
      }),
    ),
  partUrls: async (sessionId, partNumbers) =>
    unwrap(
      await api.POST('/api/v1/uploads/{upload_id}/parts', {
        params: { path: { upload_id: sessionId } },
        body: { part_numbers: partNumbers },
      }),
    ).parts,
  detail: async (sessionId) =>
    unwrap(
      await api.GET('/api/v1/uploads/{upload_id}', {
        params: { path: { upload_id: sessionId } },
      }),
    ),
  complete: async (sessionId) =>
    unwrap(
      await api.POST('/api/v1/uploads/{upload_id}/complete', {
        params: { path: { upload_id: sessionId } },
      }),
    ),
  abort: async (sessionId) => {
    unwrap(
      await api.DELETE('/api/v1/uploads/{upload_id}', {
        params: { path: { upload_id: sessionId } },
      }),
    );
  },
};

export const uploadKeys = { active: ['uploads', 'active'] as const };

export async function activeUploads(cursor?: string) {
  return unwrap(
    await api.GET('/api/v1/uploads', {
      params: { query: { status: 'active', cursor } },
    }),
  );
}

export type FolderConflictChoice = 'rename' | 'reuse' | 'skip';

export async function createUploadFolder(
  parentId: string,
  name: string,
  onConflict: 'fail' | 'rename' | 'reuse',
): Promise<UploadedNode> {
  return unwrap(
    await api.POST('/api/v1/folders', {
      body: { parent_id: parentId, name, on_conflict: onConflict },
    }),
  );
}
