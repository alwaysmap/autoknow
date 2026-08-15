/** @jest-environment jsdom */
// gh-268's scroll cues, and the subscription under them (autoknow-3nl). Both were inside
// `DataTable`'s ~400-line render function, so the only way to exercise them was to mount a
// whole table — which is why the two subtleties below had never been asserted at all.
//
// The 1px SLACK is the one worth a test: a scrollport that exactly fits can report a
// fractional scrollWidth/clientWidth mismatch from subpixel layout, and without the slack
// that paints a permanent cue on a table nobody can scroll. It is invisible in review and
// obvious on screen, which is the combination that earns a pin.
import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useElementObserver } from '../src/lib/useElementObserver';
import { useHorizontalScrollCues } from '../src/lib/useHorizontalScrollCues';

/** A scrollport with settable geometry — jsdom lays nothing out, so the numbers ARE the
 *  fixture. `scrollLeft` is a real own-property so a test can move it. */
function scrollportRef(geometry: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: geometry.clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollWidth', { value: geometry.scrollWidth, configurable: true });
  el.scrollLeft = geometry.scrollLeft;
  document.body.appendChild(el);
  const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
  ref.current = el;
  return { ref, el };
}

describe('useHorizontalScrollCues', () => {
  it('reports nothing off-screen when the content fits', () => {
    const { ref } = scrollportRef({ scrollLeft: 0, clientWidth: 800, scrollWidth: 800 });
    const { result } = renderHook(() => useHorizontalScrollCues(ref));
    expect(result.current).toEqual({ canScrollLeft: false, canScrollRight: false });
  });

  it('reports more to the right at the start of a wide table, and more to the left at its end', () => {
    const { ref, el } = scrollportRef({ scrollLeft: 0, clientWidth: 800, scrollWidth: 1600 });
    const { result } = renderHook(() => useHorizontalScrollCues(ref));
    expect(result.current).toEqual({ canScrollLeft: false, canScrollRight: true });

    act(() => {
      el.scrollLeft = 800; // scrolled fully right
      el.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toEqual({ canScrollLeft: true, canScrollRight: false });
  });

  it('tolerates a sub-pixel overflow rather than showing a cue nobody can act on', () => {
    // The subpixel case: 0.6px wider than the port, which no scroll can reach.
    const { ref } = scrollportRef({ scrollLeft: 0, clientWidth: 800, scrollWidth: 800.6 });
    const { result } = renderHook(() => useHorizontalScrollCues(ref));
    expect(result.current.canScrollRight).toBe(false);

    // …and a real overflow still reads, so the slack is not just "always false".
    const real = scrollportRef({ scrollLeft: 0, clientWidth: 800, scrollWidth: 802 });
    const { result: r2 } = renderHook(() => useHorizontalScrollCues(real.ref));
    expect(r2.current.canScrollRight).toBe(true);
  });
});

describe('useElementObserver', () => {
  it('wires resize always, and scroll only when asked', () => {
    const { ref, el } = scrollportRef({ scrollLeft: 0, clientWidth: 10, scrollWidth: 10 });
    const onChange = jest.fn();

    const { result } = renderHook(() => useElementObserver(ref, { scroll: false }));
    const stop = result.current(onChange);

    el.dispatchEvent(new Event('scroll'));
    expect(onChange).not.toHaveBeenCalled(); // not subscribed to scroll
    window.dispatchEvent(new Event('resize'));
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    window.dispatchEvent(new Event('resize'));
    expect(onChange).toHaveBeenCalledTimes(1); // cleanup undoes what it wired
  });

  it('unsubscribes the element scroll listener too, not just the window one', () => {
    // The asymmetric-cleanup bug a hand-rolled copy makes: wire two, remove one.
    const { ref, el } = scrollportRef({ scrollLeft: 0, clientWidth: 10, scrollWidth: 10 });
    const onChange = jest.fn();
    const { result } = renderHook(() => useElementObserver(ref, { scroll: true }));
    const stop = result.current(onChange);

    el.dispatchEvent(new Event('scroll'));
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    el.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
