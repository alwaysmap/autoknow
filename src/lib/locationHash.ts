'use client';

// The hash is app STATE here: `/programs/:id#phase-:id-detail` and
// `#status-history` open a popover (design.md §5/§4b), and openers listen for
// `hashchange` to react. But Next's App Router `<Link>` navigates via
// `history.pushState`, and **pushState does NOT fire `hashchange`** — so a
// same-page link updates the URL and the popover it points at never opens (#40).
//
// Patch pushState/replaceState ONCE to emit a synthetic event, and expose a single
// subscribe() that fires on BOTH that and native `hashchange` (plain `<a>`,
// back/forward). Every hash-as-state opener uses this instead of a bare
// `hashchange` listener, so a new one is correct by construction (AGENTS lesson 7).

const LOCATION_EVENT = 'autoknow:locationchange';
let patched = false;

function ensurePatched() {
  if (patched || typeof window === 'undefined') return;
  patched = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      // After the URL actually changes, notify. Next's own navigations flow through
      // here too, which is exactly what makes a <Link> to a fragment observable.
      window.dispatchEvent(new Event(LOCATION_EVENT));
      return result;
    } as History[typeof method];
  }
}

/**
 * Subscribe to every navigation that can change the location hash:
 * `pushState`/`replaceState` (Next `<Link>`) and native `hashchange` (plain
 * `<a>`, back/forward). Call `onChange` after subscribing if you also need the
 * initial value. Returns an unsubscribe.
 */
export function subscribeLocationChange(onChange: () => void): () => void {
  ensurePatched();
  window.addEventListener(LOCATION_EVENT, onChange);
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener(LOCATION_EVENT, onChange);
    window.removeEventListener('hashchange', onChange);
  };
}
