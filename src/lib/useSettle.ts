'use client';

import { useEffect, useRef, useState } from 'react';

// THE motion primitive for the Instrument style, and deliberately the only one.
//
// One idea: **an instrument settles.** A reading sweeps from its stop to its
// value once, quickly, easing out — the way a needle does when the key turns and
// the way a dial band swings across when a station locks. Everything that moves
// in this app moves this way, so motion reads as one behaviour rather than as a
// collection of effects.
//
// Interaction-driven motion only — the CTA dial settling on hover. REVEAL motion
// (the schedule's buffer bands sweeping out on arrival) is a CSS animation
// instead, deliberately: a reveal implemented in JS gates the data on an effect
// firing, and the first version of this file did exactly that — an observer that
// never delivered a callback left the chart with no visible bands at all. CSS
// animates from a state the element already has, so it cannot hide anything.
//
// It refuses to run when the OS asks for reduced motion — it jumps to the value
// instead, because the VALUE is the information and the sweep is only manners.

const DURATION = 420;

/** Ease-out cubic: quick off the stop, settling into the reading. */
const ease = (t: number) => 1 - (1 - t) ** 3;

// Optional-chained: an environment without matchMedia (jsdom, some edge runtimes)
// must degrade to "animate normally", never crash the component that renders this.
const prefersReduced = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false);

/**
 * Animates towards `target`, resuming from wherever it currently is — so a fast
 * hover-out-hover-in reverses rather than snapping back to the stop first.
 */
export function useSettle(target: number, duration = DURATION): number {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);
  // Written ONLY inside the animation frame; reading or writing a ref during
  // render is a lint error here, and was a real cascading-render bug once.
  const position = useRef(0);

  useEffect(() => {
    const origin = position.current;
    const reduce = prefersReduced();
    const start = performance.now();
    // Everything, including the reduced-motion jump, happens in the callback:
    // setState in an effect BODY cascades renders.
    const step = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / duration);
      const next = origin + (target - origin) * ease(t);
      position.current = next;
      setValue(next);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [target, duration]);

  return value;
}

