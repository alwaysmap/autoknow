'use client';

import { useCallback, type RefObject } from 'react';

// "TELL ME WHEN THIS ELEMENT'S LAYOUT MIGHT HAVE CHANGED" — the subscribe half of a
// `useSyncExternalStore` measurement, once.
//
// Browser-state reads in this app go through `useSyncExternalStore` rather than
// setState-in-effect (which is a lint ERROR here — see the ui-design skill). That splits
// every measurement into a pure `getSnapshot` and a `subscribe`, and it is `subscribe`
// that is fiddly and identical everywhere: wire a window resize, wire a ResizeObserver on
// the element, and return a cleanup that undoes exactly both. It had been written twice —
// `NavLinks` and `DataTable` — with the wiring differing slightly each time (autoknow-3nl).
//
// WHY BOTH SIGNALS, always, and not one or the other: `resize` catches viewport changes
// even where ResizeObserver delivery is throttled, and the observer catches layout changes
// that resize nothing — a sibling growing, a column widening under a longer sorted value.
// A consumer that took only one would be subtly wrong in one direction, which is exactly
// the kind of difference two hand-rolled copies drift into.
//
// The snapshot logic stays with the consumer. What "changed" MEANS — a visible-link count,
// a pair of scroll-cue booleans — is the component's business; being told to look again is
// not.

export interface ElementObserverOptions {
  /** Also fire on the element's own `scroll`. For a scrollport, where position changes
   *  with no layout change at all. Passive: this never calls `preventDefault`. */
  scroll?: boolean;
  /**
   * Also fire once when webfonts finish loading.
   *
   * Only matters where the measurement is of TEXT: late fonts change glyph metrics
   * without resizing anything, so a measurement taken against fallback metrics is never
   * retaken. A scrollport's geometry does not care.
   */
  fonts?: boolean;
}

/**
 * A `subscribe` for `useSyncExternalStore`, stable across renders, that fires `onChange`
 * whenever `ref`'s layout might have moved.
 *
 * Safe to hand to more than one `useSyncExternalStore` on the same element: each call
 * subscribes and cleans up independently. `useHorizontalScrollCues` relies on that, and
 * says there why it needs two stores rather than one.
 */
export function useElementObserver(
  ref: RefObject<HTMLElement | null>,
  { scroll = false, fonts = false }: ElementObserverOptions = {},
): (onChange: () => void) => () => void {
  return useCallback(
    (onChange: () => void) => {
      let disposed = false;
      const el = ref.current;
      window.addEventListener('resize', onChange);
      if (scroll && el) el.addEventListener('scroll', onChange, { passive: true });
      let ro: ResizeObserver | null = null;
      if (el && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(onChange);
        ro.observe(el);
      }
      // Guarded against a late resolve after unmount — the promise outlives the cleanup.
      if (fonts) document.fonts?.ready?.then(() => { if (!disposed) onChange(); }).catch(() => {});
      return () => {
        disposed = true;
        window.removeEventListener('resize', onChange);
        if (scroll && el) el.removeEventListener('scroll', onChange);
        ro?.disconnect();
      };
    },
    [ref, scroll, fonts],
  );
}
