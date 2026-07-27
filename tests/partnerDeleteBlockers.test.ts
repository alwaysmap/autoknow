/** @jest-environment node */
// `autoknow-aa7`. The partner delete dialog pre-flights `deletePartner`'s guard, and the
// two used to count different things: the dialog took `partnerRosterAsOf(...).current`
// (who works here today, per the affiliations) while the guard counted the
// `Person.currentPartnerId` FK (what the DELETE would actually break). Those disagree
// whenever the cache is stale against the affiliations — and then the dialog offered a
// delete that the action refused, or refused one the action would have allowed.
//
// This suite is the mechanical version of "they cannot disagree": it builds BOTH stale
// cases and asserts the blockers the dialog is handed predict what `deletePartner` does.
// Each case first asserts that the roster and the FK really do differ, so the pin cannot
// pass because the fixture stopped being stale.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
// deletePartner ends in redirect('/partners'), which works by throwing; `guarded` lets it
// propagate. Stubbing it keeps "the delete went through" a distinguishable outcome rather
// than an exception the assertions would have to guess at.
jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  }),
}));

type Partners = typeof import('../src/app/actions/partners');
type Deletion = typeof import('../src/lib/partnerDeletion');
type Profiles = typeof import('../src/lib/profiles');
let deletePartner: Partners['deletePartner'];
let getPartnerDeleteBlockers: Deletion['getPartnerDeleteBlockers'];
let partnerRosterAsOf: Profiles['partnerRosterAsOf'];

const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };

/** Run the action the way the dialog does: FormData in, `{ error }` or a redirect out. */
async function runDelete(partnerId: number): Promise<{ error?: string; deleted: boolean }> {
  const fd = new FormData();
  fd.set('partnerId', String(partnerId));
  try {
    const result = await deletePartner(fd);
    return { error: result.error, deleted: false };
  } catch (e) {
    // The redirect stub: the only way out of a delete that succeeded.
    if (String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) return { deleted: true };
    throw e;
  }
}

beforeAll(async () => {
  ({ deletePartner } = await import('../src/app/actions/partners'));
  ({ getPartnerDeleteBlockers } = await import('../src/lib/partnerDeletion'));
  ({ partnerRosterAsOf } = await import('../src/lib/profiles'));
});

beforeEach(async () => {
  await wipeAll();
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe('the delete dialog and the delete guard cannot disagree', () => {
  it('refuses when the cache still points here and the affiliation has moved on', async () => {
    // The between-jobs shape tests/people.spec.ts already fixtures: Bosch is still written
    // on the person row, but their Bosch period ended before today and nothing replaced it.
    const bosch = await prisma.partner.create({ data: { name: 'Bosch', region } });
    const person = await prisma.person.create({
      data: { name: 'Alice Waters', email: 'alice@bosch.example', currentPartnerId: bosch.id },
    });
    await prisma.personAffiliation.create({
      data: {
        personId: person.id,
        partnerId: bosch.id,
        role: 'Engineer',
        startDate: new Date('2021-01-01'),
        endDate: new Date('2025-06-30'),
      },
    });

    // The fixture is genuinely stale: nobody works here as of today…
    expect((await partnerRosterAsOf(bosch.id)).current).toEqual([]);
    // …and the OLD dialog would have offered the delete on exactly that number.
    const blockers = await getPartnerDeleteBlockers(bosch.id);
    expect(blockers.employeeCount).toBe(1);
    expect(blockers.blocked).toBe(true);

    const outcome = await runDelete(bosch.id);
    expect(outcome.deleted).toBe(false);
    // Asserted WHOLE, not by substring: this is the submit-time English, and its job is to
    // say what `partnerHasPeople` says in four locales. Pinning the sentence is what turns
    // a drift between the two into a failure (`lib/partnerDeletion`).
    expect(outcome.error).toBe(
      'Partner is still the employer on 1 person record(s) — reassign them first',
    );
    expect(await prisma.partner.count({ where: { id: bosch.id } })).toBe(1);
  });

  it('allows the delete when someone works here but their record points elsewhere', async () => {
    // The mirror image, and the one the old dialog got wrong in the other direction: the
    // roster says one person is here today, so the dialog refused — while the guard, and
    // Postgres, had nothing to object to.
    const honda = await prisma.partner.create({ data: { name: 'Honda', region } });
    const denso = await prisma.partner.create({ data: { name: 'Denso', region } });
    const person = await prisma.person.create({
      data: { name: 'Kenji Sato', email: 'kenji@denso.example', currentPartnerId: denso.id },
    });
    await prisma.personAffiliation.create({
      data: { personId: person.id, partnerId: honda.id, role: 'Engineer', startDate: new Date('2024-01-01'), endDate: null },
    });

    expect((await partnerRosterAsOf(honda.id)).current).toHaveLength(1);
    const blockers = await getPartnerDeleteBlockers(honda.id);
    expect(blockers.employeeCount).toBe(0);
    expect(blockers.blocked).toBe(false);

    const outcome = await runDelete(honda.id);
    expect(outcome.deleted).toBe(true);
    expect(await prisma.partner.count({ where: { id: honda.id } })).toBe(0);
  });

  it('counts owned programs the same way the guard does', async () => {
    // The dialog's other number. It used to come from `getPartnerPrograms(...)` filtered to
    // `relationship === 'owner'` — a second implementation of the guard's `project.count`,
    // agreeing only for as long as nobody changed one of them.
    const rivian = await prisma.partner.create({ data: { name: 'Rivian', region } });
    const denso = await prisma.partner.create({ data: { name: 'Denso', region } });
    const project = await prisma.project.create({
      data: { name: 'R1S AAOS', partnerId: rivian.id, ownerName: 'dylan' },
    });
    // Denso is INVOLVED through a phase but owns nothing — involvement must not block.
    const phase = await prisma.phase.create({ data: { projectId: project.id, name: 'Integration' } });
    await prisma.phasePartner.create({ data: { phaseId: phase.id, partnerId: denso.id } });

    expect(await getPartnerDeleteBlockers(rivian.id)).toMatchObject({ programCount: 1, blocked: true });
    expect(await getPartnerDeleteBlockers(denso.id)).toMatchObject({ programCount: 0, blocked: false });

    expect((await runDelete(rivian.id)).error).toBe(
      'Partner still owns 1 program(s) — reassign or delete them first',
    );
    expect((await runDelete(denso.id)).deleted).toBe(true);
  });

  it('lets the delete through when nothing points at the partner', async () => {
    const orphan = await prisma.partner.create({ data: { name: 'Nobody Inc', region } });
    expect(await getPartnerDeleteBlockers(orphan.id)).toMatchObject({
      programCount: 0, employeeCount: 0, blocked: false,
    });
    expect((await runDelete(orphan.id)).deleted).toBe(true);
    expect(await prisma.partner.count({ where: { id: orphan.id } })).toBe(0);
  });
});
