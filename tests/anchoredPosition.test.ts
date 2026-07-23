// #24: the anchored-popover placement is pure, so every branch that a hand-rolled menu
// got wrong — opening off-screen, never flipping, never clamping — is proven here rather
// than eyeballed once. The two real regressions (⋯ beside a heading, rightmost column
// filter) are the "clamp right so it never leaves the viewport" cases below.
import { anchoredPosition, clamp, rovingIndex } from '../src/lib/anchoredPosition';

const VIEWPORT = { width: 1000, height: 800 };
// a small trigger near the top-left, room below and to the right
const TRIGGER = { top: 100, right: 140, bottom: 120, left: 100 };
const PANEL = { width: 150, height: 200 };

describe('anchoredPosition (#24)', () => {
  it('opens below the trigger, left edge aligned, when there is room', () => {
    expect(anchoredPosition({ trigger: TRIGGER, panel: PANEL, viewport: VIEWPORT })).toEqual({
      left: 100, // trigger.left
      top: 122, // trigger.bottom + gap(2)
    });
  });

  it("align='end' hangs the panel's right edge off the trigger's right edge", () => {
    expect(
      anchoredPosition({ trigger: TRIGGER, panel: PANEL, viewport: VIEWPORT, align: 'end' }).left,
    ).toBe(140 - 150 < 8 ? 8 : 140 - 150); // trigger.right - panel.width, then clamped to margin
    // 140 - 150 = -10 → clamped to the left margin
    expect(
      anchoredPosition({ trigger: TRIGGER, panel: PANEL, viewport: VIEWPORT, align: 'end' }).left,
    ).toBe(8);
  });

  it('clamps to the left margin when the trigger sits at the very edge (⋯ beside a heading)', () => {
    const edge = { top: 100, right: 20, bottom: 120, left: 4 };
    expect(anchoredPosition({ trigger: edge, panel: PANEL, viewport: VIEWPORT }).left).toBe(8);
  });

  it('clamps to the right margin instead of overflowing (rightmost column filter)', () => {
    // trigger hard against the right edge; left-aligned panel would run off-screen
    const rightEdge = { top: 100, right: 998, bottom: 120, left: 960 };
    const { left } = anchoredPosition({ trigger: rightEdge, panel: PANEL, viewport: VIEWPORT });
    expect(left).toBe(VIEWPORT.width - 8 - PANEL.width); // 1000 - 8 - 150 = 842
    expect(left + PANEL.width).toBeLessThanOrEqual(VIEWPORT.width - 8);
  });

  it('flips ABOVE when below overflows and above has more room', () => {
    // trigger low on the page: only 60px below, ~700px above
    const low = { top: 720, right: 140, bottom: 740, left: 100 };
    const { top } = anchoredPosition({ trigger: low, panel: PANEL, viewport: VIEWPORT });
    expect(top).toBe(720 - 2 - 200); // trigger.top - gap - panel.height = 518
  });

  it('stays below (clamped) when below overflows but above has even less room', () => {
    // trigger high but panel taller than the room below; above is smaller still
    const tall = { top: 30, right: 140, bottom: 50, left: 100 };
    const bigPanel = { width: 150, height: 780 };
    const { top } = anchoredPosition({ trigger: tall, panel: bigPanel, viewport: VIEWPORT });
    // does not flip (roomAbove 22 < roomBelow 750); clamps to keep the bottom in view
    expect(top).toBe(VIEWPORT.height - 8 - bigPanel.height); // 800 - 8 - 780 = 12
  });

  it('pins to the top margin when the panel is taller than the viewport', () => {
    const huge = { width: 150, height: 2000 };
    const { top } = anchoredPosition({ trigger: TRIGGER, panel: huge, viewport: VIEWPORT });
    expect(top).toBe(8); // inverted clamp range → low edge (margin) wins
  });

  it('respects a custom margin and gap', () => {
    const { left, top } = anchoredPosition({
      trigger: TRIGGER, panel: PANEL, viewport: VIEWPORT, margin: 16, gap: 6,
    });
    expect(left).toBe(100);
    expect(top).toBe(126); // trigger.bottom + gap(6)
  });
});

describe('clamp', () => {
  it('returns the value inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('pins to the bounds outside the range', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
  it('low edge wins when the range is inverted', () => {
    expect(clamp(5, 10, 0)).toBe(10);
  });
});

describe('rovingIndex', () => {
  it('advances and wraps at the end', () => {
    expect(rovingIndex(2, 1, 3)).toBe(0);
    expect(rovingIndex(1, 1, 3)).toBe(2);
  });
  it('retreats and wraps at the start', () => {
    expect(rovingIndex(0, -1, 3)).toBe(2);
  });
  it('returns -1 for an empty list', () => {
    expect(rovingIndex(0, 1, 0)).toBe(-1);
  });
});
