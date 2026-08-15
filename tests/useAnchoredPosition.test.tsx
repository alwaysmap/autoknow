/** @jest-environment jsdom */
// The BROWSER half of anchored placement (autoknow-9yx). `tests/anchoredPosition.test.ts`
// proves the pure math; this proves the part that reads the DOM and writes back, which is
// where the two hand-rolled copies differed and where a drift would be silent.
//
// The contract worth pinning is `matchTriggerWidth` — see the hook for why the widened
// width has to reach the positioner and not only the style. Asserting `style.minWidth`
// alone would pass straight over that bug, so these read the LEFT the hook computed.
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useAnchoredPosition } from '../src/lib/useAnchoredPosition';

const MARGIN = 8;
const GAP = 2; // the positioner's own breathing room between trigger and panel

/** A trigger at a given rect, and a panel of a given rendered size. */
function refsFor(trigger: { left: number; top: number; width: number; height: number }, panelWidth: number) {
  const triggerEl = document.createElement('button');
  triggerEl.getBoundingClientRect = () => ({
    left: trigger.left,
    right: trigger.left + trigger.width,
    top: trigger.top,
    bottom: trigger.top + trigger.height,
    width: trigger.width,
    height: trigger.height,
    x: trigger.left,
    y: trigger.top,
    toJSON: () => ({}),
  }) as DOMRect;

  const panelEl = document.createElement('div');
  Object.defineProperty(panelEl, 'offsetWidth', { value: panelWidth, configurable: true });
  Object.defineProperty(panelEl, 'offsetHeight', { value: 100, configurable: true });

  const triggerRef = createRef<HTMLElement>() as { current: HTMLElement | null };
  const panelRef = createRef<HTMLElement>() as { current: HTMLElement | null };
  triggerRef.current = triggerEl;
  panelRef.current = panelEl;
  return { triggerRef, panelRef, panelEl };
}

beforeAll(() => {
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 1000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});

describe('useAnchoredPosition', () => {
  it('places the panel under its trigger while active', () => {
    const { triggerRef, panelRef, panelEl } = refsFor({ left: 100, top: 50, width: 200, height: 30 }, 200);
    renderHook(() => useAnchoredPosition(triggerRef, panelRef, { active: true }));
    expect(panelEl.style.left).toBe('100px');
    expect(panelEl.style.top).toBe(`${50 + 30 + GAP}px`); // just under the trigger's bottom
  });

  it('does nothing while inactive — a closed panel is not repositioned', () => {
    const { triggerRef, panelRef, panelEl } = refsFor({ left: 100, top: 50, width: 200, height: 30 }, 200);
    renderHook(() => useAnchoredPosition(triggerRef, panelRef, { active: false }));
    expect(panelEl.style.left).toBe('');
  });

  it('matchTriggerWidth widens the panel AND clamps on the widened box', () => {
    // A 300px-wide trigger near the right edge, whose panel renders at only 120px. With
    // the width honoured, the box is 300 wide and must clamp to 1000 - 300 - 8 = 692.
    const { triggerRef, panelRef, panelEl } = refsFor({ left: 850, top: 50, width: 300, height: 30 }, 120);
    renderHook(() => useAnchoredPosition(triggerRef, panelRef, { active: true, matchTriggerWidth: true }));
    expect(panelEl.style.minWidth).toBe('300px');
    expect(panelEl.style.left).toBe(`${1000 - 300 - MARGIN}px`);
  });

  it('without matchTriggerWidth the same panel does NOT clamp — the contrast is the point', () => {
    // Identical trigger, identical rendered panel: only the option differs. At its own
    // 120px the box fits at x=850 and is left alone, so the clamp above is attributable
    // to the widened width reaching the positioner and to nothing else.
    const { triggerRef, panelRef, panelEl } = refsFor({ left: 850, top: 50, width: 300, height: 30 }, 120);
    renderHook(() => useAnchoredPosition(triggerRef, panelRef, { active: true }));
    expect(panelEl.style.minWidth).toBe('');
    expect(panelEl.style.left).toBe('850px');
  });

  it('re-places when a dep changes — a filtered list is shorter than the one before it', () => {
    const { triggerRef, panelRef, panelEl } = refsFor({ left: 100, top: 700, width: 200, height: 30 }, 200);
    const { rerender } = renderHook(
      ({ q }: { q: string }) => useAnchoredPosition(triggerRef, panelRef, { active: true, deps: [q] }),
      { initialProps: { q: '' } },
    );
    // 100 tall under a trigger ending at 730 overflows 800, so it flips above the trigger.
    expect(panelEl.style.top).toBe(`${700 - GAP - 100}px`);

    Object.defineProperty(panelRef.current!, 'offsetHeight', { value: 40, configurable: true });
    rerender({ q: 'vol' });
    // Now it fits below, and the placement must follow the new height rather than persist.
    expect(panelEl.style.top).toBe(`${730 + GAP}px`);
  });
});
