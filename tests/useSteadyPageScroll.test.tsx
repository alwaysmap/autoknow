/** @jest-environment jsdom */
// The rule this guard exists for is one sentence — nothing moves the page under a
// pointer that is already down — and both halves of it are load-bearing, so both are
// proven here rather than left to the (necessarily timing-shaped) e2e case.
//
// Why it matters is in src/lib/useSteadyPageScroll.ts: a scroll frame landing between a
// press and its release makes the browser deliver `click` to a COMMON ANCESTOR instead of
// to the thing that was pressed, and nothing reports an error (autoknow-e1h).
import { renderHook } from '@testing-library/react';
import { useSteadyPageScroll } from '../src/lib/useSteadyPageScroll';

const press = () => window.dispatchEvent(new Event('pointerdown'));
const release = () => window.dispatchEvent(new Event('pointerup'));
// The coordinate-carrying forms, for the cases about a press that turns into a DRAG.
const pressAt = (clientX: number, clientY: number) =>
  window.dispatchEvent(new MouseEvent('pointerdown', { clientX, clientY }));
const moveTo = (clientX: number, clientY: number) =>
  window.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY }));
const frozen = () => ({ top: window.scrollY, left: window.scrollX, behavior: 'instant' });

describe('useSteadyPageScroll', () => {
  let scrollTo: jest.Mock;

  beforeEach(() => {
    scrollTo = jest.fn();
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, writable: true, configurable: true });
    release(); // no press outstanding from a previous case (the guard is module-scoped)
  });

  afterEach(() => release());

  it('scrolls normally when no pointer is down', () => {
    const { result } = renderHook(() => useSteadyPageScroll());
    const node = document.createElement('div');
    node.scrollIntoView = jest.fn();

    result.current(node, { behavior: 'smooth', block: 'start' });
    expect(node.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('refuses to start a scroll while a pointer is down', () => {
    const { result } = renderHook(() => useSteadyPageScroll());
    const node = document.createElement('div');
    node.scrollIntoView = jest.fn();

    press();
    result.current(node, { behavior: 'smooth' });
    expect(node.scrollIntoView).not.toHaveBeenCalled();

    // …and takes the placement again once the press is over.
    release();
    result.current(node, { behavior: 'smooth' });
    expect(node.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('stops page motion already under way on the press itself', () => {
    renderHook(() => useSteadyPageScroll());
    window.scrollY = 300;

    press();

    // The OBJECT form matters: scrollTo(x, y) takes its behaviour from CSS, which is
    // `smooth` here — it would start a fresh animation instead of freezing this one.
    expect(scrollTo).toHaveBeenCalledWith({ top: 300, left: window.scrollX, behavior: 'instant' });
  });

  // The half that autoknow-dxa cost: halting ONCE is not halting. Blink applies the
  // instant scroll at once and still lets the animation it was cancelling commit one more
  // step a frame later — measured at 8px to 102px in Chromium 141 — which is ample to move
  // a title out from under a pointer. So the offset is re-asserted every frame the press
  // lasts, and a test that only checked the first call would have passed the broken guard.
  it('keeps re-asserting the frozen offset while the press lasts', () => {
    jest.useFakeTimers();
    try {
      renderHook(() => useSteadyPageScroll());
      window.scrollY = 300;

      press();
      expect(scrollTo).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(64); // several animation frames
      expect(scrollTo.mock.calls.length).toBeGreaterThan(1);
      expect(scrollTo).toHaveBeenLastCalledWith(frozen());

      // …and it lets go the moment the press ends, rather than holding the page hostage.
      release();
      const settled = scrollTo.mock.calls.length;
      jest.advanceTimersByTime(200);
      expect(scrollTo).toHaveBeenCalledTimes(settled);
    } finally {
      jest.useRealTimers();
    }
  });

  // A pin that outlived the click would break the page for a DRAG — a text selection
  // pulled to the edge autoscrolls, and that must still work. Travel past the slop is
  // what says "this is no longer a click", so the page goes back to the reader there.
  it('lets go of the page once the pointer has travelled, because that is a drag', () => {
    jest.useFakeTimers();
    try {
      renderHook(() => useSteadyPageScroll());
      window.scrollY = 300;

      pressAt(100, 100);
      moveTo(101, 102); // inside the slop: still a click, still pinned
      jest.advanceTimersByTime(32);
      const pinned = scrollTo.mock.calls.length;
      expect(pinned).toBeGreaterThan(1);

      moveTo(100, 140); // travelled: a drag
      jest.advanceTimersByTime(200);
      expect(scrollTo).toHaveBeenCalledTimes(pinned);

      // The press is still a press, though — placement stays refused until the release.
      const node = document.createElement('div');
      node.scrollIntoView = jest.fn();
      renderHook(() => useSteadyPageScroll()).result.current(node);
      expect(node.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats a cancelled or window-losing press as released, so placement is never stuck off', () => {
    const { result } = renderHook(() => useSteadyPageScroll());
    const node = document.createElement('div');
    node.scrollIntoView = jest.fn();

    press();
    window.dispatchEvent(new Event('pointercancel'));
    result.current(node);
    expect(node.scrollIntoView).toHaveBeenCalledTimes(1);

    press();
    window.dispatchEvent(new Event('blur'));
    result.current(node);
    expect(node.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('ignores a nullish node, so a call site keeps the shape of the `?.` it replaced', () => {
    const { result } = renderHook(() => useSteadyPageScroll());
    expect(() => result.current(null)).not.toThrow();
    expect(() => result.current(undefined)).not.toThrow();
  });
});
