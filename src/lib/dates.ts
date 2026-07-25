// Shared date rendering for tables (design.md: quiet, consistent, data-ink).
// Dates in tables are ISO (yyyy-mm-dd) — locale-proof, column-aligned, and their
// string form sorts chronologically. Hover reveals the ISO-8601 calendar week.

export function isoDate(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Locale-aware date label rendered from UTC parts. Client components are
 * server-rendered first, so a formatter that reads the machine's timezone
 * hydrates to a DIFFERENT day near midnight boundaries (server TZ vs browser TZ)
 * — every user-facing toLocaleDateString goes through here with the TZ pinned.
 */
export function localDate(
  value: string | Date,
  locale: string | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleDateString(locale, { timeZone: 'UTC', ...opts });
}

/**
 * A timestamp to the MINUTE, in UTC: "2026-07-25 14:32".
 *
 * For provenance stamps — when a digest was distilled, when a source was last checked,
 * when the cycle last ran — where a date alone cannot answer the question being asked.
 * A reader who watched a document half an hour ago and cannot find it yet needs to know
 * whether the summary predates their document or postdates it, and "Jul 25" cannot tell
 * them; both things happened on Jul 25.
 *
 * UTC for the same reason localDate pins it: these render inside client components that
 * are server-rendered first, so reading the machine's zone hydrates to a different
 * string. Callers pair it with a UTC marker in their own localized text (see
 * `ingestRanAt` / `summaryProvenance` in lib/i18n), so the zone is never implied.
 */
export function isoDateTime(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
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
