export function parseNeedleValue(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0.125;
  if (typeof val === 'number') return val;
  
  const parsed = parseFloat(val);
  if (!isNaN(parsed)) return parsed;

  const level = val.toLowerCase();
  if (level === 'medium') return 0.375;
  if (level === 'high') return 0.625;
  if (level === 'critical') return 0.875;
  return 0.125; // default Low
}

export function getNeedleLabel(num: number): string {
  if (num < 0.25) return 'Low';
  if (num < 0.50) return 'Medium';
  if (num < 0.75) return 'High';
  return 'Critical';
}

export function formatNeedleValue(val: string | number | null | undefined): string {
  return getNeedleLabel(parseNeedleValue(val));
}

const NEEDLE_LEVELS: Record<string, string> = {
  '1': 'Low',
  '2': 'Medium',
  '3': 'High',
  '4': 'Critical',
};

/**
 * Normalize a needle value from a form/select into a canonical risk label.
 * Accepts the numeric codes '1'..'4', an existing label ('High'), or a raw float
 * string from the drag gauge ('0.62' -> 'High'). Returns null for empty input so
 * callers can preserve the previously-stored value instead of defaulting to 'Low'.
 *
 * This replaces the `if (val === '1') ... else if (val) theNeedle = val` ladders
 * that were duplicated across the server actions (and which would otherwise store
 * a raw '0.62' string into the needle column).
 */
export function mapNeedleInput(val: string | null | undefined): string | null {
  if (!val) return null;
  if (NEEDLE_LEVELS[val]) return NEEDLE_LEVELS[val];
  return getNeedleLabel(parseNeedleValue(val));
}
