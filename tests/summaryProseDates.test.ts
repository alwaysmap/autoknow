/** @jest-environment node */
// Issue #20: AI briefings wrote ISO dates in prose ("SOP 2027-08-31") because the
// prompt's own exemplar taught ISO and the evidence context fed no other shape. ISO is
// a TABLE format (design.md §6) — it sorts and aligns in a column and both reasons die
// inside a sentence. Two guards, both pure so they run without a model or a database:
//   1. no DEFAULT prompt may TEACH ISO (the exemplar that caused this);
//   2. isoDatesInGeneratedProse flags any ISO the model still echoes into prose.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

import { DEFAULT_SUMMARY_PROMPTS, SUMMARY_SCOPES } from '../src/lib/summaryPrompts';
import type { RawSummary } from '../src/lib/gemini';

let isoDatesInGeneratedProse: typeof import('../src/lib/summaries').isoDatesInGeneratedProse;
let PROSE_ISO_DATE_RE: typeof import('../src/lib/summaries').PROSE_ISO_DATE_RE;

beforeAll(async () => {
  const mod = await import('../src/lib/summaries');
  isoDatesInGeneratedProse = mod.isoDatesInGeneratedProse;
  PROSE_ISO_DATE_RE = mod.PROSE_ISO_DATE_RE;
});

const raw = (over: Partial<RawSummary> = {}): RawSummary => ({
  tldr: 'Volvo Digital Key tracks to an August 2027 SOP with 318 days of buffer.',
  progress: [],
  risks: [],
  themes: [],
  actions: [],
  ...over,
});

describe('the default prompts do not teach ISO dates in prose', () => {
  // The exemplar is the strongest signal in a prompt; when it read "SOP 2026-12", the
  // model copied ISO into every sentence. No DEFAULT prompt may carry an ISO-shaped date.
  it.each(SUMMARY_SCOPES)('%s default prompt carries no yyyy-mm date', (scope) => {
    const hit = DEFAULT_SUMMARY_PROMPTS[scope].match(PROSE_ISO_DATE_RE);
    expect(hit).toBeNull();
  });
});

describe('isoDatesInGeneratedProse (pure guard)', () => {
  it('passes prose that says dates the way a person does', () => {
    expect(isoDatesInGeneratedProse(raw())).toEqual([]);
    expect(
      isoDatesInGeneratedProse(
        raw({ risks: [{ text: 'The December 2026 SOP is at risk — audio HAL blocked.', evidence: [0] }] }),
      ),
    ).toEqual([]);
  });

  it('flags a full ISO date in the tldr', () => {
    const hits = isoDatesInGeneratedProse(raw({ tldr: 'Overshot its 2026-07-31 SOP by 30 days.' }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('tldr');
  });

  it('flags a year-month ISO date in a section bullet', () => {
    const hits = isoDatesInGeneratedProse(
      raw({ risks: [{ text: 'SOP 2026-12 is slipping.', evidence: [1] }] }),
    );
    expect(hits).toEqual([expect.stringContaining('risks[0]')]);
  });

  it('reports every offending field across sections', () => {
    const hits = isoDatesInGeneratedProse(
      raw({
        tldr: 'Ships 2027-08-31.',
        progress: [{ text: 'Cert cleared 2026-06-01.', evidence: [0] }],
        actions: [{ text: 'Decide by end of March.', evidence: [1] }],
      }),
    );
    expect(hits).toHaveLength(2); // tldr + progress[0]; the prose action is clean
  });
});
