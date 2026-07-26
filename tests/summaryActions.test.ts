/** @jest-environment node */
// #73: a briefing action must say WHO acts and WHY — the affiliation tells the model
// which side a person is on, and nextStep says which side moves next, so it never tells
// a partner employee to "work with the partner". These two formatters carry those
// signals into the evidence; both are pure, so they test without a model or a database.
// (Dynamic import: summaries.ts is server-only — next/jest maps it, mirroring
// summaryProseDates.test.ts.)
let nextStepPhrase: typeof import('../src/lib/summaries').nextStepPhrase;
let formatActionOwner: typeof import('../src/lib/summaries').formatActionOwner;

beforeAll(async () => {
  const mod = await import('../src/lib/summaries');
  nextStepPhrase = mod.nextStepPhrase;
  formatActionOwner = mod.formatActionOwner;
});

describe('nextStepPhrase', () => {
  it('names the side that moves next', () => {
    expect(nextStepPhrase('Partner')).toBe('the partner acts next');
    expect(nextStepPhrase('Googler')).toBe('the Google-side owner acts next');
    expect(nextStepPhrase('Resolved')).toBe('resolved');
  });
  it('degrades to "undecided" for Undecided or any unknown value', () => {
    expect(nextStepPhrase('Undecided')).toBe('next actor undecided');
    expect(nextStepPhrase('whatever')).toBe('next actor undecided');
  });
});

// Since #127 E5 the caller resolves the company as-of the day (lib/profiles) and hands
// it over on the person, instead of the function reading a `currentPartner` cache. These
// cases are unchanged in meaning; only the seam moved.
describe('formatActionOwner', () => {
  it('names the person WITH their company — the which-side signal (the Sarah Jenkins case)', () => {
    expect(
      formatActionOwner({ name: 'Sarah Jenkins', company: 'Qualcomm' }, 'Sarah Jenkins'),
    ).toBe('Sarah Jenkins (Qualcomm)');
  });

  it('prefers the canonical person over the free-text assignedTo string', () => {
    // assignedTo is a stale label; the resolved person is authoritative.
    expect(
      formatActionOwner({ name: 'Sarah Jenkins', company: 'Qualcomm' }, 'sjenkins@qualcomm.com'),
    ).toBe('Sarah Jenkins (Qualcomm)');
  });

  it('omits the parenthetical when no affiliation covers today', () => {
    // A gap, or a hire that starts next month. The brief names the person without a
    // side rather than guessing one — the whole point of dropping the cache.
    expect(formatActionOwner({ name: 'Pat Doe', company: null }, null)).toBe('Pat Doe');
  });

  it('falls back to the free-text assignee when no person resolved', () => {
    expect(formatActionOwner(null, 'Sarah Jenkins')).toBe('Sarah Jenkins');
    expect(formatActionOwner(undefined, '  someone  ')).toBe('someone');
  });

  it('is null when there is no owner at all', () => {
    expect(formatActionOwner(null, null)).toBeNull();
    expect(formatActionOwner(null, '   ')).toBeNull();
  });
});
