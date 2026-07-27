/** @jest-environment node */
// `updateProjectMetrics` — the program metadata dialog's action. It edits the header's
// facts AND appends a ProjectState row in one submit, which is why it is the twin of
// `updateNeedleStatus` as much as of its same-file neighbour `setProjectLifecycle`.
//
// Two things are pinned here that nothing else pinned. The first is the OWNER: every
// program must name an existing Person, and `requireOwner` is the server-side seam that
// keeps a crafted submission from landing freeform text in `Project.ownerName`
// (tests/owner.test.ts proves the resolver; this proves the ACTION still asks it). The
// second is the hill position it writes into the same column `updateNeedleStatus` bounds
// — it did not bound it, so a program's dot could be written off the scale exactly as a
// phase's could (autoknow-9l4).
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { seedProgram, type SeededProgram } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

type Actions = typeof import('../src/app/programs/[id]/actions');
let updateProjectMetrics: Actions['updateProjectMetrics'];

let seeded: SeededProgram;
let ownerEmail: string;

const form = (fields: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  return fd;
};

/** The dialog's fields, minus whatever a case is varying. Checkboxes are omitted rather
 *  than set false — that is how a browser posts an unticked box. */
const base = () => ({
  projectId: seeded.projectId,
  theNeedle: 'On Track',
  ownerName: ownerEmail,
  sopDate: '2027-06',
  volumeFirstYear: '90000',
  notes: 'quarterly refresh',
  hillChartProgress: '55',
});

const project = () => prisma.project.findUniqueOrThrow({ where: { id: seeded.projectId } });

const latestProjectState = () =>
  prisma.projectState.findFirstOrThrow({
    where: { projectId: seeded.projectId },
    // `id` breaks the millisecond tie timestamp alone cannot — see the note in helpers/db.
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
  });

beforeAll(async () => {
  ({ updateProjectMetrics } = await import('../src/app/programs/[id]/actions'));
});

beforeEach(async () => {
  seeded = await seedProgram();
  const person = await prisma.person.create({
    data: { name: 'Ada Lovelace', email: 'ada@google.com', currentPartnerId: seeded.oemId },
  });
  ownerEmail = person.email;
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('updateProjectMetrics', () => {
  it('writes the facts and appends the state row in one submit', async () => {
    await updateProjectMetrics(form({ ...base(), hasGas: 'on', hasAap: 'on' }));

    const p = await project();
    expect(p.ownerName).toBe('ada@google.com');
    expect(p.hillChartProgress).toBe(55);
    expect(p.volumeFirstYear).toBe(90000);
    // yyyy-MM is stored as the LAST day of that month.
    expect(p.sopDate?.toISOString().slice(0, 10)).toBe('2027-06-30');
    // A ticked box is true; the two that were not posted at all are FALSE, not untouched.
    expect([p.hasGas, p.hasAap, p.hasGbi, p.hasDigitalKey]).toEqual([true, true, false, false]);

    const state = await latestProjectState();
    expect(state.hillChartProgress).toBe(55);
    expect(state.notes).toBe('quarterly refresh');
    expect(state.source).toBe('dev');
  });

  it('refuses an owner who is not an existing person, and writes nothing', async () => {
    const before = await project();

    await expect(updateProjectMetrics(form({ ...base(), ownerName: 'ghost@google.com' })))
      .rejects.toThrow(/existing person/);
    await expect(updateProjectMetrics(form({ ...base(), ownerName: '   ' })))
      .rejects.toThrow(/ownerName/);

    const after = await project();
    expect(after.ownerName).toBe(before.ownerName);
    expect(after.hillChartProgress).toBe(before.hillChartProgress);
  });

  it('refuses a hill position off the scale — the same column, the same bound as the needle dialog', async () => {
    const before = await project();

    for (const progress of ['150', '-1', '101']) {
      await expect(updateProjectMetrics(form({ ...base(), hillChartProgress: progress })))
        .rejects.toThrow(/hillChartProgress/);
    }

    expect((await project()).hillChartProgress).toBe(before.hillChartProgress);
  });

  it('refuses a projectId that is not one, rather than silently updating nothing', async () => {
    // This used to be `if (!isNaN(projectId))` around the whole body: a junk id skipped
    // every write and then revalidated `/programs/<the junk>`, so the dialog closed on a
    // save that had not happened.
    await expect(updateProjectMetrics(form({ ...base(), projectId: 'nope' }))).rejects.toThrow(/projectId/);
    await expect(updateProjectMetrics(form({ ...base(), projectId: '0' }))).rejects.toThrow(/projectId/);
  });

  it('leaves the lead partner alone when the picker posted nothing', async () => {
    const before = await project();

    await updateProjectMetrics(form({ ...base(), partnerId: '' }));
    expect((await project()).partnerId).toBe(before.partnerId);

    await updateProjectMetrics(form({ ...base(), partnerId: seeded.supplierId }));
    expect((await project()).partnerId).toBe(seeded.supplierId);
  });

  it('treats a blank volume as zero, and refuses a negative one', async () => {
    await updateProjectMetrics(form({ ...base(), volumeFirstYear: '' }));
    expect((await project()).volumeFirstYear).toBe(0);

    await expect(updateProjectMetrics(form({ ...base(), volumeFirstYear: '-1' })))
      .rejects.toThrow(/volumeFirstYear/);
  });
});
