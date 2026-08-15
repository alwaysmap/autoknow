'use client';

import { useCallback, useEffect, type RefObject } from 'react';
import { anchoredPosition } from './anchoredPosition';

// KEEPING A PANEL ON ITS TRIGGER — the browser half of `anchoredPosition`, once.
//
// The pure placement math lives next door and is unit-tested; this is the part that has
// to touch the DOM: read the trigger's rect and the panel's box, hand both to the
// positioner, write the answer back, and re-run for as long as the panel is open, because
// the trigger moves when the page scrolls or resizes.
//
// It exists because that read → place → write → re-run cycle was written twice, in
// `AnchoredPopover` and `Combobox`, identical apart from two lines (autoknow-9yx). Two
// copies of a geometry effect is the shape AGENTS lesson 7 names: the placement bug the
// popover component was created to fix could return in the picker alone, and nothing
// would say so. The components stay separate for the reason `Combobox`'s header gives —
// the native Popover API's invoker is a `<button>`, and a combobox is input-driven — but
// that argument is about DISMISS, never about geometry.
//
// The `scroll` listener is capturing on purpose: a scroll inside any ancestor moves the
// trigger just as a window scroll does, and those events do not bubble.

const MARGIN = 8; // px kept clear of every viewport edge

export interface UseAnchoredPositionOptions {
  /** Re-anchor only while this is true, and re-place the moment it becomes true. */
  active: boolean;
  align?: 'start' | 'end';
  /**
   * Treat the panel as at least as wide as its trigger, and pin that width on it.
   *
   * A combobox listbox must not be narrower than the input it drops from, and the width
   * has to reach the POSITIONER too — not just the style — or the flip/clamp decision is
   * made about a box narrower than the one that renders. That is why this is one option
   * rather than a caller-applied style: getting only half of it right is a panel placed
   * correctly for a width it does not have.
   */
  matchTriggerWidth?: boolean;
  /** Extra values that change the panel's SIZE (a filtered list is shorter), so the
   *  placement is recomputed rather than left over from the taller version. Its LENGTH
   *  must be constant across renders — it is spread into a dependency array, and React
   *  forbids one that changes size. That constraint is invisible at the call site, so it
   *  is the one way a future caller breaks this hook. */
  deps?: unknown[];
}

/**
 * Anchor `panelRef` under `triggerRef` while `active`, following scroll and resize.
 *
 * Returns the placement function so a caller that learns the panel opened by some other
 * route — `AnchoredPopover` hears a `toggle` event from the browser — can place it at
 * that instant instead of waiting for a render.
 */
export function useAnchoredPosition(
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  { active, align = 'start', matchTriggerWidth = false, deps = [] }: UseAnchoredPositionOptions,
): () => void {
  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const t = trigger.getBoundingClientRect();
    const triggerWidth = t.width;
    const { left, top } = anchoredPosition({
      trigger: { top: t.top, right: t.right, bottom: t.bottom, left: t.left },
      panel: {
        width: matchTriggerWidth ? Math.max(panel.offsetWidth, triggerWidth) : panel.offsetWidth,
        height: panel.offsetHeight,
      },
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      align,
      margin: MARGIN,
    });
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    if (matchTriggerWidth) panel.style.minWidth = `${triggerWidth}px`;
  }, [triggerRef, panelRef, align, matchTriggerWidth]);

  useEffect(() => {
    if (!active) return;
    position();
    const on = () => position();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, position, ...deps]);

  return position;
}
