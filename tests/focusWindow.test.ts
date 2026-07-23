/** @jest-environment node */
// The chart's zoom/pan focus window (#75): a window always stays inside the data range,
// keeps its width while panning, and collapses to Fit (null) once it covers everything.
import { focusWindow, panWindow, zoomWindow, MIN_SPAN_MS, Span } from '../src/lib/focusWindow';

const DAY = 24 * 60 * 60 * 1000;
const DATA_MIN = 0;
const DATA_MAX = 100 * DAY;
const within = (w: Span) => w.min >= DATA_MIN && w.max <= DATA_MAX;

describe('focusWindow — centre a span, clamp inside the data, Fit when it covers all', () => {
  it('centres a window on the given date when it fits comfortably', () => {
    const w = focusWindow(50 * DAY, 14 * DAY, DATA_MIN, DATA_MAX)!;
    expect(w.min).toBe(43 * DAY);
    expect(w.max).toBe(57 * DAY);
  });

  it('shoves a window that overhangs the start fully inside — no dead space', () => {
    const w = focusWindow(2 * DAY, 14 * DAY, DATA_MIN, DATA_MAX)!;
    expect(w.min).toBe(DATA_MIN);
    expect(w.max).toBe(14 * DAY); // full width preserved, pinned to the left edge
    expect(within(w)).toBe(true);
  });

  it('shoves a window that overhangs the end fully inside', () => {
    const w = focusWindow(99 * DAY, 14 * DAY, DATA_MIN, DATA_MAX)!;
    expect(w.max).toBe(DATA_MAX);
    expect(w.min).toBe(86 * DAY);
    expect(within(w)).toBe(true);
  });

  it('returns null (Fit) once the span reaches the whole data range', () => {
    expect(focusWindow(50 * DAY, 100 * DAY, DATA_MIN, DATA_MAX)).toBeNull();
    expect(focusWindow(50 * DAY, 200 * DAY, DATA_MIN, DATA_MAX)).toBeNull();
  });

  it('never narrows below the sub-day floor', () => {
    const w = focusWindow(50 * DAY, 0, DATA_MIN, DATA_MAX)!;
    expect(w.max - w.min).toBe(MIN_SPAN_MS);
  });
});

describe('panWindow — slides, keeps width, clamps to the data', () => {
  it('slides by the delta when there is room', () => {
    const w = panWindow({ min: 40 * DAY, max: 54 * DAY }, 10 * DAY, DATA_MIN, DATA_MAX);
    expect(w.min).toBe(50 * DAY);
    expect(w.max).toBe(64 * DAY);
  });

  it('clamps at the right edge without shrinking the width', () => {
    const w = panWindow({ min: 90 * DAY, max: 100 * DAY }, 50 * DAY, DATA_MIN, DATA_MAX);
    expect(w.max).toBe(DATA_MAX);
    expect(w.max - w.min).toBe(10 * DAY);
  });

  it('clamps at the left edge without shrinking the width', () => {
    const w = panWindow({ min: 5 * DAY, max: 15 * DAY }, -50 * DAY, DATA_MIN, DATA_MAX);
    expect(w.min).toBe(DATA_MIN);
    expect(w.max - w.min).toBe(10 * DAY);
  });
});

describe('zoomWindow — ± about the centre, seeds from Fit, collapses back to Fit', () => {
  it('seeds a fitSpan-wide window on centre when starting from Fit', () => {
    const w = zoomWindow(null, 0.6, 50 * DAY, 20 * DAY, DATA_MIN, DATA_MAX)!;
    expect(w.max - w.min).toBe(20 * DAY);
    expect((w.min + w.max) / 2).toBe(50 * DAY);
  });

  it('shrinks about the current centre on zoom-in', () => {
    const w = zoomWindow({ min: 40 * DAY, max: 60 * DAY }, 0.5, 0, 20 * DAY, DATA_MIN, DATA_MAX)!;
    expect(w.max - w.min).toBe(10 * DAY);
    expect((w.min + w.max) / 2).toBe(50 * DAY);
  });

  it('collapses to Fit when zoom-out grows past the data range', () => {
    expect(zoomWindow({ min: 10 * DAY, max: 90 * DAY }, 2, 0, 20 * DAY, DATA_MIN, DATA_MAX)).toBeNull();
  });
});
