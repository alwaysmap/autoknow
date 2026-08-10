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
// The cure is not a longer wait, it is a rule: THE PAGE HOLDS STILL WHILE A POINTER IS
// DOWN. Read as behaviour rather than as plumbing, that is also the honest reading of
// the gesture: a new press supersedes the placement the last one asked for.
//
// The rule is enforced twice over, and both halves are needed:
//
//   * a scroll of OURS never starts while a pointer is down (the `pressed` gate at the
//     bottom), which covers the placement scroll a card click queues behind two frames;
//   * and the scroll position is PINNED for the press (`pin` below), which covers
//     motion already under way — including motion nothing here started, like the
//     browser's own smooth jump to a `#phase-N` fragment.
//
// The pin is not belt-and-braces, and this is the part that a single `scrollTo` gets
// wrong. Blink applies an instant scroll AT ONCE but still lets the animation it was
// meant to cancel commit one more step afterwards: measured in Chromium 141, halting a
// smooth scroll that had already begun left between 8px and 102px of motion still to
// come, arriving one animation frame later, at every CPU-throttling rate tried. One
// frame is all it takes — 10px is enough to move a title out from under a pointer — so
// halting once is not halting (autoknow-dxa). Re-asserting the offset each frame is.

let pressed = false;
let armed = false;

/** Where the page is pinned, and until when. Read only while `pinning`. */
let pinTop = 0;
let pinLeft = 0;
let pinX = 0;
let pinY = 0;
let pinUntil = 0;
let pinning = false;

/**
 * How long a press may hold the page, and how far the pointer may wander before it stops
 * being a click. Both are escape hatches, not timings anything depends on: the pin's real
 * end is the release, and these only bound the damage if a release never arrives. A press
 * long enough to outlive `PIN_MS`, or a pointer that has travelled past `SLOP`, is a drag
 * — and a drag wants the page back (a text selection dragged to the edge autoscrolls, and
 * that must still work).
 */
const PIN_MS = 500;
const SLOP = 4;

const freeze = () => window.scrollTo({ top: pinTop, left: pinLeft, behavior: 'instant' });

const pinFrame = () => {
  if (!pinning) return;
  if (!pressed || performance.now() > pinUntil) {
    pinning = false;
    return;
  }
  freeze();
  requestAnimationFrame(pinFrame);
};

const onDown = (e: PointerEvent) => {
  pressed = true;
  pinTop = window.scrollY;
  pinLeft = window.scrollX;
  pinX = e.clientX;
  pinY = e.clientY;
  pinUntil = performance.now() + PIN_MS;
  freeze();
  // A second pointer landing mid-press re-aims the running loop rather than starting a
  // second one, which would leave two frames fighting over two different offsets.
  if (!pinning) {
    pinning = true;
    requestAnimationFrame(pinFrame);
  }
};

/** The pointer has travelled: this is a drag, and the page belongs to the reader again. */
const onMove = (e: PointerEvent) => {
  if (pinning && (Math.abs(e.clientX - pinX) > SLOP || Math.abs(e.clientY - pinY) > SLOP)) pinning = false;
};

/** The reader is scrolling on purpose. Nothing about a click is worth fighting that. */
const onWheel = () => {
  pinning = false;
};

// Release on anything that can end a press, including the ones that never deliver a
// `pointerup` (the pointer leaving the window, a drag captured elsewhere). A `pressed`
// that got stuck on would silently disable placement scrolling for the rest of the page's
// life, so it is cleared generously rather than exactly.
const onRelease = () => {
  pressed = false;
  pinning = false;
};

// Armed once per page and never torn down: the rule is a property of the SCROLL ROOT,
// not of whichever component happens to be mounted, and a handful of idle listeners cost
// nothing. Unsubscribing on unmount would instead leave the next component to mount
// racing its own first click.
const arm = () => {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  // Capture phase: this must run before any handler that might itself scroll.
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onRelease, true);
  window.addEventListener('pointercancel', onRelease, true);
  // Touch panning never delivers `pointerup` — the browser claims the gesture and fires
  // `pointercancel` above — so the pin cannot fight a swipe. `wheel` is the mouse's
  // equivalent tell and is passive, so it never delays a scroll.
  window.addEventListener('wheel', onWheel, { capture: true, passive: true });
  // NOT capture, unlike the others: element `blur` bubbles nowhere but rides a
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
