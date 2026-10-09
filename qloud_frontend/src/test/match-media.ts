import { vi } from 'vitest';

type ChangeListener = (event: MediaQueryListEvent) => void;

// jsdom has no matchMedia. This fake lets tests choose which queries match and
// fire `change` the way a browser does when the viewport or OS theme changes.
const matchesByQuery = new Map<string, boolean>();
const listenersByQuery = new Map<string, Set<ChangeListener>>();

function listenersFor(query: string): Set<ChangeListener> {
  let listeners = listenersByQuery.get(query);
  if (!listeners) {
    listeners = new Set();
    listenersByQuery.set(query, listeners);
  }
  return listeners;
}

function createMediaQueryList(query: string): MediaQueryList {
  const mediaQueryList = {
    media: query,
    get matches(): boolean {
      return matchesByQuery.get(query) ?? false;
    },
    onchange: null,
    addEventListener: (_type: string, listener: ChangeListener) => {
      listenersFor(query).add(listener);
    },
    removeEventListener: (_type: string, listener: ChangeListener) => {
      listenersFor(query).delete(listener);
    },
    addListener: (listener: ChangeListener) => {
      listenersFor(query).add(listener);
    },
    removeListener: (listener: ChangeListener) => {
      listenersFor(query).delete(listener);
    },
    dispatchEvent: () => true,
  };
  return mediaQueryList as unknown as MediaQueryList;
}

/**
 * Set whether `query` matches and notify its `change` listeners. Wrap the call
 * in `act()` when components are rendered.
 */
export function setMediaQuery(query: string, matches: boolean): void {
  // Browsers only fire `change` when the result actually flips.
  if ((matchesByQuery.get(query) ?? false) === matches) return;
  matchesByQuery.set(query, matches);
  const event = { matches, media: query } as MediaQueryListEvent;
  for (const listener of [...listenersFor(query)]) listener(event);
}

export function resetMediaQueries(): void {
  matchesByQuery.clear();
  listenersByQuery.clear();
}

export function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(createMediaQueryList),
  });
}
