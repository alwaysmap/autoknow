// Shared date rendering (design.md: quiet, consistent, data-ink).
//
// `dayLabel` below is the entry point and carries the rule: it is how a DAY is written
// anywhere a person reads one, and what it writes follows the reader's DATE_LABELS
// preference. `isoDate` / `isoDateTime` are the MACHINE forms that ride alongside — a
// `<time dateTime>`, a provenance stamp — and never move with the preference.

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
 * string. The zone is never left implied — callers name it, either through their i18n
 * string (`ingestRanAt`, `summaryProvenance`) or as a literal where the surrounding text
 * is unlocalized anyway (the activity feed's provenance subtitles).
 */
export function isoDateTime(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * ISO-8601 week number AND the week-numbering YEAR it belongs to — the two travel
 * together because they disagree at the turn of the year and the disagreement is the
 * whole point: 2024-12-30 is 2025-W01, so a label built from `getUTCFullYear()` would
 * read "W1 2024", naming a week that does not exist. Weeks start Monday; W1 is the week
 * holding Jan 4 (equivalently, the week whose Thursday falls in the year).
 */
export function isoWeekParts(value: string | Date): { week: number; weekYear: number } {
  const d = new Date(value);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = target.getUTCDay() || 7; // Sunday → 7
  target.setUTCDate(target.getUTCDate() + 4 - day); // shift to the week's Thursday
  const weekYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, weekYear };
}

/** ISO-8601 week number, rendered as "W29". */
export function isoWeekLabel(value: string | Date): string {
  return `W${isoWeekParts(value).week}`;
}

/** The same week, qualified by its week-numbering year — "W29 2026". */
export function isoWeekYearLabel(value: string | Date): string {
  const { week, weekYear } = isoWeekParts(value);
  return `W${week} ${weekYear}`;
}

/**
 * How a user has asked for DAYS to be written (the `DATE_LABELS` preference, #31).
 * Automotive planning runs on ISO calendar weeks — a supplier commits to CW22, not to
 * June 1 — so a reader may want the week alongside the date, or instead of it.
 */
export type DateLabelMode = 'date' | 'date-week' | 'week';

/**
 * THE way a DAY is written anywhere a person reads one — table cells, chart readouts,
 * axis ticks, marker captions. Every day-granular label in the app goes through here so
 * the preference cannot reach eleven surfaces and miss the twelfth.
 *
 * The scope is deliberately a DAY. A calendar week is a day-granular unit, so a label
 * naming a MONTH ("end of August 2026", the program timeline's month axis) is NOT this
 * function's business and keeps its own shape — a week number there would be a finer
 * claim than the underlying value supports. Generated prose (AI briefings, seeded notes)
 * is likewise out of scope: it is stored content, not a per-reader label (design.md §6).
 *
 * `year` follows the caller's existing Intl options rather than the mode, so the
 * date/week forms of one call site stay the same size of statement: a cell that said
 * "Jun 1, 2026" says "W22 2026", and an axis tick that said "Jun 1" says "W22".
 */
export function dayLabel(
  value: string | Date,
  locale: string | undefined,
  mode: DateLabelMode,
  opts: { year?: boolean; month?: 'short' | 'long' } = {},
): string {
  const { year = false, month = 'short' } = opts;
  if (mode === 'week') return year ? isoWeekYearLabel(value) : isoWeekLabel(value);
  const date = localDate(value, locale, { month, day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
  // The bare week even when a year was asked for: the calendar year is already in the
  // date beside it, and repeating it ("Jun 1, 2026 · W22 2026") pays two words for none.
  return mode === 'date-week' ? `${date} · ${isoWeekLabel(value)}` : date;
}

/** The machine/reading-form partner of `dayLabel`: whatever the visible text does NOT
 *  say, for a `title`. A reader who set week-only labels still needs a way to recover the
 *  date, and one who kept dates still gets the week on hover (design.md §6). */
export function dayLabelTitle(value: string | Date, mode: DateLabelMode): string {
  return mode === 'week' ? isoDate(value) : isoWeekYearLabel(value);
}
