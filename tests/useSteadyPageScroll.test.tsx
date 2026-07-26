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
