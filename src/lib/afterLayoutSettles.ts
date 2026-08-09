'use client';

// THE two-frame wait, named once (AGENTS lesson 7 — three call sites were each
// hand-rolling the same nested requestAnimationFrame and pointing at each other's
// comments for the reasoning).
//
// WHY TWO FRAMES. A state update that changes an element's size (expanding a card,
// un-folding a section) has not happened yet when the handler that caused it runs —
// React commits on its own schedule. Measuring or scrolling immediately would act on
// the box the element USED to have (or, for something display:none, no box at all).
// The first frame gives React its commit + paint; the second lets layout settle on the
// new geometry. Only then is a measurement or a placement scroll acting on the truth.
//
// Anything scrolled inside `fn` still goes through useSteadyPageScroll — this helper
// defers the work, the guard decides whether page motion is allowed at all.

export function afterLayoutSettles(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}
