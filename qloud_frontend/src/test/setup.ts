import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { useDriveStore } from '@/features/drive/store';
import { useUploadStore } from '@/features/upload/store';

import { installMatchMedia, resetMediaQueries } from './match-media';

afterEach(() => {
  cleanup();
  // Module-level store: selection and open panels must not leak between tests.
  useDriveStore.setState(useDriveStore.getInitialState(), true);
  useUploadStore.setState(useUploadStore.getInitialState(), true);
  resetMediaQueries();
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
});

installMatchMedia();

class ResizeObserverMock implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

window.ResizeObserver = ResizeObserverMock;

// jsdom has no layout/scrolling; browser tests verify that revealed files are visible.
HTMLElement.prototype.scrollIntoView = vi.fn();
