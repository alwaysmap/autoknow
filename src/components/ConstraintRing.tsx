import React from 'react';

// THE marker for "this is the current critical-chain step" — the one phase the
// whole SOP is waiting on. It appears on the rail's station, on the schedule
// chart's row, on the phase graph, and in both legends, and it has to read as the
// SAME object in every one of them, so the treatment lives here rather than as a
// magic <circle> repeated per surface (it had drifted already: r+4 with a 2px
// stroke on the rail, a fixed r=6 on the schedule chart, 1.8px in the legends).
//
// Bold, but still the app's chain purple: a soft halo widens the mark's footprint
// so it survives being one small ring among many dots, and a crisp ring over the
// top keeps the edge exact. Color comes from --chain (design.md §8b: never a
// literal, including inside SVG), so it re-inks with the theme.

/** Clearance between the marked dot's radius and the ring. */
export const CONSTRAINT_RING_GAP = 4;
/** Stroke of the crisp ring; the halo is drawn from this. */
export const CONSTRAINT_RING_WIDTH = 2.5;
/** Total radius the marker occupies around a dot of radius r — for layout padding. */
export const constraintRingRadius = (r: number) => r + CONSTRAINT_RING_GAP + CONSTRAINT_RING_WIDTH;

interface ConstraintRingProps {
  cx: number;
  cy: number;
  /** Radius of the dot being marked; the ring sits CONSTRAINT_RING_GAP outside it. */
  r: number;
  /**
   * Fill the interior with paper. The rail needs it so the track visibly
   * terminates at the station instead of passing through; overlaying a bar or a
   * label does not.
   */
  opaque?: boolean;
}

export default function ConstraintRing({ cx, cy, r, opaque = false }: ConstraintRingProps) {
  const ringR = r + CONSTRAINT_RING_GAP;
  return (
    <>
      {/* Halo first so the crisp ring lands on top of it. It carries the fill too:
          one element, so the paper can never sit above the ring. */}
      <circle
        cx={cx} cy={cy} r={ringR}
        fill={opaque ? 'var(--paper)' : 'none'}
        stroke="var(--chain)" strokeOpacity={0.22} strokeWidth={CONSTRAINT_RING_WIDTH * 2.8}
      />
      <circle
        cx={cx} cy={cy} r={ringR}
        fill="none" stroke="var(--chain)" strokeWidth={CONSTRAINT_RING_WIDTH}
      />
    </>
  );
}
