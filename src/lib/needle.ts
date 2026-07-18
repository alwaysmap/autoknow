import { parseHealth } from './health';

// The needle now represents program Health (see lib/health.ts). formatNeedleValue is
// the compatibility shim so existing badge call-sites render the health label.

export function formatNeedleValue(val: string | number | null | undefined): string {
  return parseHealth(val);
}
