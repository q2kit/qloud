import * as React from 'react';
import { Outlet } from 'react-router';

import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { DetailPanel } from './detail-panel';

export function AppLayout(): React.JSX.Element {
  const [isNavigationOpen, setIsNavigationOpen] = React.useState(false);
  const [isDetailOpen, setIsDetailOpen] = React.useState(false);
  const navigationTriggerRef = React.useRef<HTMLButtonElement>(null);
  const detailTriggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key.toLowerCase() === 'i' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement) &&
        !(
          event.target instanceof HTMLElement &&
          // Covers contenteditable="", "true" and "plaintext-only".
          event.target.closest(
            '[contenteditable]:not([contenteditable="false"])',
          )
        )
      ) {
        setIsDetailOpen((current) => !current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
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
    </div>
  );
}
