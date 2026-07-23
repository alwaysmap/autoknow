/** @jest-environment node */
// The chart's labels must never overlap — an overlapping label is useless (user call).
// keepNonOverlapping is the shared de-collider behind the axis (break vs month letters)
// and the buffer lane (start / risers / now). This locks its contract.
import { keepNonOverlapping } from '../src/lib/labelPlacement';

/** No two KEPT labels' [x±half] ranges may overlap — the property that matters. */
function noKeptOverlap(labels: { x: number; half: number; priority: number }[], keep: boolean[]): boolean {
  const kept = labels.filter((_, i) => keep[i]).sort((a, b) => a.x - b.x);
  for (let i = 1; i < kept.length; i++) {
    if (kept[i].x - kept[i].half < kept[i - 1].x + kept[i - 1].half) return false;
  }
  return true;
}

describe('keepNonOverlapping — labels never overlap, priority wins the slot', () => {
  it('keeps everything when nothing overlaps', () => {
    const labels = [
      { x: 10, half: 4, priority: 1 },
      { x: 30, half: 4, priority: 1 },
      { x: 50, half: 4, priority: 1 },
    ];
    expect(keepNonOverlapping(labels)).toEqual([true, true, true]);
  });

  it('drops the lower-priority label when two collide', () => {
    // a break duration (priority 2) and a month letter (priority 1) at nearly the same x
    const labels = [
      { x: 100, half: 20, priority: 1 }, // month letter — yields
      { x: 108, half: 20, priority: 2 }, // break duration — wins
    ];
    const keep = keepNonOverlapping(labels);
    expect(keep).toEqual([false, true]);
    expect(noKeptOverlap(labels, keep)).toBe(true);
  });

  it('collapses a whole cluster to one label (the stacked-buffer-labels bug)', () => {
    // start + an early riser + now all at ~the same x (an unstarted program): only the
    // highest-priority survives, so nothing stacks.
    const labels = [
      { x: 50, half: 12, priority: 2 }, // start
      { x: 52, half: 12, priority: 1 }, // riser
      { x: 51, half: 16, priority: 3 }, // now — highest priority
    ];
    const keep = keepNonOverlapping(labels);
    expect(keep).toEqual([false, false, true]);
    expect(noKeptOverlap(labels, keep)).toBe(true);
  });

  it('never yields an overlapping pair, across a messy mix', () => {
    const labels = Array.from({ length: 40 }, (_, i) => ({
      x: (i % 7) * 15 + (i % 3) * 4, // deliberately clustered
      half: 5 + (i % 4),
      priority: i % 3,
    }));
    expect(noKeptOverlap(labels, keepNonOverlapping(labels))).toBe(true);
  });
});
