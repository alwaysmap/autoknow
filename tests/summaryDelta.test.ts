/** @jest-environment node */
// The delta brief (#236): `windowStart` already filtered evidence to "since the last
// brief", but nothing LABELLED which surviving record was new, so the model was asked to
// say what changed while holding a pile of records it could not tell apart. These cover
// the labelling rule itself — the part that is pure, and the part whose failure mode is
// silent: a wrong tag does not throw, it produces a brief that calls old news new.

// The same preamble every pure test of this module needs (see summaryProseDates): the
// import pulls in `server-only` and the Prisma/pg client, neither of which a pure
// function test wants to stand up. Both lines run before the import is hoisted past them.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';

process.env.DATABASE_URL = testDatabaseUrl();

jest.mock('server-only', () => ({}));

import { deltaTag } from '../src/lib/summaries';

const LAST_BRIEF = new Date('2026-07-20T12:00:00Z');

describe('deltaTag', () => {
  it('marks an event after the previous brief as new', () => {
    expect(deltaTag(LAST_BRIEF, new Date('2026-07-25T00:00:00Z'))).toBe('[new] ');
  });

  it('marks an event before the previous brief as prior', () => {
    expect(deltaTag(LAST_BRIEF, new Date('2026-07-01T00:00:00Z'))).toBe('[prior] ');
  });

  it('counts an event AT the previous brief instant as new', () => {
    // The boundary belongs to `new` because `windowStart` is inclusive (`gte`) on the
    // same instant — a record the filter kept as in-window must not then be labelled as
    // predating the window it was kept for.
    expect(deltaTag(LAST_BRIEF, LAST_BRIEF)).toBe('[new] ');
  });

  it('tags nothing when the scope has never had a brief', () => {
    // Everything would be "[new]" against a baseline that does not exist, which reads to
    // the model as a full page of change on a program nobody has ever briefed.
    expect(deltaTag(null, new Date('2026-07-25T00:00:00Z'))).toBe('');
  });

  it('tags nothing for a record with no timestamp, even when a baseline exists', () => {
    // Current state (the ledger, the chain, who owns the program) is recomputed every
    // generation. Calling it `[prior]` would say it predates the last brief and calling
    // it `[new]` would say it just happened; both are claims this cannot support.
    expect(deltaTag(LAST_BRIEF, undefined)).toBe('');
  });
});
