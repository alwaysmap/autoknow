/** @jest-environment node */
// #127 E11 (spec #124 §7 Programs listing): each Programs row is labelled with the
// affiliation held AT THE TIME of the involvement, resolved against the person's own
// career — not stamped with the job held today, which is #124 Class 2 wearing a table.
//
// The involvement dating rule lives in lib/personPrograms and these pin its arms:
// a FINISHED phase anchors on the day it first reached 100; anything live, retracted,
// or never updated is a fact about today; TEL ownership is a live FK and is today; a
// row takes the LATEST of its routes' days; an anchor in a career gap yields null.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));

// Dynamic import AFTER the env assignment above (docs/knowledge).
let personProgramRows: typeof import('../src/lib/personPrograms')['personProgramRows'];

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let personId: number;

beforeAll(async () => {
  ({ personProgramRows } = await import('../src/lib/personPrograms'));
  await wipeAll();

  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
  const type = { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } };
  const bosch = await prisma.partner.create({ data: { name: 'Bosch', region, type } });
  const google = await prisma.partner.create({ data: { name: 'Google LLC', region, type } });

  // Two periods with a GAP between them: Bosch 2020→2023, nothing during 2023, Google
  // from 2024. Every case below anchors somewhere specific in that shape.
  const person = await prisma.person.create({
    data: { name: 'Vera Molnar', email: 'vera@example.com', currentPartnerId: google.id },
  });
  personId = person.id;
  await prisma.personAffiliation.createMany({
    data: [
      { personId, partnerId: bosch.id, role: 'Platform Engineer', startDate: d('2020-01-01'), endDate: d('2023-01-01') },
      { personId, partnerId: google.id, role: 'Lead PM', startDate: d('2024-01-01') },
    ],
  });

  const mkProgram = async (name: string, states: { at: string; p: number }[], opts: { owned?: boolean } = {}) => {
    const project = await prisma.project.create({
      data: {
        name,
        partnerId: bosch.id,
        ...(opts.owned ? { ownerPersonId: personId } : {}),
      },
    });
    const phase = await prisma.phase.create({ data: { name: `${name} phase`, projectId: project.id } });
    for (const s of states) {
      await prisma.phaseState.create({
        data: { phaseId: phase.id, status: 'x', hillChartProgress: s.p, timestamp: d(s.at) },
      });
    }
    if (!opts.owned) {
      await prisma.phasePerson.create({ data: { phaseId: phase.id, personId, role: 'FAE' } });
    }
    return project;
  };

  await mkProgram('Finished in the Bosch era', [{ at: '2021-03-01', p: 50 }, { at: '2021-06-01', p: 100 }]);
  await mkProgram('Live now', [{ at: '2025-01-01', p: 30 }]);
  await mkProgram('Owned as TEL', [], { owned: true });
  // Reached 100 in the Bosch era, then dragged BACK — a retracted finish is live again,
  // the same reading effectiveStartedAt gives a retracted start.
  await mkProgram('Retracted finish', [{ at: '2021-01-01', p: 100 }, { at: '2022-01-01', p: 40 }]);
  await mkProgram('Finished in the gap', [{ at: '2023-06-01', p: 100 }]);
  await mkProgram('Never updated', []);
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

async function rows() {
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: personId },
    include: {
      // The same shape PersonProfile fetches: newest start first, partner included.
      affiliations: { include: { partner: true }, orderBy: { startDate: 'desc' } },
      phaseInvolvements: {
        include: { phase: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
      },
      actionItems: {
        select: { phase: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
      },
    },
  });
  const owned = await prisma.project.findMany({
    where: { ownerPersonId: personId },
    select: { id: true, name: true },
  });
  const all = await personProgramRows({
    owned,
    phaseInvolvements: person.phaseInvolvements,
    actionItems: person.actionItems,
    career: person.affiliations,
  });
  return new Map(all.map((r) => [r.name, r]));
}

it('labels a finished involvement with the job held THEN, not the job held now', async () => {
  const row = (await rows()).get('Finished in the Bosch era');
  expect(row?.heldThen).toMatchObject({ partnerName: 'Bosch', role: 'Platform Engineer' });
  expect(row?.heldThenSummary).toBe('Bosch · Platform Engineer');
});

it('labels live, retracted, never-updated and TEL connections with the CURRENT job', async () => {
  const byName = await rows();
  for (const name of ['Live now', 'Owned as TEL', 'Retracted finish', 'Never updated']) {
    expect(byName.get(name)?.heldThen).toMatchObject({ partnerName: 'Google LLC', role: 'Lead PM' });
  }
});

// #144: a role held two years ago used to render identically to one held now.
describe('live vs ended, and why the row is there', () => {
  it('marks a finished-only connection ENDED, with the day the last route finished', async () => {
    const row = (await rows()).get('Finished in the Bosch era');
    expect(row?.status).toBe('ended');
    expect(row?.endedOn?.slice(0, 10)).toBe('2021-06-01');
  });

  it('marks live, retracted, never-updated and TEL connections CURRENT, with no end date', async () => {
    const byName = await rows();
    for (const name of ['Live now', 'Owned as TEL', 'Retracted finish', 'Never updated']) {
      expect(byName.get(name)?.status).toBe('live');
      expect(byName.get(name)?.endedOn).toBeNull();
    }
  });

  it('says WHY the row is there — the routes that put it there, not just that it exists', async () => {
    const byName = await rows();
    expect(byName.get('Owned as TEL')?.via).toEqual(['tel']);
    expect(byName.get('Live now')?.via).toEqual(['phase']);
  });
});

it('an anchor in a career gap yields null — a dash, never the nearest company', async () => {
  const row = (await rows()).get('Finished in the gap');
  expect(row).toBeDefined();
  expect(row?.heldThen).toBeNull();
  expect(row?.heldThenSummary).toBe('');
});
