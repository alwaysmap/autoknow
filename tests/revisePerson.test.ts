/** @jest-environment node */
// #127 E14 (spec #124 §3): ONE editor, and the EFFECTIVE DATE decides what a submit
// means. Empty corrects the record in place; set records a change — past backdates,
// future schedules. The two used to be separate dialogs, so the wrong door wrote fake
// history; these pin the fork itself, plus the three things E14 added behind it:
// employer/title corrected in place, the address stamps that close autoknow-wu0, and
// cancelling a scheduled change.
//
// tests/scheduledMove.test.ts and tests/movePersonCovering.test.ts already own the
// dated arm's Class-1 boundary and its period arithmetic, and
// tests/revisePersonCorrections.test.ts owns the correction arm's ADDRESS edges; this
// file deliberately does not restate any of them.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
// next-auth v5 is ESM-only and won't compile under jest; the actions module reaches
// lib/session through createMyProfile, so it is stubbed even though neither action
// under test asks who is signed in.
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

type People = typeof import('../src/app/actions/people');
let revisePerson: People['revisePerson'];
let cancelScheduledChange: People['cancelScheduledChange'];

let bosch: number;
let honda: number;
let personId: number;

const form = (fields: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  return fd;
};

// Offsets, never literals — a hard-coded future date stops testing "scheduled" the day
// it goes past (docs/knowledge: a-literal-future-date-in-a-fixture-expires). Far from
// ±1 day so nothing flips at UTC midnight mid-run.
const isoDay = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** The record as the dialog would submit it: every field, the effective date last. */
const revise = (fields: Record<string, string | number>) =>
  revisePerson(form({
    personId, name: 'Alice Waters', email: 'alice@google.example', ...fields,
  }));

const periods = () =>
  prisma.personAffiliation.findMany({ where: { personId }, orderBy: { startDate: 'asc' } });

beforeAll(async () => {
  ({ revisePerson, cancelScheduledChange } = await import('../src/app/actions/people'));
});

beforeEach(async () => {
  await wipeAll();
  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
  bosch = (await prisma.partner.create({ data: { name: 'Bosch', region } })).id;
  honda = (await prisma.partner.create({ data: { name: 'Honda', region } })).id;
  personId = (await prisma.person.create({
    data: { name: 'Alice Waters', email: 'alice@google.example', currentPartnerId: bosch },
  })).id;
  await prisma.personAffiliation.create({
    data: { personId, partnerId: bosch, role: 'Platform Enginer', startDate: new Date('2022-01-01T00:00:00Z') },
  });
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe('no effective date — a correction, in place', () => {
  it('fixes a typo\'d TITLE on the current period without touching the timeline', async () => {
    const res = await revise({ partnerId: bosch, role: 'Platform Engineer' });
    expect(res.error).toBeUndefined();

    const rows = await periods();
    expect(rows).toHaveLength(1); // the whole point: no period opened, none closed
    expect(rows[0].role).toBe('Platform Engineer');
    expect(rows[0].startDate.toISOString().slice(0, 10)).toBe('2022-01-01');
    expect(rows[0].endDate).toBeNull();
  });

  it('fixes a wrong EMPLOYER in place — the row that was always meant to say Honda', async () => {
    const res = await revise({ partnerId: honda, role: 'Cockpit Platform Lead' });
    expect(res.error).toBeUndefined();

    const rows = await periods();
    expect(rows).toHaveLength(1);
    expect(rows[0].partnerId).toBe(honda);
    // The cache means "where do they work today", and today's employer was corrected.
    const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
    expect(person.currentPartnerId).toBe(honda);
  });

  it('refuses an employer correction in a career GAP — that is what a date is for', async () => {
    await prisma.personAffiliation.updateMany({
      where: { personId }, data: { endDate: new Date('2023-01-01T00:00:00Z') },
    });
    const res = await revise({ partnerId: honda, role: 'Cockpit Platform Lead' });
    expect(res.error).toMatch(/no current employment period/i);
    expect((await periods())[0].partnerId).toBe(bosch); // untouched
  });

  it('still corrects name, address and notes with no company at all', async () => {
    const res = await revise({ name: 'Alice B Waters', email: 'alice.b@google.example', notes: 'On loan' });
    expect(res.error).toBeUndefined();
    const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
    expect(person).toMatchObject({ name: 'Alice B Waters', email: 'alice.b@google.example', notes: 'On loan' });
    expect(await periods()).toHaveLength(1);
  });
});

describe('an effective date — a change, recorded', () => {
  it('needs a company and role, and says which control clears the requirement', async () => {
    const res = await revise({ effectiveDate: isoDay(30) });
    expect(res.error).toMatch(/clear the effective date/i);
    expect(await periods()).toHaveLength(1);
  });

  it('stamps the OUTGOING address onto the period it closes (autoknow-wu0)', async () => {
    // The period covering today carries no address (it predates #127 E8, like most
    // history). Her current address is by definition the address of the job she holds
    // today, so closing that job is the last moment it is known for certain.
    expect((await periods())[0].email).toBeNull();

    const res = await revise({ partnerId: honda, role: 'Cockpit Platform Lead', effectiveDate: isoDay(-10) });
    expect(res.error).toBeUndefined();

    const rows = await periods();
    expect(rows[0].email).toBe('alice@google.example'); // the address she held AT Bosch
    expect(rows[1].email).toBe('alice@google.example'); // and holds now, at Honda
  });

  it('leaves a SCHEDULED period\'s address unrecorded — a future address is a guess', async () => {
    const res = await revise({ partnerId: honda, role: 'Cockpit Platform Lead', effectiveDate: isoDay(120) });
    expect(res.error).toBeUndefined();

    const rows = await periods();
    expect(rows[1].startDate.toISOString().slice(0, 10)).toBe(isoDay(120));
    expect(rows[1].email).toBeNull();
    // The OUTGOING period IS stamped, and the asymmetry is the rule working rather than
    // an inconsistency: "she works at Bosch today under this address" is true NOW, so
    // recording it is honest whenever the job ends. What she will use at Honda in four
    // months is not known now, and a guess is what the column exists to avoid (#127 E8).
    expect(rows[0].email).toBe('alice@google.example');
  });

  it('does not advance the person\'s own address for a scheduled change (Class 1)', async () => {
    const res = await revise({
      email: 'alice@honda.example', partnerId: honda, role: 'Cockpit Platform Lead',
      effectiveDate: isoDay(120),
    });
    expect(res.error).toBeUndefined();
    const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
    expect(person.email).toBe('alice@google.example'); // not yet — she still works at Bosch
    expect(person.currentPartnerId).toBe(bosch);
  });

  it('carries name and notes even when the change is scheduled — those are latest-wins', async () => {
    const res = await revise({
      name: 'Alice B Waters', notes: 'Moving in autumn',
      partnerId: honda, role: 'Cockpit Platform Lead', effectiveDate: isoDay(120),
    });
    expect(res.error).toBeUndefined();
    const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
    expect(person).toMatchObject({ name: 'Alice B Waters', notes: 'Moving in autumn' });
  });
});

describe('cancelling a scheduled change', () => {
  const scheduleHonda = async (offset: number) => {
    const res = await revise({ partnerId: honda, role: 'Cockpit Platform Lead', effectiveDate: isoDay(offset) });
    expect(res.error).toBeUndefined();
    const rows = await periods();
    return rows[rows.length - 1].id;
  };

  it('deletes the period and REOPENS what it had closed — the career is whole again', async () => {
    const scheduledId = await scheduleHonda(120);
    expect(await periods()).toHaveLength(2);

    const res = await cancelScheduledChange(form({ personId, affiliationId: scheduledId }));
    expect(res.error).toBeUndefined();

    const rows = await periods();
    expect(rows).toHaveLength(1);
    expect(rows[0].partnerId).toBe(bosch);
    expect(rows[0].endDate).toBeNull(); // reopened, not left ending in four months
  });

  it('refuses to cancel a change that has already ARRIVED — that is history', async () => {
    const arrivedId = await scheduleHonda(-10);
    const res = await cancelScheduledChange(form({ personId, affiliationId: arrivedId }));
    expect(res.error).toMatch(/already taken effect/i);
    expect(await periods()).toHaveLength(2);
  });

  it('will not cancel another person\'s period', async () => {
    const scheduledId = await scheduleHonda(120);
    const stranger = await prisma.person.create({
      data: { name: 'Noor', email: 'noor@example.com', currentPartnerId: bosch },
    });
    const res = await cancelScheduledChange(form({ personId: stranger.id, affiliationId: scheduledId }));
    expect(res.error).toMatch(/no longer exists/i);
    expect(await periods()).toHaveLength(2);
  });
});
