import * as React from 'react';

import type { FolderConflictChoice } from './api';
import type { UploadTree } from './drop';

export interface FolderUploader {
  addTree: (tree: UploadTree, parentId: string) => void;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  conflict: {
    name: string;
    answer: (choice: FolderConflictChoice) => void;
  } | null;
}
export const FolderUploadContext = React.createContext<FolderUploader | null>(
  null,
);
export function useFolderUploader(): FolderUploader {
  const value = React.useContext(FolderUploadContext);
  if (!value) throw new Error('useFolderUploader needs <UploadProvider>');
  return value;
}
