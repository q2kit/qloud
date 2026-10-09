import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { installMatchMedia, resetMediaQueries } from './match-media';

afterEach(() => {
  cleanup();
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
