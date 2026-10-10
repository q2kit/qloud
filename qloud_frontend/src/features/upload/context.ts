import * as React from 'react';

import type { UploadEngine } from './engine';

export const UploaderContext = React.createContext<UploadEngine | null>(null);

/** The engine of the signed-in shell (<UploadProvider> in the app layout). */
export function useUploader(): UploadEngine {
  const engine = React.useContext(UploaderContext);
  if (!engine) throw new Error('useUploader needs <UploadProvider>');
  return engine;
}
