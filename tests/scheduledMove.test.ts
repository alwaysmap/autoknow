/** @jest-environment node */
// #124 Class 1. A move is RECORDED when it is saved and APPLIED when its date
// arrives; the two used to be the same instant, so a move scheduled months out
// rewrote the identity line immediately. These pin the boundary at both levels —
// the pure predicate, and the server action that has to obey it.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { hasTakenEffect } from '../src/lib/people';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

// Dynamic import AFTER the env assignment above — a static import is hoisted and
// would evaluate src/lib/db (binding its prisma client) before DATABASE_URL is set.
type PeopleActions = typeof import('../src/app/actions/people');
let movePersonCompany: PeopleActions['movePersonCompany'];

describe('hasTakenEffect', () => {
  // `at` is passed explicitly throughout: a test that reads the wall clock proves
  // whatever the wall clock happened to say when it ran.
  const noon = new Date('2026-07-25T12:00:00Z');

  it('says yes to a date already past', () => {
    expect(hasTakenEffect('2026-07-01', noon)).toBe(true);
    expect(hasTakenEffect('2026-07-24', noon)).toBe(true);
  });

  it('says no to a date still ahead', () => {
    expect(hasTakenEffect('2026-07-26', noon)).toBe(false);
    expect(hasTakenEffect('2026-11-01', noon)).toBe(false);
  });

  // THE SAME-DAY CALL. Periods are half-open (#124 §2, `start <= t < end`), so the
  // start day belongs to the NEW period: "effective 25 Jul" is done on the 25th.
  it('says yes on the effective day itself — the boundary belongs to the new period', () => {
    expect(hasTakenEffect('2026-07-25', noon)).toBe(true);
  });

  // …and says so all day, from the first instant to the last, whichever shape the
  // date arrived in. This is what UTC-day granularity buys: a clock time riding
  // along inside the value cannot move the boundary.
  it('holds across the whole effective day, for a plain date and for a timestamp', () => {
    expect(hasTakenEffect('2026-07-25', new Date('2026-07-25T00:00:00Z'))).toBe(true);
    expect(hasTakenEffect('2026-07-25', new Date('2026-07-25T23:59:59Z'))).toBe(true);
    expect(hasTakenEffect('2026-07-25T18:00:00Z', new Date('2026-07-25T09:00:00Z'))).toBe(true);
    // and stops the moment the day does
    expect(hasTakenEffect('2026-07-25', new Date('2026-07-24T23:59:59Z'))).toBe(false);
  });
});

describe('movePersonCompany applies a move only once its date arrives', () => {
  let boschId: number;
  let hondaId: number;
  let personId: number;

  /** An <input type="date"> posts `yyyy-mm-dd`, so that is the shape under test. */
  const dayOffset = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const form = (fields: Record<string, string | number>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
    return f;
  };

  const currentPartnerName = async () => {
    const person = await prisma.person.findUniqueOrThrow({
      where: { id: personId },
      include: { currentPartner: { select: { name: true } } },
    });
    return person.currentPartner.name;
  };

  beforeAll(async () => {
    ({ movePersonCompany } = await import('../src/app/actions/people'));
  });

  // Fresh every test: each one moves the same person, so a shared fixture would
  // make the second assertion depend on the first test's writes.
  beforeEach(async () => {
    await wipeAll();
    const mkPartner = async (name: string) => (await prisma.partner.create({
      data: {
        name,
        type: { connectOrCreate: { where: { name: 'Supplier' }, create: { name: 'Supplier' } } },
        region: { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } },
      },
    })).id;
    boschId = await mkPartner('Bosch');
    hondaId = await mkPartner('Honda');
    personId = (await prisma.person.create({
      data: { name: 'Alice Waters', email: 'alice.waters@bosch.example', currentPartnerId: boschId },
    })).id;
    await prisma.personAffiliation.create({
      data: { personId, partnerId: boschId, role: 'Platform Engineer', startDate: new Date('2022-01-01') },
    });
  });

  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  it('applies a backdated move: the window is retroactively re-attributed', async () => {
    const effective = dayOffset(-30);
    const result = await movePersonCompany(form({
      personId, newPartnerId: hondaId, newRole: 'Cockpit Platform Lead', startDate: effective,
    }));
    expect(result.error).toBeUndefined();

    expect(await currentPartnerName()).toBe('Honda');
    const affs = await prisma.personAffiliation.findMany({
      where: { personId }, orderBy: { startDate: 'asc' },
    });
    expect(affs.map((a) => a.partnerId)).toEqual([boschId, hondaId]);
    expect(affs[0].endDate?.toISOString().slice(0, 10)).toBe(effective); // closed AT the move
    expect(affs[1].endDate).toBeNull();
  });

  it('records a future-dated move WITHOUT applying it — the whole of Class 1', async () => {
    const effective = dayOffset(120);
    const result = await movePersonCompany(form({
      personId, newPartnerId: hondaId, newRole: 'Cockpit Platform Lead', startDate: effective,
    }));
    expect(result.error).toBeUndefined();

    // The move is on the books: Bosch closes at the date, Honda opens there.
    const affs = await prisma.personAffiliation.findMany({
      where: { personId }, orderBy: { startDate: 'asc' },
    });
    expect(affs.map((a) => a.partnerId)).toEqual([boschId, hondaId]);
    expect(affs[0].endDate?.toISOString().slice(0, 10)).toBe(effective);
    expect(affs[1].startDate.toISOString().slice(0, 10)).toBe(effective);

    // …and the cache the identity line reads has NOT moved. This is the assertion
    // that fails if the unconditional write ever comes back.
    expect(await currentPartnerName()).toBe('Bosch');
  });

  // The same-day boundary, through the action rather than the predicate: a person
  // who starts today starts today, or the app argues with their first day at work.
  // The offsets here stay far from ±1 day on purpose — the action reads the wall
  // clock (`hasTakenEffect`'s default `at`), so a ±1-day case asserted here would
  // flip at UTC midnight mid-run. The exact off-by-one is pinned above instead,
  // where `at` is injected and the answer cannot depend on when the suite ran.
  it('applies a move dated TODAY — the start day belongs to the new period', async () => {
    const result = await movePersonCompany(form({
      personId, newPartnerId: hondaId, newRole: 'Cockpit Platform Lead', startDate: dayOffset(0),
    }));
    expect(result.error).toBeUndefined();
    expect(await currentPartnerName()).toBe('Honda');
  });
});
