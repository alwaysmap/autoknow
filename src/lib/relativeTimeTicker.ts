'use client';

// A shared tick for every mounted `RelativeTime` (#171) — ONE `setInterval` for the
// whole page, not one per instance, so a program page with a dozen freshness stamps
// doesn't arm a dozen timers. Same shape as `lib/locationHash.ts`'s one-time-patch job:
// module-scope state, armed lazily on first subscribe.
//
// `now` doubles as the hydration-safe swap signal `RelativeTime` reads through
// `useSyncExternalStore`: 0 is what the SERVER (and the client's first, hydration-
// matching render) sees, so both render the same absolute string and there is no
// mismatch to warn about; the moment a component actually mounts on the client this
// becomes a real timestamp, which is what triggers the one-time swap to relative text
// — the same "render the default, then re-read the real value after mount" shape
// `ThemeToggle.tsx` uses for its stored preference, not a flash bug. `Date.now()` is
// read here (a subscribe callback / a timer, both real side-effect contexts) rather
// than inline in `RelativeTime`'s render, which the impure-render lint forbids.
const TICK_MS = 30_000;

let now = 0;
let started = false;
const listeners = new Set<() => void>();

function ensureStarted() {
  if (started || typeof window === 'undefined') return;
  started = true;
  now = Date.now();
  setInterval(() => {
    now = Date.now();
    listeners.forEach((listener) => listener());
  }, TICK_MS);
}

export function subscribeTick(onChange: () => void): () => void {
  ensureStarted();
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getTickNow(): number {
  return now;
}
