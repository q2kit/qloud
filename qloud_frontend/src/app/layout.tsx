import * as React from 'react';
import { Outlet } from 'react-router';

import { CreateFolderDialog } from '@/features/drive/components/create-folder-dialog';
import { useDriveStore } from '@/features/drive/store';
import { ConflictDialog } from '@/features/upload/components/conflict-dialog';
import { FolderUploadFeedback } from '@/features/upload/components/folder-upload-feedback';
import { UploadTray } from '@/features/upload/components/upload-tray';
import { UploadProvider } from '@/features/upload/uploader';

import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { DETAIL_SHEET_SELECTOR, DetailPanel } from './detail-panel';

// Targets where `i` already means something: text entry (contenteditable="",
// "true" and "plaintext-only") and Radix menus/listboxes, which use letter keys
// for typeahead.
const KEY_CONSUMING_TARGETS = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="listbox"]',
].join(', ');

function isDetailShortcut(event: KeyboardEvent): boolean {
  if (
    event.key.toLowerCase() !== 'i' ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.repeat ||
    event.defaultPrevented
  ) {
    return false;
  }
  if (!(event.target instanceof Element)) return true;
  if (event.target.closest(KEY_CONSUMING_TARGETS)) return false;
  // Inside a modal (navigation drawer, future share dialog…) the shortcut must
  // not stack the details sheet on top. The details sheet itself is the
  // exception, so `i` closes it the same way it opened it.
  const dialog = event.target.closest('[role="dialog"], [role="alertdialog"]');
  return !dialog || dialog.matches(DETAIL_SHEET_SELECTOR);
}

export function AppLayout(): React.JSX.Element {
  const [isNavigationOpen, setIsNavigationOpen] = React.useState(false);
  // In the store: "Info" in the item menu opens it too.
  const isDetailOpen = useDriveStore((state) => state.isDetailOpen);
  const setIsDetailOpen = useDriveStore((state) => state.setDetailOpen);
  const navigationTriggerRef = React.useRef<HTMLButtonElement>(null);
  const detailTriggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isDetailShortcut(event)) {
        setIsDetailOpen((current) => !current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setIsDetailOpen]);

  return (
    <UploadProvider>
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
            <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
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
        <ConflictDialog />
        <FolderUploadFeedback />
      </div>
    </UploadProvider>
  );
}
