/** @jest-environment jsdom */
// #40: Next's App Router <Link> navigates via history.pushState, which does NOT
// fire `hashchange` — so an opener that only listens for `hashchange` never reacts
// to a same-page link, and the popover it points at never opens. subscribeLocationChange
// closes that gap by patching pushState/replaceState to emit, on top of hashchange.
import { subscribeLocationChange } from '../src/lib/locationHash';

describe('subscribeLocationChange (#40)', () => {
  it('fires on history.pushState — the path Next <Link> takes, which hashchange misses', () => {
    const cb = jest.fn();
    const off = subscribeLocationChange(cb);
    history.pushState(null, '', '/programs/11#phase-72-detail');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('fires on history.replaceState', () => {
    const cb = jest.fn();
    const off = subscribeLocationChange(cb);
    history.replaceState(null, '', '/programs/11#status-history');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('still fires on native hashchange (plain <a>, back/forward)', () => {
    const cb = jest.fn();
    const off = subscribeLocationChange(cb);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('stops after unsubscribe', () => {
    const cb = jest.fn();
    const off = subscribeLocationChange(cb);
    off();
    history.pushState(null, '', '/x');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('patches history only once even across many subscribers', () => {
    // Two subscribers, one pushState → each fires exactly once (no double-patch stacking).
    const a = jest.fn();
    const b = jest.fn();
    const offA = subscribeLocationChange(a);
    const offB = subscribeLocationChange(b);
    history.pushState(null, '', '/y');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});
