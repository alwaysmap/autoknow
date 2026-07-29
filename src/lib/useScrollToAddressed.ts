'use client';

import { useEffect, useRef, type RefObject } from 'react';

// A log of near-identical cards answers "here is the history" when the reader asked
// "show me THIS update". Every hash-addressable log in the app therefore marks the
// addressed entry AND brings it into view — partner health, program status, phase
// progress (design.md §4b).
//
// It lives here rather than in each list because the second copy is where AGENTS lesson
// 7 starts and the third is where it has already happened: `RelationshipScale` hand-rolled
// this over its own wrapper ref, and converging program status and phase progress onto the
// same behaviour (autoknow-51j) wanted the identical effect twice more.
//
// Pair it with `addressedAttrs` below on the card itself: the attribute this queries and
// the attribute the card writes are one decision, so they are written in one place.
//
// "The surface holding the list" rather than "the popover": of the three callers only the
// needle's log is one — a phase's is the progress overlay on its card, since autoknow-crw
// retired the phase popover.

/**
 * A ref for the scroll container, which brings the card carrying
 * `data-update-id={highlightId}` into view.
 *
 * @param highlightId the one entry a deep link addressed, or null for "just the log"
 * @param enabled     is the surface holding the list actually visible? A scroll inside a
 *                    hidden one does nothing, so the caller passes its own open state and
 *                    the scroll re-fires the moment it opens
 * @param rerunOn     an identity token — the rendered entries, so the scroll re-fires when
 *                    the server hands down a new array. Never READ, only compared, which
 *                    is why it is not typed as the entries themselves
 */
export function useScrollToAddressed(
  highlightId: number | null | undefined,
  enabled: boolean,
  rerunOn: unknown,
): RefObject<HTMLDivElement | null> {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || highlightId == null) return;
    // `nearest` keeps the scroll inside the list's own scroll region rather than moving
    // the page under it.
    listRef.current?.querySelector(`[data-update-id="${highlightId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [enabled, highlightId, rerunOn]);
  return listRef;
}

/**
 * The card's half of the contract: the id this is addressable BY, and the marker that
 * says "you were sent here". Spread onto the card element.
 *
 * `data-addressed` is styled as an OUTLINE wherever it is used, because globals.css
 * carries a blanket `[class*="card"] { border: none … }` with `!important` that matches
 * hashed module classes on the substring
 * (docs/knowledge/global-class-substring-selector-catches-module-classes.md).
 */
export const addressedAttrs = (id: number, highlightId: number | null | undefined) => ({
  'data-update-id': id,
  'data-addressed': highlightId != null && id === highlightId ? '' : undefined,
});
