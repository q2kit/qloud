import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { driveKeys } from '@/features/drive/api';

import { uploadApi } from './api';
import { UploaderContext } from './context';
import { UploadEngine, type PartRequest } from './engine';
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
        onUploaded: (_node, parentId) => {
          void queryClient.invalidateQueries({
            queryKey: driveKeys.children(parentId),
          });
        },
        isOnline: () => navigator.onLine,
        now: () => Date.now(),
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        newId: () => crypto.randomUUID(),
      }),
  );

  React.useEffect(() => {
    const offline = (): void => {
      engine.goOffline();
    };
    const online = (): void => {
      engine.online();
    };
    // Leaving with uploads on their way loses them until the file is picked again.
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (
        useUploadStore.getState().items.some((item) => ACTIVE.has(item.status))
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [engine]);

  return (
    <UploaderContext.Provider value={engine}>
      {children}
    </UploaderContext.Provider>
  );
}
