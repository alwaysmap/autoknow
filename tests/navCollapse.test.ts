// #28: the priority-plus collapse point is pure, so every branch a wrapping nav used to
// get "for free" (and wrong) — how many links fit, when the ⋯ reserve pushes one out,
// what a long-locale label does, the zero-and-full end states — is proven here rather
// than eyeballed at one width in English. The component only reads rects and calls this.
import { fitCount } from '../src/lib/navCollapse';

// Five links, each 80px wide, 16px gap, a 32px ⋯ trigger — the shape of the real nav.
const WIDTHS = [80, 80, 80, 80, 80];
const GAP = 16;
const MORE = 32;

describe('fitCount (#28)', () => {
  it('shows every link when they all fit, with no ⋯ reserved', () => {
    // 5×80 + 4×16 = 464 — give it exactly that.
    expect(fitCount({ available: 464, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(5);
  });

  it('shows every link when there is abundant room', () => {
    expect(fitCount({ available: 2000, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(5);
  });

  it('one pixel short of the full row collapses the trailing link into the menu', () => {
    // 463 < 464, so not all 5 fit. Reserve the ⋯ (gap+32=48) after the last inline link.
    // 4 links = 4×80 + 3×16 = 368; + 48 reserve = 416 ≤ 463 ✓. A 5th cannot (that's the
    // no-overflow case we just excluded), so 4 inline + 1 in the menu.
    expect(fitCount({ available: 463, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(4);
  });

  it('the ⋯ reserve — not the link itself — is what pushes the last one out', () => {
    // 3 inline = 3×80 + 2×16 = 272. A 4th would be 272 + 16 + 80 = 368, and the 4th is
    // NOT the last (5 total) so it also needs the ⋯: 368 + 48 = 416. Give 400: the 4th's
    // own width fits (368 ≤ 400) but the ⋯ after it does not (416 > 400) → stop at 3.
    expect(fitCount({ available: 400, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(3);
  });

  it('a wide long-locale label collapses the nav sooner than the English width would', () => {
    // Same 400px slot, but the labels are wider (German/Korean run longer). 3 no longer
    // fit, proving the count is driven by the measured widths, not an assumed English one.
    const wide = [120, 120, 120, 120, 120];
    expect(fitCount({ available: 400, itemWidths: wide, gap: GAP, overflowWidth: MORE })).toBe(2);
  });

  it('collapses everything into the menu when even the first link plus ⋯ will not fit', () => {
    expect(fitCount({ available: 60, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(0);
  });

  it('shows just the first link when it fits alongside the ⋯ but a second does not', () => {
    // 1 inline + ⋯ = 80 + 16 + 32 = 128 ≤ 130 ✓. A 2nd = 80+16+80=176 +48 = 224 > 130 ✗.
    expect(fitCount({ available: 130, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(1);
  });

  it('treats an unmeasured (zero / non-finite) width as "show them all" — the resting state', () => {
    expect(fitCount({ available: 0, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(5);
    expect(fitCount({ available: -1, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(5);
    expect(fitCount({ available: Infinity, itemWidths: WIDTHS, gap: GAP, overflowWidth: MORE })).toBe(5);
  });

  it('returns 0 for an empty link set', () => {
    expect(fitCount({ available: 500, itemWidths: [], gap: GAP, overflowWidth: MORE })).toBe(0);
  });

  it('a single link that fits on its own needs no overflow menu', () => {
    expect(fitCount({ available: 100, itemWidths: [80], gap: GAP, overflowWidth: MORE })).toBe(1);
  });
});
