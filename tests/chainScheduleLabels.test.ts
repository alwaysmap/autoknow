/** @jest-environment node */
// The chart's labels must never overlap — an overlapping label is useless (user call).
// keepNonOverlapping is the shared 2D de-collider behind the axis (break vs month letters)
// and the buffer lane (y-axis values / reserve / start / risers / now). This locks it.
import { keepNonOverlapping, PlacedLabel } from '../src/lib/labelPlacement';

/** No two KEPT labels' boxes may overlap in BOTH axes — the property that matters. */
function noKeptOverlap(labels: PlacedLabel[], keep: boolean[]): boolean {
  const kept = labels.filter((_, i) => keep[i]);
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i], b = kept[j];
      if (Math.abs(a.x - b.x) < a.halfW + b.halfW && Math.abs(a.y - b.y) < a.halfH + b.halfH) return false;
    }
  }
  return true;
}
const L = (x: number, y: number, halfW: number, priority: number): PlacedLabel => ({ x, y, halfW, halfH: 6, priority });

describe('keepNonOverlapping — 2D, labels never overlap, priority wins the slot', () => {
  it('keeps everything when nothing overlaps', () => {
    const labels = [L(10, 0, 4, 1), L(30, 0, 4, 1), L(50, 0, 4, 1)];
    expect(keepNonOverlapping(labels)).toEqual([true, true, true]);
  });

  it('close in x but far in y do NOT collide (2D)', () => {
    // a y-axis value on the left and a lane level label — near the same x, different y
    const labels = [L(20, 10, 8, 1), L(22, 60, 8, 1)];
    expect(keepNonOverlapping(labels)).toEqual([true, true]);
  });

  it('drops the lower-priority label when two collide in both axes', () => {
    const labels = [L(100, 20, 20, 1), L(108, 22, 20, 2)]; // month letter yields to the break duration
    const keep = keepNonOverlapping(labels);
    expect(keep).toEqual([false, true]);
    expect(noKeptOverlap(labels, keep)).toBe(true);
  });

  it('collapses a same-spot cluster to one label (the stacked-buffer-labels bug)', () => {
    const labels = [L(50, 30, 12, 2), L(52, 30, 12, 1), L(51, 30, 16, 3)]; // start / riser / now
    const keep = keepNonOverlapping(labels);
    expect(keep).toEqual([false, false, true]); // now (priority 3) wins
    expect(noKeptOverlap(labels, keep)).toBe(true);
  });

  it('the now label vs the reserve label — one yields (the reported lane collision)', () => {
    const labels = [
      L(300, 40, 26, 2),  // 45d reserve, right edge
      L(300, 44, 30, 3),  // 40d buffer (now), same spot, higher priority
    ];
    const keep = keepNonOverlapping(labels);
    expect(keep).toEqual([false, true]);
    expect(noKeptOverlap(labels, keep)).toBe(true);
  });

  it('never yields an overlapping pair, across a messy 2D mix', () => {
    const labels = Array.from({ length: 60 }, (_, i) =>
      L((i % 9) * 14 + (i % 3) * 5, (i % 4) * 12, 5 + (i % 4), i % 3));
    expect(noKeptOverlap(labels, keepNonOverlapping(labels))).toBe(true);
  });
});
