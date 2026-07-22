'use client';

import { useEffect, useState } from 'react';
import { Gauge, VB_X, VB_Y, VB_W, VB_H } from './NeedleGaugeSvg';
import { useSettle, usePrefersReducedMotion } from '../lib/useSettle';
import styles from './InstrumentGauge.module.css';

// The Instrument style's one graphic: the app's OWN gauge, at glyph size, riding
// the trailing edge of the search field.
//
// It is a READOUT of the search, not an affordance on a button (2026-07-22, user
// call — the hero's separate Search button is gone, and the dial took its place
// inside the field). The needle rests while nothing is running and hunts while a
// query is in flight. That is strictly more honest than the hover it replaced: a
// dial reporting the mouse reports nothing about the machine.
//
// The needle is drawn by the SAME `needlePath` the draggable control uses, at a
// progress `useSettle` animates. It is NOT a CSS rotation of a static path:
// rotating about an assumed origin does not pivot where the real needle pivots,
// and it showed. Driving `progress` makes the geometry the real control's by
// construction — the needle sweeps the arc exactly as it does under a drag.
//
// The hunt is not a fourth motion idea (design.md §8c). It is the ONE idea — an
// instrument settles — repeated: a needle with no reading yet swings between two
// stops looking for one, each leg the same ease-out as every other settle.

const SWEPT = 0.78; // short of full travel — a dial that pins reads as broken
const HUNTED = 0.3; // the hunt's low stop; never the rest stop, which reads as "done"
/** One leg. Longer than a settle (420ms), so each swing lands and holds a beat. */
const LEG_MS = 560;

/**
 * Flips once per leg while the dial is hunting. The interval is the ONLY writer —
 * a setState in an effect BODY cascades renders and is a lint error here — and
 * only the parity is read, so a resumed hunt picks up wherever the last stopped.
 */
function useHuntLeg(hunting: boolean): number {
  const [leg, setLeg] = useState(0);
  useEffect(() => {
    if (!hunting) return;
    const id = setInterval(() => setLeg((n) => n + 1), LEG_MS);
    return () => clearInterval(id);
  }, [hunting]);
  return leg;
}

export default function InstrumentGauge({ busy }: { busy: boolean }) {
  // A reader who asked for stillness still gets the FACT — needle off its stop
  // while the query runs — without the swing. Leaving it to `useSettle` would not
  // do: that degrades a settle by jumping, which turns a hunt into a needle
  // flicking between two stops forever.
  const still = usePrefersReducedMotion();
  const hunting = busy && !still;
  const leg = useHuntLeg(hunting);
  const progress = useSettle(busy ? (hunting && leg % 2 === 1 ? HUNTED : SWEPT) : 0);

  return (
    <svg
      className={styles.gauge}
      // Its ink brightens with the same state that moves it — the sweep and the
      // colour are one gesture. `|| undefined` so the attribute is ABSENT when
      // idle: `[data-busy]` in CSS matches `data-busy="false"` just as happily.
      data-busy={busy || undefined}
      viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* `transparent` suppresses the primitive's fill ribbon — a filled arc
          trailing the needle is a readout of a VALUE, and this dial reports a
          state. Every part tints from the one `currentColor` the module sets, so
          the whole thing is monochrome and stays quiet at 18px. */}
      <Gauge progress={progress} color="transparent" />
    </svg>
  );
}
