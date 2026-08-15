'use client';

import { useSyncExternalStore, type RefObject } from 'react';
import { useElementObserver } from './useElementObserver';

// "IS THERE MORE TABLE OFF EITHER EDGE?" — the two booleans a horizontal scrollport's
// cues are drawn from (gh-268).
//
// Extracted from `DataTable`'s render function, which had grown to ~400 lines with this
// block inside it (autoknow-3nl). It is here rather than there because the answer is a
// property of ANY scrollport, and because a hook is testable without mounting a table.

/** 1px of slack. A scrollport that exactly fits can report a fractional
 *  `scrollWidth` vs `clientWidth` mismatch from subpixel layout, and without the slack
 *  that shows a permanent cue on a table which never actually scrolls. */
const SLACK = 1;

/**
 * Whether `ref`'s scrollport has content hidden to the left and to the right.
 *
 * TWO `useSyncExternalStore` calls, not one returning `{ left, right }`: the store
 * compares snapshots BY REFERENCE, so a composite object would be a new reference every
 * render whether or not either flag changed — an infinite render loop, not merely a
 * wasted one. The cost is subscribing twice on one element, which is nothing for a
 * component with a single scrollport.
 *
 * Both server snapshots are `false` — "nothing is off-screen", which is what a table that
 * fits looks like — so hydration cannot mismatch and a cue never flashes before the first
 * real measurement.
 */
export function useHorizontalScrollCues(ref: RefObject<HTMLElement | null>): {
  canScrollLeft: boolean;
  canScrollRight: boolean;
} {
  const subscribe = useElementObserver(ref, { scroll: true });

  const canScrollLeft = useSyncExternalStore(
    subscribe,
    () => (ref.current ? ref.current.scrollLeft > SLACK : false),
    () => false,
  );
  const canScrollRight = useSyncExternalStore(
    subscribe,
    () => {
      const el = ref.current;
      if (!el) return false;
      return el.scrollLeft + el.clientWidth < el.scrollWidth - SLACK;
    },
    () => false,
  );

  return { canScrollLeft, canScrollRight };
}
