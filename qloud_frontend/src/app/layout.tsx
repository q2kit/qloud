import * as React from 'react';
import { Outlet } from 'react-router';

import { CreateFolderDialog } from '@/features/drive/components/create-folder-dialog';
import { useDriveStore } from '@/features/drive/store';
import { ConflictDialog } from '@/features/upload/components/conflict-dialog';
import { FolderUploadFeedback } from '@/features/upload/components/folder-upload-feedback';
import { UploadTray } from '@/features/upload/components/upload-tray';
import { UploadProvider } from '@/features/upload/uploader';

import { ShortcutProvider } from '@/features/shortcuts/shortcut-provider';
import { useShortcut } from '@/features/shortcuts/context';
import { TrashToast } from '@/features/trash/trash-toast';

import { cn } from '@/lib/utils';

import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { DETAIL_SHEET_SELECTOR, DetailPanel } from './detail-panel';
import { useShowCreateFab } from './use-show-create-fab';

function DetailShortcut(): null {
  const setIsDetailOpen = useDriveStore((state) => state.setDetailOpen);
  // Not inside other modals (navigation drawer, share dialog…); the details sheet
  // itself is the exception, so `i` closes it the same way it opened it.
  useShortcut(
    'details',
    () => {
      setIsDetailOpen((current) => !current);
    },
    { within: DETAIL_SHEET_SELECTOR },
  );
  return null;
}

export function AppLayout(): React.JSX.Element {
  const [isNavigationOpen, setIsNavigationOpen] = React.useState(false);
  // In the store: "Info" in the item menu opens it too.
  const isDetailOpen = useDriveStore((state) => state.isDetailOpen);
  const setIsDetailOpen = useDriveStore((state) => state.setDetailOpen);
  const navigationTriggerRef = React.useRef<HTMLButtonElement>(null);
  const detailTriggerRef = React.useRef<HTMLButtonElement>(null);
  const showFab = useShowCreateFab();

  return (
    <ShortcutProvider>
      <UploadProvider>
        <DetailShortcut />
        <div className="flex min-h-screen bg-background text-foreground">
          <AppSidebar
            isOpen={isNavigationOpen}
            triggerRef={navigationTriggerRef}
            onClose={() => {
              setIsNavigationOpen(false);
            }}
            onOpenChange={setIsNavigationOpen}
          />
          <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
            <AppHeader
              isDetailOpen={isDetailOpen}
              navigationTriggerRef={navigationTriggerRef}
              detailTriggerRef={detailTriggerRef}
              onNavigationOpen={() => {
                setIsNavigationOpen(true);
              }}
              onDetailToggle={() => {
                setIsDetailOpen((current) => !current);
              }}
            />
            <div className="flex min-h-0 flex-1">
              <main
                className={cn(
                  'flex min-w-0 flex-1 flex-col px-4 py-5 *:w-full sm:px-6 sm:py-7 lg:px-8',
                  // Room for the floating "+" under the last row.
                  showFab && 'pb-24 sm:pb-24',
                )}
              >
                <Outlet />
              </main>
              <DetailPanel
                isOpen={isDetailOpen}
                triggerRef={detailTriggerRef}
                onClose={() => {
                  setIsDetailOpen(false);
                }}
                onOpenChange={setIsDetailOpen}
              />
            </div>
          </div>
          <CreateFolderDialog />
          <UploadTray />
          <TrashToast />
          <ConflictDialog />
          <FolderUploadFeedback />
        </div>
      </UploadProvider>
    </ShortcutProvider>
  );
}
