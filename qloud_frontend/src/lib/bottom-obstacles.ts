import * as React from 'react';
import { create } from 'zustand';

interface BottomObstaclesState {
  /** How far each floating bar reaches up from the bottom of the viewport, in px. */
  heights: Record<string, number>;
  setHeight: (key: string, height: number | null) => void;
}

export const useBottomObstacles = create<BottomObstaclesState>()((set) => ({
  heights: {},
  setHeight: (key, height) => {
    set(({ heights }) => {
      const others = Object.entries(heights).filter(([name]) => name !== key);
      return {
        heights: Object.fromEntries(
          height ? [...others, [key, height]] : others,
        ),
      };
    });
  },
}));

/**
 * Report a bar fixed to the bottom of the screen (upload tray, toast…) so the
 * floating "+" button can move above it. Attach the returned ref to the bar.
 */
export function useBottomObstacle(key: string): React.RefCallback<HTMLElement> {
  const setHeight = useBottomObstacles((state) => state.setHeight);
  return React.useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const measure = (): void => {
        const rect = element.getBoundingClientRect();
        setHeight(
          key,
          rect.height > 0 ? Math.max(0, window.innerHeight - rect.top) : null,
        );
      };
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      window.addEventListener('resize', measure);
      measure();
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', measure);
        setHeight(key, null);
      };
    },
    [key, setHeight],
  );
}

/** The space the bottom bars currently take up, in px (0 when none is shown). */
export function useBottomClearance(): number {
  return useBottomObstacles((state) =>
    Math.max(0, ...Object.values(state.heights)),
  );
}
