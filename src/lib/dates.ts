// Shared date rendering for tables (design.md: quiet, consistent, data-ink).
// Dates in tables are ISO (yyyy-mm-dd) — locale-proof, column-aligned, and their
// string form sorts chronologically. Hover reveals the ISO-8601 calendar week.

export function isoDate(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** ISO-8601 week number, rendered as "W29" (weeks start Monday; W1 holds Jan 4). */
export function isoWeekLabel(value: string | Date): string {
  const d = new Date(value);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = target.getUTCDay() || 7; // Sunday → 7
  target.setUTCDate(target.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `W${week}`;
}
