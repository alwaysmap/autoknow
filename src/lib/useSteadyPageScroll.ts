'use client';

import { useCallback, useEffect } from 'react';

// PAGE MOTION MUST NOT MOVE UNDER A POINTER THAT IS ALREADY DOWN.
//
// `html { scroll-behavior: smooth }` (globals.css) makes every in-page scroll an
// ANIMATION, and its frames are scheduled by the browser's animation clock. A loaded
// machine starves that clock: a scroll requested now can sit still for a couple of
// hundred milliseconds and then take its first step at an arbitrary moment later.
//
// When that first step lands BETWEEN a press and its release, the two land on
// different elements — and the browser then delivers `click` to their common
// ANCESTOR, not to the thing that was pressed. So the handler never runs, no error is
// raised anywhere, and the gesture reads as "nothing happened". That is exactly how a
// card on the phase rail refused to select under full-suite load (autoknow-e1h): the
// press was fine, the page moved out from under it 9ms later. Waiting for the element
// to hold still first does not help, because at the moment you look the pending scroll
// has not moved anything yet.
//
// The cure is not a longer wait, it is a rule: a press STOPS page motion, and a scroll
// never STARTS while a pointer is down. Both halves are needed — the first covers a
// scroll already under way, the second covers one whose starved frame would otherwise
// fire mid-gesture. Read as behaviour rather than as plumbing, it is also the honest
// reading of the gesture: a new press supersedes the placement the last one asked for.

let pressed = false;
let armed = false;

/** Stop page motion dead, wherever it has got to. */
const halt = () => {
  // The object form is required: `scrollTo(x, y)` resolves its behaviour from CSS and
  // would therefore start a fresh SMOOTH scroll to the position we are trying to freeze.
  window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: 'instant' });
};

const onDown = () => {
  pressed = true;
  halt();
};
// Release on anything that can end a press, including the ones that never deliver a
// `pointerup` (the pointer leaving the window, a drag captured elsewhere). A `pressed`
// that got stuck on would silently disable placement scrolling for the rest of the page's
// life, so it is cleared generously rather than exactly.
const onRelease = () => {
  pressed = false;
};

// Armed once per page and never torn down: the rule is a property of the SCROLL ROOT,
// not of whichever component happens to be mounted, and three idle listeners cost
// nothing. Unsubscribing on unmount would instead leave the next component to mount
// racing its own first click.
const arm = () => {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  // Capture phase: this must run before any handler that might itself scroll.
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onRelease, true);
  window.addEventListener('pointercancel', onRelease, true);
  // NOT capture, unlike the three above: element `blur` bubbles nowhere but rides a
  // capturing window listener, so capturing here would release a live press the moment
  // focus left any field. This one wants the WINDOW losing focus and nothing else.
  window.addEventListener('blur', onRelease);
};

/**
 * `scrollIntoView`, for scrolls that move the PAGE — the ones a click asks for and the
 * reader then has to click through. Nullish nodes are ignored, so a call site keeps the
 * shape of the `node?.scrollIntoView(...)` it replaces.
 *
 * Use it for anything that scrolls the document. An inner scrollport does NOT need it —
 * `scroll-behavior: smooth` is set on the scroll root only, so those scrolls are instant
 * and cannot straddle a gesture. `block: 'nearest'` inside a scroll region is the tell,
 * and the two standing cases are `UnifiedSearch` (an active option in its listbox) and
 * `RelationshipScale` (the addressed update inside the popover's one scroll region).
 *
 * A HOOK rather than a plain exported function, which is the shape lib/locationHash.ts
 * uses for the same one-time-window-patch job: arming has to happen at MOUNT, before the
 * first press, and a function that armed lazily on its first call would be armed only
 * after the first scroll it was supposed to protect.
 */
export function useSteadyPageScroll() {
  useEffect(arm, []);
  return useCallback((node: Element | null | undefined, options?: ScrollIntoViewOptions) => {
    if (!node || pressed) return;
    node.scrollIntoView(options);
  }, []);
}
