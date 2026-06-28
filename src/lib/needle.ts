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
