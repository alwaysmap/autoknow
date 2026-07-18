// Shared hill-chart geometry. `progress` (0..100) maps to a point on the classic
// bell-shaped hill (uphill "figuring it out" -> peak -> downhill "making it happen"),
// in a 200 x 100 SVG viewBox. Used by the Needle flag and the per-phase dots.

// The base curve path for the hill (matches the coordinate math below).
export const HILL_PATH = 'M 10 80 C 50 80, 70 10, 100 10 C 130 10, 150 80, 190 80';

export function hillCoordinates(progress: number): { x: number; y: number } {
  const p = Math.max(0, Math.min(100, progress));
  if (p <= 50) {
    const t = p / 50;
    const x =
      Math.pow(1 - t, 3) * 10 +
      3 * Math.pow(1 - t, 2) * t * 50 +
      3 * (1 - t) * Math.pow(t, 2) * 70 +
      Math.pow(t, 3) * 100;
    const y =
      Math.pow(1 - t, 3) * 80 +
      3 * Math.pow(1 - t, 2) * t * 80 +
      3 * (1 - t) * Math.pow(t, 2) * 10 +
      Math.pow(t, 3) * 10;
    return { x, y };
  }
  const t = (p - 50) / 50;
  const x =
    Math.pow(1 - t, 3) * 100 +
    3 * Math.pow(1 - t, 2) * t * 130 +
    3 * (1 - t) * Math.pow(t, 2) * 150 +
    Math.pow(t, 3) * 190;
  const y =
    Math.pow(1 - t, 3) * 10 +
    3 * Math.pow(1 - t, 2) * t * 10 +
    3 * (1 - t) * Math.pow(t, 2) * 80 +
    Math.pow(t, 3) * 80;
  return { x, y };
}
