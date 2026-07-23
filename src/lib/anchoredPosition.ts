// Pure geometry for the one anchored-popover control (#24). No DOM here: the component
// reads the trigger rect and viewport off the browser and hands them in; this decides
// where the panel goes. Kept pure so every placement branch — below, flip-above,
// clamp-left, clamp-right, panel-taller-than-viewport — is unit-tested deterministically
// (AGENTS lessons 2 & 7) instead of eyeballed once and hoped over. Four hand-rolled menus
// each re-derived this wrong; two opened off-screen. It is derived once here, and proven.

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  left: number;
  top: number;
}

export interface AnchoredPositionInput {
  /** The trigger's bounding rectangle, in viewport coordinates. */
  trigger: Rect;
  /** The panel's rendered size. */
  panel: Size;
  /** The viewport's client size. */
  viewport: Size;
  /** Which panel edge aligns to the trigger before clamping ('start' = left, 'end' = right). */
  align?: 'start' | 'end';
  /** Gap kept clear of every viewport edge, px. */
  margin?: number;
  /** Vertical gap between the trigger and the panel, px. */
  gap?: number;
}

/** Clamp v into [min, max]. If the range is inverted (panel larger than the viewport
 *  slot), the low edge wins — the panel pins to the margin and scrolls internally. */
export function clamp(v: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(v, max));
}

/**
 * Place the panel below its trigger, flipping ABOVE only when below overflows the
 * viewport AND above has more room, then clamp both axes inside `margin`. The side is a
 * property of where the trigger sits — computed here, never authored at the call site.
 * Returns integer left/top in viewport coordinates (for `position: fixed`).
 */
export function anchoredPosition({
  trigger,
  panel,
  viewport,
  align = 'start',
  margin = 8,
  gap = 2,
}: AnchoredPositionInput): Point {
  const vw = viewport.width;
  const vh = viewport.height;

  // horizontal: align an edge to the trigger, then clamp inside the viewport
  const rawLeft = align === 'end' ? trigger.right - panel.width : trigger.left;
  const left = clamp(rawLeft, margin, vw - margin - panel.width);

  // vertical: below the trigger; flip above only if below overflows AND above has more room
  let top = trigger.bottom + gap;
  const overflowsBelow = top + panel.height > vh - margin;
  const roomAbove = trigger.top - margin;
  const roomBelow = vh - trigger.bottom;
  if (overflowsBelow && roomAbove > roomBelow) top = trigger.top - gap - panel.height;
  top = clamp(top, margin, vh - margin - panel.height);

  return { left: Math.round(left), top: Math.round(top) };
}

/** Next index for arrow-key roving over `length` items, wrapping both ends.
 *  Returns -1 for an empty list so callers can no-op. */
export function rovingIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  return (current + delta + length) % length;
}
