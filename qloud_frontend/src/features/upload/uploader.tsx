import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { driveKeys, refreshDriveQueries } from '@/features/drive/api';

import { ApiError } from '@/lib/api/errors';

import { createUploadFolder, uploadApi, uploadKeys } from './api';
import { UploaderContext } from './context';
import { UploadEngine, type PartRequest } from './engine';
import { FolderUploadContext, type FolderUploader } from './folder-context';
import { uploadTree } from './folders';
import { ACTIVE, useUploadStore } from './store';

/** One engine for the signed-in shell; it outlives page changes inside the app. */
export function UploadProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const queryClient = useQueryClient();
  const [engine] = React.useState(
    () =>
      new UploadEngine({
        api: uploadApi,
        createRequest: () => new XMLHttpRequest() as unknown as PartRequest,
        onUploaded: (node, parentId) => {
          void refreshDriveQueries(
            queryClient,
            parentId ? driveKeys.children(parentId) : driveKeys.all,
          );
          if (node.parent_id && node.parent_id !== parentId)
            void refreshDriveQueries(
              queryClient,
              driveKeys.children(node.parent_id),
            );
          void refreshDriveQueries(queryClient, driveKeys.node(node.id));
          void refreshDriveQueries(queryClient, driveKeys.recent);
          void queryClient.invalidateQueries({
            queryKey: ['sharing', 'shared'],
          });
          void queryClient.invalidateQueries({ queryKey: uploadKeys.active });
        },
        isOnline: () => navigator.onLine,
        now: () => Date.now(),
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        newId: () => crypto.randomUUID(),
      }),
  );

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] =
    React.useState<FolderUploader['conflict']>(null);
  const queue = React.useRef(Promise.resolve());
  const pending = React.useRef(0);
  const answerRef = React.useRef<((choice: 'skip') => void) | null>(null);
  const mounted = React.useRef(true);
  const isMounted = (): boolean => mounted.current;
  const folders: FolderUploader = {
    busy,
    error,
    conflict,
    clearError: () => {
      setError(null);
    },
    addTree: (tree, parentId) => {
      setError(null);
      pending.current += 1;
      setBusy(true);
      queue.current = queue.current.then(async () => {
        if (!isMounted()) return;
        try {
          await uploadTree(tree, parentId, {
            create: (parentId, name, choice) => {
              if (!isMounted()) throw new Error('upload provider unmounted');
              return createUploadFolder(parentId, name, choice);
            },
            choose: (name) =>
              new Promise((resolve) => {
                if (!isMounted()) {
                  resolve('skip');
                  return;
                }
                const answer = (choice: Parameters<typeof resolve>[0]) => {
                  answerRef.current = null;
                  setConflict(null);
                  resolve(choice);
                };
                answerRef.current = answer;
                setConflict({ name, answer });
              }),
            add: (files, id) => {
              if (isMounted()) engine.add(files, id);
            },
            onFolder: (id) => {
              void refreshDriveQueries(queryClient, driveKeys.children(id));
            },
          });
        } catch (failure) {
          if (isMounted())
            setError(
              failure instanceof ApiError ? failure.code : 'folder_failed',
            );
        } finally {
          pending.current -= 1;
          if (isMounted()) setBusy(pending.current > 0);
        }
      });
    },
  };

  React.useEffect(() => {
    mounted.current = true;
    const offline = (): void => {
      engine.goOffline();
    };
    const online = (): void => {
      engine.online();
    };
    // Leaving with uploads on their way loses them until the file is picked again.
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (
        pending.current > 0 ||
        useUploadStore.getState().items.some((item) => ACTIVE.has(item.status))
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false;
      engine.dispose();
      answerRef.current?.('skip');
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [engine]);

  return (
    <UploaderContext.Provider value={engine}>
      <FolderUploadContext.Provider value={folders}>
        {children}
      </FolderUploadContext.Provider>
    </UploaderContext.Provider>
  );
}
