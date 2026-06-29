// Shared statistics helpers. The percentile logic was previously inlined as
// `arr[Math.floor(arr.length * p)]` in several places — unsorted in some, and able
// to read past the end of short arrays. Centralize it with a bounded nearest-rank
// implementation that sorts defensively and never indexes out of range.

/**
 * Nearest-rank percentile for p in [0, 1] over a numeric array.
 * Returns 0 for an empty array. The input is copied and sorted, so callers may
 * pass data in any order. The index is clamped to [0, length - 1].
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}
