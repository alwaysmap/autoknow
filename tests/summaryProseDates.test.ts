/** @jest-environment node */
// Issue #20: AI briefings wrote ISO dates in prose ("SOP 2027-08-31") because the
// prompt's own exemplar taught ISO and the evidence context fed no other shape. ISO is
// a TABLE format (design.md §6) — it sorts and aligns in a column and both reasons die
// inside a sentence. Two guards, both pure so they run without a model or a database:
//   1. no DEFAULT prompt may TEACH ISO (the exemplar that caused this);
//   2. mechanicalViolations REJECTS any ISO the model still echoes into prose, and the
//      brief is re-asked once (#236 fix 6 — this used to be a warning nobody read, and
//      four of eleven production briefs shipped an ISO date anyway).
import { testDatabaseUrl } from './helpers/testDatabaseUrl';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

import { DEFAULT_SUMMARY_PROMPTS, SUMMARY_SCOPES, scopeHasThemes } from '../src/lib/summaryPrompts';
import type { RawSummary } from '../src/lib/gemini';

let PROSE_ISO_DATE_RE: typeof import('../src/lib/summaries').PROSE_ISO_DATE_RE;
let mechanicalViolations: typeof import('../src/lib/summaries').mechanicalViolations;

beforeAll(async () => {
  const mod = await import('../src/lib/summaries');
  PROSE_ISO_DATE_RE = mod.PROSE_ISO_DATE_RE;
  mechanicalViolations = mod.mechanicalViolations;
});

/** The ISO offenders among a brief's violations, as the old `isoDatesInGeneratedProse`
 *  reported them. Derived from the ONE traversal rather than a second one of its own,
 *  and selected by `code` — `rule` is the sentence the retry prompt hands the model, so
 *  filtering on its wording would make every `toEqual([])` below vacuous the day
 *  somebody tunes it. */
const isoFields = (r: RawSummary) =>
  mechanicalViolations(r).filter((v) => v.code === 'iso-date').map((v) => v.field);

const raw = (over: Partial<RawSummary> = {}): RawSummary => ({
  tldr: 'Volvo Digital Key tracks to an August 2027 SOP with 318 days of buffer.',
  progress: [],
  risks: [],
  themes: [],
  actions: [],
  ...over,
});

// `DEFAULT_SUMMARY_PROMPTS` names each scope twice — once as the record key, once as the
// argument that picks its sections block — and nothing in the type system makes the two
// agree, so `partner: build('program', …)` would type-check and quietly ship a partner
// brief with the program's rules. This is the guard for that, and it is cheaper than
// restructuring the table: the module's whole point is that the three prompts are
// readable side by side.
describe('every default prompt is built for the scope it is filed under', () => {
  it.each(SUMMARY_SCOPES)('%s asks for themes exactly when its scope has them', (scope) => {
    const asksForThemes = DEFAULT_SUMMARY_PROMPTS[scope].includes('themes: patterns ACROSS the evidence');
    expect(asksForThemes).toBe(scopeHasThemes(scope));
  });

  it('a single program is told to leave themes empty, in those words', () => {
    expect(DEFAULT_SUMMARY_PROMPTS.program).toContain('themes: always an empty array');
  });
});

describe('the default prompts do not teach ISO dates in prose', () => {
  // The exemplar is the strongest signal in a prompt; when it read "SOP 2026-12", the
  // model copied ISO into every sentence. No DEFAULT prompt may carry an ISO-shaped date.
  it.each(SUMMARY_SCOPES)('%s default prompt carries no yyyy-mm date', (scope) => {
    const hit = DEFAULT_SUMMARY_PROMPTS[scope].match(PROSE_ISO_DATE_RE);
    expect(hit).toBeNull();
  });
});

describe('ISO dates in generated prose are rejected, not warned about', () => {
  it('passes prose that says dates the way a person does', () => {
    expect(isoFields(raw())).toEqual([]);
    expect(
      isoFields(raw({ risks: [{ text: 'The December 2026 SOP is at risk — audio HAL blocked.', evidence: [0] }] })),
    ).toEqual([]);
  });

  it('flags a full ISO date in the tldr', () => {
    expect(isoFields(raw({ tldr: 'Overshot its 2026-07-31 SOP by 30 days.' }))).toEqual(['tldr']);
  });

  it('flags a year-month ISO date in a section bullet', () => {
    expect(isoFields(raw({ risks: [{ text: 'SOP 2026-12 is slipping.', evidence: [1] }] }))).toEqual(['risks[0]']);
  });

  it('reports every offending field across sections', () => {
    expect(
      isoFields(
        raw({
          tldr: 'Ships 2027-08-31.',
          progress: [{ text: 'Cert cleared 2026-06-01.', evidence: [0] }],
          actions: [{ text: 'Decide by end of March.', evidence: [1] }],
        }),
      ),
    ).toEqual(['tldr', 'progress[0]']); // the prose action is clean
  });
});

// ---- The rest of the mechanical contract (#236 fix 6) --------------------------------
//
// The ISO guard above only WARNED, and four of eleven production briefs shipped an ISO
// date in prose anyway. Two more rules were in the same position — written down, checked
// by nobody: bracketed evidence ids in the prose, and action bullets that dropped the
// owner's company. That last one produced "Sarah Jenkins must drive the partner to debug
// the audio HAL cold boot freeze deadlock", where Jenkins IS the partner.
//
// `mechanicalViolations` is what turns all three into reject-and-retry-once, so it is
// tested here rather than in a second file: same subject, same guard family, one place
// to look when the next rule is added.
describe('mechanicalViolations', () => {
  const action = (text: string) => ({ text, evidence: [0] });

  it('passes a brief that keeps every mechanical rule', () => {
    expect(
      mechanicalViolations(
        raw({
          risks: [{ text: 'Audio HAL lands 17 days past the October SOP.', evidence: [3] }],
          actions: [action('Priya Raman (Google) must rebaseline the chain this week.')],
        }),
      ),
    ).toEqual([]);
  });

  it('flags an ISO date wherever it appears, and names the field', () => {
    const hits = mechanicalViolations(raw({ tldr: 'Ships 2027-08-31.' }));
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toBe('tldr');
    expect(hits[0].rule).toContain('ISO');
  });

  it('flags bracketed evidence ids the model wrote into the prose', () => {
    // stripIds still removes these before storage — this is what makes it a VIOLATION
    // rather than a silent repair, so a prompt regression is visible instead of laundered.
    const hits = mechanicalViolations(raw({ progress: [{ text: 'BSP completed [0, 3].', evidence: [0, 3] }] }));
    expect(hits).toHaveLength(1);
    expect(hits[0].field).toBe('progress[0]');
    expect(hits[0].rule).toContain('evidence');
  });

  it('flags an action bullet with no parenthesized affiliation', () => {
    const hits = mechanicalViolations(raw({ actions: [action('Sarah Jenkins must drive the partner to debug the deadlock.')] }));
    expect(hits).toEqual([expect.objectContaining({ field: 'actions[0]' })]);
    expect(hits[0].rule).toContain('company');
  });

  it('does not demand an affiliation from any other section', () => {
    expect(mechanicalViolations(raw({ risks: [{ text: 'The December SOP is at risk.', evidence: [1] }] }))).toEqual([]);
  });

  it('reports every violation, so one retry can fix them all at once', () => {
    const hits = mechanicalViolations(
      raw({
        tldr: 'Overshot its 2026-07-31 SOP.',
        actions: [action('Decide the brand matrix by end of March.')],
      }),
    );
    expect(hits.map((h) => h.field).sort()).toEqual(['actions[0]', 'tldr']);
  });
});
