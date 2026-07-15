import type { StringKey } from './i18n';

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

// Display-only localization: the i18n key for each health state. The English value of
// each key is byte-identical to the stored Health string, so `t(locale, healthKey(v))`
// never changes what English users (or tests) see — and nothing stored/submitted ever
// goes through this mapping.
export const HEALTH_KEY: Record<Health, StringKey> = {
  'On Track': 'healthOnTrack',
  'Some Risk': 'healthSomeRisk',
  'Concerned': 'healthConcerned',
};

export function healthKey(v: string | number | null | undefined): StringKey {
  return HEALTH_KEY[parseHealth(v)];
}
