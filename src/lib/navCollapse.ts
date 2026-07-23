// Pure geometry for the priority-plus nav (#28). No DOM here: the NavLinks component
// measures the container's available width, each link's intrinsic width, and the ⋯
// trigger's width off the browser and hands them in; this decides how many leading
// links stay inline and, by implication, which ones fall into the overflow menu.
//
// Kept pure so every branch — everything fits, nothing fits, the ⋯ reserve pushes the
// last link out, one very wide (long-locale) label — is unit-tested deterministically
// (AGENTS lessons 2 & 7) rather than eyeballed once at one viewport in one language.
// The collapse point is therefore MEASURED per locale (the widths come from the real
// rendered labels), never assumed from English text.

export interface NavFitInput {
  /** Width available to the links region, px (the flexible middle, min-width:0). */
  available: number;
  /** Intrinsic width of each link in DOM order, px. */
  itemWidths: number[];
  /** Gap between adjacent items (and between the last link and the ⋯ trigger), px. */
  gap: number;
  /** Width of the ⋯ overflow trigger, px — reserved only when there IS overflow. */
  overflowWidth: number;
}

/**
 * How many leading links fit inline. Returns a count in `[0, itemWidths.length]`.
 *
 * - If every link fits without an overflow menu, returns them all (no ⋯ shown).
 * - Otherwise reserves room for the ⋯ trigger and returns the largest number of
 *   leading links that still leave space for it — so the ⋯ is never itself clipped.
 * - Zero is a valid answer (everything in the menu); so is a state where even the
 *   first link plus the ⋯ will not fit.
 *
 * `available <= 0` means "not measured yet" and yields the full count, matching the
 * component's server/resting state (all links rendered) so nothing is ever hidden by
 * a measurement that has not happened — the §8c guarantee, in the pure layer.
 */
export function fitCount({ available, itemWidths, gap, overflowWidth }: NavFitInput): number {
  const n = itemWidths.length;
  if (n === 0) return 0;
  // Unmeasured: show everything. The observer has not reported a width, so collapsing
  // would be guessing — and an empty/hidden nav is the failure §8c exists to prevent.
  if (!Number.isFinite(available) || available <= 0) return n;

  // Everything fits with no overflow menu at all → no ⋯, show them all.
  const total = itemWidths.reduce((sum, w) => sum + w, 0) + gap * (n - 1);
  if (total <= available) return n;

  // There will be overflow, so every inline link must leave room for the ⋯ after it.
  let used = 0;
  let k = 0;
  for (; k < n; k++) {
    const withItem = used + (k > 0 ? gap : 0) + itemWidths[k];
    if (withItem + gap + overflowWidth > available) break;
    used = withItem;
  }
  return k;
}
