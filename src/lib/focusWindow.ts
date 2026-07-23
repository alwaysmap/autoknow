// Pure math for the Critical Chain chart's zoom/pan focus window (ChainSchedule, #75).
// The chart normally fits the whole chain; a focus window narrows the x-axis to a date
// range the user can size (Fit / 2-week / zoom ±) and slide left-right. All the geometry
// that must stay correct — clamping a window to the data, keeping its width while panning,
// snapping "zoom to Fit" — lives here so it is unit-tested with zero DOM.

/** An inclusive time range in ms. `null` anywhere a window is expected means "Fit" (show all). */
export interface Span { min: number; max: number }

const DAY = 24 * 60 * 60 * 1000;
/** A focus window narrower than this is pointless (sub-day) — used as the zoom-in floor. */
export const MIN_SPAN_MS = 3 * DAY;

/** Centre a `spanMs`-wide window on `centerMs`, then shove it wholly inside [dataMin, dataMax]
 *  (so zooming near an end doesn't leave dead space). Returns `null` — i.e. Fit — once the
 *  span covers the whole data range, so "zoom all the way out" collapses to showing everything. */
export function focusWindow(centerMs: number, spanMs: number, dataMin: number, dataMax: number): Span | null {
  const dataSpan = dataMax - dataMin;
  const span = Math.max(MIN_SPAN_MS, Math.min(spanMs, dataSpan));
  if (span >= dataSpan) return null;
  let min = centerMs - span / 2;
  let max = centerMs + span / 2;
  if (min < dataMin) { max += dataMin - min; min = dataMin; }
  if (max > dataMax) { min -= max - dataMax; max = dataMax; }
  return { min: Math.max(dataMin, min), max: Math.min(dataMax, max) };
}

/** Slide a window by `deltaMs`, keeping its width, clamped so it never leaves [dataMin, dataMax]. */
export function panWindow(w: Span, deltaMs: number, dataMin: number, dataMax: number): Span {
  const width = w.max - w.min;
  const min = Math.max(dataMin, Math.min(dataMax - width, w.min + deltaMs));
  return { min, max: min + width };
}

/** Grow (`factor > 1`) or shrink (`factor < 1`) a window about its own centre, then re-clamp —
 *  the zoom ± buttons. From Fit (`current == null`) it seeds a window `fitSpan` wide on `centerMs`. */
export function zoomWindow(
  current: Span | null, factor: number, centerMs: number, fitSpan: number, dataMin: number, dataMax: number,
): Span | null {
  const span = current ? (current.max - current.min) * factor : fitSpan;
  const center = current ? (current.min + current.max) / 2 : centerMs;
  return focusWindow(center, span, dataMin, dataMax);
}
