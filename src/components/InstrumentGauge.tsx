'use client';

import { Gauge, VB_X, VB_Y, VB_W, VB_H } from './NeedleGaugeSvg';
import styles from './InstrumentGauge.module.css';

// The Instrument style's motif: the app's OWN gauge, at glyph size, rather than a
// shape drawn to look like one. The previous version was a CSS gradient bar that
// swept on focus — it read as a progress bar wearing a costume, because it was.
// This is the real `Gauge` primitive with the real track, graticules and needle.
//
// Colour is the only thing that changes: the dial is monochrome except for the
// redline at the top of the track's travel, and the needle is plain ink so it
// reads at 20px. Nothing about the gauge's shape or
// mechanics is altered — the needle swings because CSS rotates it about the arc's
// own centre, using the same CX/CY the path generator uses.

// No fill ribbon: this dial reports nothing, it just IS the instrument. The
// redline therefore has to live on the track outline — which is where a real
// dial puts it anyway — rather than on a fill that would span 6% of the arc and
// show none of the gradient.
const REST = 0;

export default function InstrumentGauge({ title }: { title?: string }) {
  return (
    <svg
      className={styles.gauge}
      viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
      aria-hidden="true"
      focusable="false"
    >
      {title && <title>{title}</title>}
      <defs>
        {/* Left-to-right across the gauge's bounding box, so the arc picks the
            gradient up along its sweep rather than radially. */}
        <linearGradient id="instrument-dial" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--muted)" stopOpacity="0.55" />
          <stop offset="70%" stopColor="var(--muted)" stopOpacity="0.85" />
          <stop offset="88%" stopColor="var(--redline)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--redline)" />
        </linearGradient>
      </defs>
      <Gauge
        progress={REST}
        color="transparent"
        trackStroke="url(#instrument-dial)"
        needleColor="var(--fg)"
      />
    </svg>
  );
}
