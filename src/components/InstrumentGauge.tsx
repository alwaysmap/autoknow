'use client';

import { Gauge, VB_X, VB_Y, VB_W, VB_H } from './NeedleGaugeSvg';
import { useSettle } from '../lib/useSettle';
import styles from './InstrumentGauge.module.css';

// The Instrument style's one graphic: the app's OWN gauge, at glyph size, on the
// primary CTA button. Never on a text input — an instrument is an affordance, and
// affordances belong on the thing you press.
//
// The needle is drawn by the SAME `needlePath` the draggable control uses, at a
// progress `useSettle` animates. It is NOT a CSS rotation of a static path:
// rotating about an assumed origin does not pivot where the real needle pivots,
// and it showed. Driving `progress` makes the geometry the real control's by
// construction — the needle sweeps the arc exactly as it does under a drag.

const SWEPT = 0.78; // short of full travel — a dial that pins reads as broken

export default function InstrumentGauge({ active }: { active: boolean }) {
  const progress = useSettle(active ? SWEPT : 0);

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
