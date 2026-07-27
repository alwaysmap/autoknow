/** @jest-environment node */
// #127 E10. `FeedScope { kind: 'person' }` — the ONE feed scope that narrows by ACTOR
// rather than by subject, and the only surface where an item's company must be resolved
// per ROW instead of once per page.
//
// Against a real database, for the same reason `profilesAsOf.test.ts` is: the actor
// filter is an `OR` of case-insensitive equals over free-text columns, and a JS-level
// test of the alias rule would pass while the query returned the wrong rows.
//
// The fixture is one career with a MOVE inside the span of the updates — the shape that
// breaks #124 Class 2, where every historical row gets stamped with today's employer.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { personAliases, resolvePerson } from '../src/lib/people';

jest.mock('server-only', () => ({}));

// Dynamic import AFTER the env assignment above — a static one is hoisted and would
// evaluate src/lib/db before DATABASE_URL is set (docs/knowledge).
let getActivity: typeof import('../src/lib/activity').getActivity;

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Her stable handle: what `getCurrentUser().handle` writes into `source`, unchanged by
 *  a move — which is exactly why an item's company cannot be read off it. */
const HANDLE = 'awaters';

let alice: number;
let stranger: number;
let bosch: number;
let google: number;
let projectId: number;

beforeAll(async () => {
  ({ getActivity } = await import('../src/lib/activity'));
  await wipeAll();

  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
  const mk = async (name: string) => (await prisma.partner.create({ data: { name, region } })).id;
  bosch = await mk('Bosch');
  google = await mk('Google LLC');

  alice = (await prisma.person.create({
    data: { name: 'Alice Waters', email: `${HANDLE}@google.com`, currentPartnerId: google },
  })).id;
  // A second REAL person who also writes updates — a one-author fixture would pass with
  // no actor filter at all.
  stranger = (await prisma.person.create({
    data: { name: 'Bob Miller', email: 'bob@google.com', currentPartnerId: google },
  })).id;

  const period = (partnerId: number, role: string, start: string, end: string | null) =>
    prisma.personAffiliation.create({
      data: { personId: alice, partnerId, role, startDate: d(start), endDate: end ? d(end) : null },
    });
  await period(bosch, 'Platform Engineer', '2022-01-01', '2024-03-01');
  await period(google, 'Lead Program Manager', '2024-03-01', null);

  projectId = (await prisma.project.create({
    data: { name: 'Gen-2 Platform', partnerId: bosch },
  })).id;

  // Four updates on one program: two of hers either side of the move, one by somebody
  // else, one by the seed. The last two are what the person scope must NOT return.
  const update = (source: string | null, at: string, notes: string) =>
    prisma.projectState.create({
      data: {
        projectId, theNeedle: 'On Track', hillChartProgress: 50,
        notes, source, timestamp: d(at),
      },
    });
  await update(HANDLE, '2023-06-01', 'Bosch-era update');
  await update(HANDLE, '2025-06-01', 'Google-era update');
  await update('bob', '2025-06-02', 'Somebody else entirely');
  await update('seed', '2025-06-03', 'Nobody wrote this');
  // Older than her first period — the gap case. Authored HERE, not inside the `it` that
  // asserts on it: a row added mid-suite changes the dataset every later test sees.
  await update(HANDLE, '2019-01-01', 'Before she was anywhere');
});

afterAll(async () => {
  // Leave the shared database as we found it — see profilesAsOf.test.ts for why an
  // exact-count suite elsewhere depends on it.
  await wipeAll();
  await disconnectTestDb();
});

describe('personAliases', () => {
  // The round trip is the contract: `personAliases` is only sound if every string it
  // emits comes back through `resolvePerson`. A new branch in one and not the other is
  // exactly the drift the two-functions-one-file arrangement exists to catch.
  it('emits only strings that resolvePerson maps back to the same person', () => {
    const person = { id: 7, name: 'Alice Waters', email: 'awaters@qualcomm.com' };
    const aliases = personAliases(person);
    expect(aliases).toEqual(expect.arrayContaining([
      'awaters@qualcomm.com', 'awaters', '@awaters', 'alice waters',
    ]));
    for (const alias of aliases) {
      expect(resolvePerson([person], alias)?.id).toBe(7);
    }
  });

  it('emits no empties and no duplicates, so an OR over it cannot match everything', () => {
    expect(personAliases({ id: 1, name: '', email: '' })).toEqual([]);
    const same = personAliases({ id: 2, name: 'awaters', email: 'awaters@google.com' });
    expect(new Set(same).size).toBe(same.length);
  });
});

describe('getActivity, person scope', () => {
  it('returns only what this person recorded', async () => {
    const items = await getActivity({ kind: 'person', id: alice });
    const notes = items.map((i) => i.detail);
    expect(notes).toContain('Bosch-era update');
    expect(notes).toContain('Google-era update');
    expect(notes).not.toContain('Somebody else entirely');
    // The stated limit, pinned: a row whose actor is not a human is absent by
    // construction, which is why the UI copy says so instead of implying she was idle.
    expect(notes).not.toContain('Nobody wrote this');
  });

  it('attributes each item AS OF ITS OWN DAY, not as of today', async () => {
    const items = await getActivity({ kind: 'person', id: alice });
    const subtitleOf = (note: string) => items.find((i) => i.detail === note)?.subtitle ?? '';
    // The whole of #124 Class 2 in two assertions: same human, same program, two
    // employers, decided by WHEN each update was written.
    expect(subtitleOf('Bosch-era update')).toContain('Bosch');
    expect(subtitleOf('Bosch-era update')).toContain('Platform Engineer');
    expect(subtitleOf('Google-era update')).toContain('Google LLC');
    expect(subtitleOf('Google-era update')).toContain('Lead Program Manager');
    // Stamping today's employer on the old row is the defect; assert it is absent
    // rather than only asserting the right answer is present.
    expect(subtitleOf('Bosch-era update')).not.toContain('Google LLC');
  });

  it('says nothing about a company for a day outside every period', async () => {
    const items = await getActivity({ kind: 'person', id: alice });
    const before = items.find((i) => i.detail === 'Before she was anywhere');
    expect(before).toBeDefined();
    expect(before?.subtitle ?? '').not.toContain('Bosch');
    expect(before?.subtitle ?? '').not.toContain('Google LLC');
  });

  it('drops "by <handle>", which is the same word on every row of a person feed', async () => {
    const items = await getActivity({ kind: 'person', id: alice });
    expect(items.every((i) => !(i.subtitle ?? '').includes(`by ${HANDLE}`))).toBe(true);
    // …while the scope that spans authors keeps it.
    const ecosystem = await getActivity({ kind: 'ecosystem' });
    expect(ecosystem.some((i) => (i.subtitle ?? '').includes(`by ${HANDLE}`))).toBe(true);
  });

  it('gives the OTHER author only their own row, so the filter is real', async () => {
    const items = await getActivity({ kind: 'person', id: stranger });
    expect(items.map((i) => i.detail)).toEqual(['Somebody else entirely']);
  });

  it('returns nothing for an id that names nobody', async () => {
    // Fail-closed, and pinned rather than assumed: the early return could be deleted and
    // Prisma's empty `OR` would still match no rows — but a future refactor that reaches
    // for `AND: []` or drops the wrapper entirely widens this to the whole ecosystem.
    expect(await getActivity({ kind: 'person', id: 987654 })).toEqual([]);
  });
});
