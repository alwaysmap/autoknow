/** @jest-environment node */
// The delta brief (#236): `windowStart` already filtered evidence to "since the last
// brief", but nothing LABELLED which surviving record was new, so the model was asked to
// say what changed while holding a pile of records it could not tell apart. These cover
// the labelling rule itself — the part that is pure, and the part whose failure mode is
// silent: a wrong tag does not throw, it produces a brief that calls old news new.

import { testDatabaseUrl } from './helpers/testDatabaseUrl';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

// Dynamic import AFTER the env assignment above, the shape every test of this module
// uses (summaryProseDates, and addressConflictRemediation states the reason): a static
// import is hoisted and would evaluate src/lib/db — binding its prisma client — before
// DATABASE_URL is set.
let deltaPrefix: typeof import('../src/lib/summaries').deltaPrefix;

beforeAll(async () => {
  ({ deltaPrefix } = await import('../src/lib/summaries'));
});

const LAST_BRIEF = new Date('2026-07-20T12:00:00Z');

describe('deltaPrefix', () => {
  it('marks an event after the previous brief as new', () => {
    expect(deltaPrefix(LAST_BRIEF, new Date('2026-07-25T00:00:00Z'))).toBe('[new] ');
  });

  it('marks an event before the previous brief as prior', () => {
    expect(deltaPrefix(LAST_BRIEF, new Date('2026-07-01T00:00:00Z'))).toBe('[prior] ');
  });

  it('counts an event AT the previous brief instant as new', () => {
    // The boundary belongs to `new` because the gather filters are inclusive (`gte`) on
    // the same instant — a record kept as in-window must not then be labelled as
    // predating the window it was kept for.
    expect(deltaPrefix(LAST_BRIEF, LAST_BRIEF)).toBe('[new] ');
  });

  it('marks nothing when the scope has never had a brief', () => {
    expect(deltaPrefix(null, new Date('2026-07-25T00:00:00Z'))).toBe('');
  });

  it('marks nothing for a record with no timestamp, even when a baseline exists', () => {
    expect(deltaPrefix(LAST_BRIEF, undefined)).toBe('');
  });
});
