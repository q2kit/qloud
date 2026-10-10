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
const NOT_EMPTY =
  '[data-node-id], button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"], [role="alertdialog"]';

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
  onCreate,
  canDoubleClick,
  enabled = true,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  selectedIds: ReadonlySet<string>;
  onSelect: (ids: string[]) => void;
  onClear: () => void;
  onCreate: () => void;
  canDoubleClick: boolean;
  enabled?: boolean;
}): {
  box: Box | null;
  onPointerDown: (event: React.PointerEvent) => void;
  onDoubleClick: (event: React.MouseEvent) => void;
} {
  const [box, setBox] = React.useState<Box | null>(null);
  const dragged = React.useRef(false);
  const cleanup = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => cleanup.current?.(), []);
  const latest = React.useRef({ selectedIds, onSelect, onClear });
  React.useLayoutEffect(() => {
    latest.current = { selectedIds, onSelect, onClear };
  });

  const isEmpty = (event: React.SyntheticEvent): boolean =>
    enabled &&
    !event.defaultPrevented &&
    event.target instanceof Element &&
    event.currentTarget.contains(event.target) &&
    !event.target.closest(NOT_EMPTY) &&
    !document.querySelector(
      '[role="menu"], [role="dialog"], [role="alertdialog"]',
    );

  const onDoubleClick = (event: React.MouseEvent): void => {
    if (
      !canDoubleClick ||
      event.button !== 0 ||
      dragged.current ||
      !isEmpty(event)
    )
      return;
    event.preventDefault();
    onCreate();
  };

  const onPointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
    if (!isEmpty(event)) return;
    cleanup.current?.();
    dragged.current = false;
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
        dragged.current = true;
      }
      // Near the top or bottom edge: scroll, so the box can reach items off screen.
      if (move.clientY > window.innerHeight - EDGE) window.scrollBy(0, 24);
      else if (move.clientY < EDGE) window.scrollBy(0, -24);
      update();
    };
    const onScroll = (): void => {
      if (started) update();
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('scroll', onScroll);
      cleanup.current = null;
    };
    const onUp = (): void => {
      stop();
      setBox(null);
      if (!started && !additive) latest.current.onClear();
    };
    const onCancel = (): void => {
      stop();
      dragged.current = true;
      setBox(null);
    };
    cleanup.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('scroll', onScroll, { passive: true });
  };

  return { box, onPointerDown, onDoubleClick };
}
