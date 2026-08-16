// THE place a date becomes text (design.md §6: quiet, consistent, data-ink).
//
// One module, and that is a RULE rather than a tidy-up: `toLocaleDateString` and
// `Intl.DateTimeFormat` appear nowhere else under src, enforced by
// tests/dateFormattingIsOneModule.test.ts — which carries what it cost to learn.
//
// Three families, and which one a caller wants is a statement about the VALUE:
//   • MACHINE forms — `isoDate`, `isoDateTime`, the `isoWeek*` labels. A `<time dateTime>`,
//     a provenance stamp, a title. These never move with a preference.
//   • `dayLabel` — a DAY, written the way the reader asked for (`DATE_LABELS` for prose,
//     readouts and chart captions; `TABLE_DATE_LABELS` for a table cell). Every
//     day-granular label in the app.
//   • `monthLabel` — a MONTH. Deliberately CANNOT carry a week: an SOP target names a
//     month, and a week number over it would be a finer claim than the value supports.
//
// (`Intl.RelativeTimeFormat` lives in `lib/relativeTime.ts` and is not an exception to the
// rule above: a duration is not a date. That module's own header carries why §6 gives a
// STAMP a different home from a CELL; its absolute fallback comes back here.)

// ---- the private formatting floor -------------------------------------------------------

/**
 * Formatters are CACHED because constructing one is expensive and `ChainSchedule`
 * re-renders on every mousemove, asking for a month letter per column. Keyed on locale and
 * options together, so two callers wanting different shapes never share one — and the key
 * space is CLOSED rather than merely small, because `localDate` is private and only the
 * named functions below get to choose options. An unbounded Map here would be a leak.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * Locale-aware date text rendered from UTC parts, and the ONLY call to Intl in the app's
 * date path. Client components are server-rendered first, so a formatter that reads the
 * machine's timezone hydrates to a DIFFERENT day near midnight boundaries (server TZ vs
 * browser TZ) — pinning the zone here means no call site can forget to.
 *
 * NOT exported, and that is the enforcement: a caller cannot reach Intl options directly,
 * so every date in the app is written by one of the named functions below, each of which
 * says what KIND of thing it is naming.
 */
function localDate(
  value: string | Date,
  locale: string | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  const key = `${locale ?? ''}|${JSON.stringify(opts)}`;
  let fmt = FORMATTERS.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts });
    FORMATTERS.set(key, fmt);
  }
  return fmt.format(new Date(value));
}

// ---- machine forms: the exact instant, for a machine to read -----------------------------

export function isoDate(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
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

// ---- reader-facing labels: what a PERSON is shown --------------------------------------

/**
 * How a user has asked for DAYS to be written — `DATE_LABELS` for prose, readouts and
 * chart captions, and its table twin `TABLE_DATE_LABELS` for a cell (#31).
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
 * naming a MONTH ("end of August 2026", the program timeline's month axis) belongs to
 * `monthLabel` below — a week number there would be a finer claim than the value
 * supports. Generated prose (AI briefings, seeded notes) is likewise out of scope: it is
 * stored content, not a per-reader label (design.md §6).
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
  // PARENTHESES, not a middot: the week is a GLOSS on the date, not a second coordinate
  // fact (the ADR carries why). The bare week inside them even when a year was asked for —
  // the calendar year is already in the date beside it.
  return mode === 'date-week' ? `${date} (${isoWeekLabel(value)})` : date;
}

/** What each month style is FOR — the half a reader cannot get from the shapes below.
 *  `short` and `compact` differ by their year, which their names do not tell you. */
export type MonthStyle =
  | 'long'      // a headline sentence, a marker caption
  | 'short'     // a fact line
  | 'compact'   // an axis tick, where the year still has to be there
  | 'initial';  // the month letters under a week-gridded axis

const MONTH_STYLES: Record<MonthStyle, Intl.DateTimeFormatOptions> = {
  long: { month: 'long', year: 'numeric' },      // "August 2026"
  short: { month: 'short', year: 'numeric' },    // "Aug 2026"
  compact: { month: 'short', year: '2-digit' },  // "Aug 26"
  initial: { month: 'narrow' },                  // "A"
};

/**
 * A MONTH, for a value whose precision IS a month — an SOP target, a coarse chart axis.
 *
 * Separate from `dayLabel` rather than an option on it, because the difference is not
 * cosmetic: this function has no `DateLabelMode` parameter and cannot grow one. A calendar
 * week is a day-granular unit, so writing "W22" over a value that only ever named August
 * would invent precision the data does not have — the boundary the DATE_LABELS ADR draws.
 */
export function monthLabel(
  value: string | Date,
  locale: string | undefined,
  style: MonthStyle = 'short',
): string {
  return localDate(value, locale, MONTH_STYLES[style]);
}

/** The machine/reading-form partner of `dayLabel`: whatever the visible text does NOT
 *  say, for a `title`. A reader who set week-only labels still needs a way to recover the
 *  date, and one who kept dates still gets the week on hover (design.md §6). */
export function dayLabelTitle(value: string | Date, mode: DateLabelMode): string {
  return mode === 'week' ? isoDate(value) : isoWeekYearLabel(value);
}
