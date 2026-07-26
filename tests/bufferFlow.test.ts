/** @jest-environment node */
// The buffer flow's FRAME (issue #161, decision 3). The rule this locks is one
// sentence: the axis holds 0% and 100% AND everything the data reached. Clipping to
// a fixed 0–100% box is a lie at both ends, and the end that matters is the bottom —
// a blown buffer is real, and an axis that stops at zero hides exactly the program
// that needs looking at.
import { flowScale, blownAt } from '../src/lib/bufferFlow';
import type { BufferPoint } from '../src/lib/bufferSeries';

const pt = (ms: number, leftDays: number, b0: number, projected = false): BufferPoint =>
  ({ ms, leftDays, leftPct: (leftDays * 100) / b0, projected });

/** Every value the flow will draw at this scale is inside the frame. */
const holds = (s: { min: number; max: number }, vs: number[]) =>
  vs.every((v) => v > s.min && v < s.max);

describe('flowScale — derived from the data, never a fixed 0–100% box', () => {
  it('holds 0% and 100% even when the buffer never moves', () => {
    const s = flowScale([100, 100, 100]);
    expect(s.min).toBeLessThan(0);
    expect(s.max).toBeGreaterThan(100);
    expect(s.ticks).toContain(0);
    expect(s.ticks).toContain(100);
  });

  it('extends BELOW zero to hold a blown buffer', () => {
    const pcts = [100, 60, 10, -20, -47];
    const s = flowScale(pcts);
    expect(s.min).toBeLessThan(-47);
    expect(holds(s, pcts)).toBe(true);
  });

  it('extends ABOVE 100% when a phase hands back more than the program started with', () => {
    const pcts = [100, 118, 131];
    const s = flowScale(pcts);
    expect(s.max).toBeGreaterThan(131);
    expect(s.min).toBeLessThanOrEqual(0);
    expect(holds(s, pcts)).toBe(true);
  });

  it('holds both tails at once — handed back early, then blown', () => {
    const pcts = [100, 140, 60, -80];
    const s = flowScale(pcts);
    expect(holds(s, pcts)).toBe(true);
    expect(s.ticks).toEqual(expect.arrayContaining([0, 100]));
  });

  it('keeps the gridlines readable however wide the span gets', () => {
    // A stride that suits a calm program draws 40 lines through a blown one; the
    // stride widens instead, and 0 and 100 stay whatever it does.
    for (const pcts of [[100, 96], [100, 20], [100, -60], [100, -300], [100, 900]]) {
      const s = flowScale(pcts);
      expect(s.ticks.length).toBeGreaterThanOrEqual(2);
      expect(s.ticks.length).toBeLessThanOrEqual(9);
      expect(s.ticks).toContain(0);
      expect(s.ticks).toContain(100);
      expect(holds(s, pcts)).toBe(true);
      expect([...s.ticks].sort((a, b) => a - b)).toEqual(s.ticks); // ascending, as drawn
      expect(new Set(s.ticks).size).toBe(s.ticks.length); // and each line drawn once
    }
  });

  it('never places a tick outside the frame it describes', () => {
    const s = flowScale([100, -230, 15]);
    for (const v of s.ticks) {
      expect(v).toBeGreaterThanOrEqual(s.min);
      expect(v).toBeLessThanOrEqual(s.max);
    }
  });
});

describe('blownAt — the day the buffer ran out', () => {
  const B0 = 40;
  const day = (n: number) => Date.UTC(2026, 0, 1) + n * 86_400_000;

  it('is the FIRST day with nothing left, not the last', () => {
    const pts = [pt(day(0), 40, B0), pt(day(1), 12, B0), pt(day(2), 0, B0, true), pt(day(3), -9, B0, true)];
    expect(blownAt(pts)!.ms).toBe(day(2));
  });

  it('is null while the buffer holds', () => {
    expect(blownAt([pt(day(0), 40, B0), pt(day(1), 3, B0)])).toBeNull();
  });
});
