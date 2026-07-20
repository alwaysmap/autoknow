'use client';

import { useEffect, useRef, useState } from 'react';
import { Gauge, VB_X, VB_Y, VB_W, VB_H } from './NeedleGaugeSvg';
import styles from './InstrumentGauge.module.css';

// The Instrument style's one graphic: the app's OWN gauge, at glyph size, on the
// primary CTA button. Never on a text input — an instrument is an affordance, and
// affordances belong on the thing you press.
//
// The needle is drawn by the SAME `needlePath` the draggable control uses, at a
// progress this component animates. It is NOT a CSS rotation of a static path:
// rotating about an assumed origin does not pivot where the real needle pivots,
// and it showed. Driving `progress` makes the geometry the real control's by
// construction — the needle sweeps the arc exactly as it does under a drag.

const REST = 0;
const SWEPT = 0.78; // short of full travel — a dial that pins reads as broken
const DURATION = 420;

/** Ease-out cubic: quick off the stop, settling into the reading. */
const ease = (t: number) => 1 - (1 - t) ** 3;

export default function InstrumentGauge({ active }: { active: boolean }) {
  const [progress, setProgress] = useState(REST);
  const frame = useRef<number | null>(null);
  // Where the needle actually is. Written only inside the animation frame — never
  // during render — so a fast hover-out-hover-in reverses from the current
  // position instead of snapping back to the stop first.
  const position = useRef(REST);

  useEffect(() => {
    const to = active ? SWEPT : REST;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const origin = position.current;
    const start = performance.now();
    // Everything happens inside the frame, including the reduced-motion jump:
    // setState in an effect BODY cascades renders, setState in a callback does not.
    const step = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / DURATION);
      const value = origin + (to - origin) * ease(t);
      position.current = value;
      setProgress(value);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [active]);

  return (
    <svg
      className={styles.gauge}
      viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* `transparent` suppresses the primitive's fill ribbon — a filled arc
          trailing the needle is a readout, and this dial reports nothing. The
          track and needle are inked from the button's own foreground in CSS, so
          the whole thing is monochrome and stays quiet at 18px. */}
      <Gauge progress={progress} color="transparent" />
    </svg>
  );
}
