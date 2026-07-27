/** @jest-environment node */
// `updatePhaseHill` — the phase half of the status pair whose program half is
// `updateNeedleStatus`. Both write a percentage that is later DRAWN: the dot's x on the
// hill curve is `progress`, so a stored 150 puts the dot off the end of the scale
// (AGENTS lesson 18 — ink that means something derives from the data, and here the data
// itself was wrong at the source).
//
// The program half has always refused an out-of-range percentage — `statusUpdateSchema`
// bounds `hillChartProgress` to 0..100 — and the JSON route for this very phase shape
// refuses it too (`phaseStateApiSchema`). The action did not, because it hand-parsed the
// same form its twin parses through `parseForm`: `parseInt(progressStr, 10)` carries no
// range at all. These pin the bound at the action, not just at the schema, so the fix
// cannot be undone by routing around the schema again.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb, newestFirst } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
// next-auth v5 is ESM-only and won't compile under jest; the action asks lib/session who
// is signed in to stamp `source`, so that is the one thing that must be stubbed.
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

type Hill = typeof import('../src/app/actions/hill');
let updatePhaseHill: Hill['updatePhaseHill'];

let seeded: SeededProgram;

const form = (fields: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  return fd;
};

const countStates = (phaseId: number) => prisma.phaseState.count({ where: { phaseId } });

const latestState = (phaseId: number) =>
  prisma.phaseState.findFirstOrThrow({ where: { phaseId }, orderBy: newestFirst });

beforeAll(async () => {
  ({ updatePhaseHill } = await import('../src/app/actions/hill'));
  seeded = await seedProgram();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('updatePhaseHill', () => {
  it('refuses a percentage outside 0..100 and writes nothing', async () => {
    const phaseId = seeded.phases.integration;
    const before = await countStates(phaseId);

    for (const progress of ['150', '-5', '101']) {
      await expect(
        updatePhaseHill(form({ phaseId, projectId: seeded.projectId, hillChartProgress: progress, notes: 'off the scale' })),
      ).rejects.toThrow(/hillChartProgress/);
    }

    // A refusal that still appended a row would be worse than none: the log is what the
    // AI brief digests and what the chart's ghost dot reads as "previous".
    expect(await countStates(phaseId)).toBe(before);
  });

  it('accepts the ends of the scale', async () => {
    const phaseId = seeded.phases.audio;
    for (const progress of [0, 100]) {
      await updatePhaseHill(form({ phaseId, projectId: seeded.projectId, hillChartProgress: progress, notes: 'at the edge' }));
      expect((await latestState(phaseId)).hillChartProgress).toBe(progress);
    }
    // Status is DERIVED from the position, never picked — 100 is 'Done'.
    expect((await latestState(phaseId)).status).toBe('Done');
  });

  it('a blank position carries the previous one forward, so a note-only update does not reset the dot', async () => {
    const phaseId = seeded.phases.bringUp;
    const previous = (await latestState(phaseId)).hillChartProgress;

    await updatePhaseHill(form({ phaseId, projectId: seeded.projectId, hillChartProgress: '', notes: 'no movement, just news' }));

    const state = await latestState(phaseId);
    expect(state.hillChartProgress).toBe(previous);
    expect(state.notes).toBe('no movement, just news');
    expect(state.source).toBe('dev');
  });

  it('requires a note — a position change without words is unreadable later', async () => {
    const phaseId = seeded.phases.certification;
    const before = await countStates(phaseId);

    await expect(
      updatePhaseHill(form({ phaseId, projectId: seeded.projectId, hillChartProgress: '50', notes: '   ' })),
    ).rejects.toThrow(/notes/);

    expect(await countStates(phaseId)).toBe(before);
  });

  it('refuses ids that are not ids, including the projectId that only ever fed revalidatePath', async () => {
    const phaseId = seeded.phases.certification;
    const good = { phaseId, projectId: seeded.projectId, hillChartProgress: '50', notes: 'progress' };

    await expect(updatePhaseHill(form({ ...good, phaseId: 'nope' }))).rejects.toThrow(/phaseId/);
    // Unvalidated, this one was guarded downstream by `if (!isNaN(projectId))`, so junk
    // SKIPPED the revalidation rather than corrupting the path: the update was written and
    // the program's page went on serving the old HTML. Its twin `updateProjectMetrics`
    // failed the other way, interpolating the raw string — see tests/projectMetrics.test.ts.
    await expect(updatePhaseHill(form({ ...good, projectId: 'nope' }))).rejects.toThrow(/projectId/);
    await expect(updatePhaseHill(form({ ...good, projectId: '0' }))).rejects.toThrow(/projectId/);
  });

  it('refuses a real phase hung off the WRONG program', async () => {
    // The pair is what is checked, not either id alone: both exist here, and they do not
    // belong together. Unchecked, this appended an update to somebody else's phase and
    // then revalidated the page of the program named in the form (#219's hole, one
    // surface over).
    const other = await prisma.project.create({
      data: { name: 'Unrelated', partnerId: seeded.oemId, ownerName: 'dylan', theNeedle: 'On Track' },
    });
    const before = await countStates(seeded.phases.integration);

    await expect(
      updatePhaseHill(form({ phaseId: seeded.phases.integration, projectId: other.id, hillChartProgress: '50', notes: 'not mine' })),
    ).rejects.toThrow(/ — /);

    expect(await countStates(seeded.phases.integration)).toBe(before);
  });

  // Both call sites of this action catch the throw themselves (PhaseHillGauge, PhaseTrack),
  // so `guarded` is not in THIS path. The prefix is pinned here anyway because it is not
  // this action's wording — it is `parseForm`'s, shared with every action that DOES run
  // under `guarded`, which forwards a message only when it startsWith('Invalid input') OR
  // includes(' — '). A reword missing both branches would degrade all of those to
  // "Something went wrong", and pinning the contract wherever it is cheap is what catches
  // that early.
  it('refuses readably', async () => {
    await expect(
      updatePhaseHill(form({ phaseId: seeded.phases.audio, projectId: seeded.projectId, hillChartProgress: '150', notes: 'x' })),
    ).rejects.toThrow(/^Invalid input — /);
  });
});
