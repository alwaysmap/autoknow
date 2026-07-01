// Program health — the COLOR of the Needle. Three states, replacing the old 4-level
// risk (Low/Medium/High/Critical). parseHealth accepts the legacy risk labels and
// numeric codes so existing data and forms keep working without a data migration.

export type Health = 'On Track' | 'Some Risk' | 'Concerned';

export const HEALTHS: Health[] = ['On Track', 'Some Risk', 'Concerned'];

export const HEALTH_COLOR: Record<Health, string> = {
  'On Track': '#1a7d3c', // green
  'Some Risk': '#c98a1a', // amber
  'Concerned': '#c5221f', // red
};

/** Ordered worst-last, for "at least this concerned" filtering. */
export const HEALTH_ORDER: Record<Health, number> = {
  'On Track': 0,
  'Some Risk': 1,
  'Concerned': 2,
};

const LEGACY: Record<string, Health> = {
  // new labels
  'on track': 'On Track',
  'some risk': 'Some Risk',
  'concerned': 'Concerned',
  // legacy risk labels
  low: 'On Track',
  medium: 'Some Risk',
  high: 'Concerned',
  critical: 'Concerned',
  // numeric codes (form selects)
  '1': 'On Track',
  '2': 'Some Risk',
  '3': 'Concerned',
  '4': 'Concerned',
};

/** Normalize any stored/form value to a Health state (defaults to On Track). */
export function parseHealth(v: string | number | null | undefined): Health {
  if (v === null || v === undefined) return 'On Track';
  return LEGACY[String(v).trim().toLowerCase()] ?? 'On Track';
}

export function healthColor(v: string | number | null | undefined): string {
  return HEALTH_COLOR[parseHealth(v)];
}

export function healthOrder(v: string | number | null | undefined): number {
  return HEALTH_ORDER[parseHealth(v)];
}
