import * as React from 'react';

/** Page coordinates (scroll included), so the box stays put while the page scrolls. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const START_AFTER = 4; // px of movement before a press on empty space becomes a box
const EDGE = 48; // px from the window's edge where dragging scrolls the page
// Where a press does something else: items (select, drag to move), buttons, links, fields.
const NOT_EMPTY = '[data-node-id], button, a, input, textarea, [role="menu"]';

function boxFrom(x0: number, y0: number, x1: number, y1: number): Box {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

/**
 * Rubber-band selection, as on a desktop file manager: press on empty space and drag;
 * every item the box touches is selected. With Ctrl/⌘ held, it adds to the selection.
 * A press without dragging clears the selection. Mouse only: touch scrolls instead.
 */
export function useMarquee({
  containerRef,
  selectedIds,
  onSelect,
  onClear,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  selectedIds: ReadonlySet<string>;
  onSelect: (ids: string[]) => void;
  onClear: () => void;
}): { box: Box | null; onPointerDown: (event: React.PointerEvent) => void } {
  const [box, setBox] = React.useState<Box | null>(null);
  const latest = React.useRef({ selectedIds, onSelect, onClear });
  React.useLayoutEffect(() => {
    latest.current = { selectedIds, onSelect, onClear };
  });

  const onPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
    if (event.target instanceof Element && event.target.closest(NOT_EMPTY))
      return;
    // No text selection while drawing the box.
    event.preventDefault();
    const startX = event.clientX + window.scrollX;
    const startY = event.clientY + window.scrollY;
    const additive = event.ctrlKey || event.metaKey;
    const base = additive ? [...latest.current.selectedIds] : [];
    let started = false;
    let pointer = { x: event.clientX, y: event.clientY };

    const update = (): void => {
      const current = boxFrom(
        startX,
        startY,
        pointer.x + window.scrollX,
        pointer.y + window.scrollY,
      );
      setBox(current);
      const hits: string[] = [];
      for (const element of containerRef.current?.querySelectorAll<HTMLElement>(
        '[data-node-id]',
      ) ?? []) {
        const rect = element.getBoundingClientRect();
        const left = rect.left + window.scrollX;
        const top = rect.top + window.scrollY;
        const touches =
          left < current.right &&
          left + rect.width > current.left &&
          top < current.bottom &&
          top + rect.height > current.top;
        const id = element.dataset.nodeId;
        if (touches && id) hits.push(id);
      }
      latest.current.onSelect([...new Set([...base, ...hits])]);
    };

    const onMove = (move: PointerEvent): void => {
      pointer = { x: move.clientX, y: move.clientY };
      if (!started) {
        const distance = Math.hypot(
          move.clientX - event.clientX,
          move.clientY - event.clientY,
        );
        if (distance < START_AFTER) return;
        started = true;
      }
      // Near the top or bottom edge: scroll, so the box can reach items off screen.
      if (move.clientY > window.innerHeight - EDGE) window.scrollBy(0, 24);
      else if (move.clientY < EDGE) window.scrollBy(0, -24);
      update();
    };
    const onScroll = (): void => {
      if (started) update();
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('scroll', onScroll);
      setBox(null);
      if (!started && !additive) latest.current.onClear();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('scroll', onScroll, { passive: true });
  };

  return { box, onPointerDown };
}
