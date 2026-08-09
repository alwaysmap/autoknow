/** @jest-environment node */
// The bulk-add table's loader (gh-286 part f): who is addable, and what the derived
// Products column claims. Two facts live in the query, not the schema, so a JS-level
// test could pass while the page listed a current member or let an initiative copy's
// all-false product flags stand in for a partner's real device programs. DB pattern
// follows tests/initiativeActions.test.ts.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';
import { productUnion } from '../src/lib/partnerProducts';

jest.mock('server-only', () => ({}));

type Queries = typeof import('../src/lib/initiativeQueries');
let getAddablePartners: Queries['getAddablePartners'];

const flags = (over: Partial<Record<'hasGas' | 'hasGbi' | 'hasDigitalKey' | 'hasAap', boolean>> = {}) => ({
  hasGas: false, hasGbi: false, hasDigitalKey: false, hasAap: false, ...over,
});

describe('productUnion', () => {
  it('is the union across programs, in canonical key order', () => {
    expect(productUnion([flags({ hasAap: true }), flags({ hasGas: true, hasAap: true })]))
      .toEqual(['gas', 'aap']);
  });

  it('is empty for no programs and for all-false programs', () => {
    expect(productUnion([])).toEqual([]);
    expect(productUnion([flags()])).toEqual([]);
  });
});

describe('getAddablePartners', () => {
  let initiativeId: number;

  beforeAll(async () => {
    ({ getAddablePartners } = await import('../src/lib/initiativeQueries'));
    await wipeAll();
    const template = await prisma.programTemplate.create({ data: { name: 'wf' } });
    const initiative = await prisma.initiative.create({
      data: { name: 'Fleet rollout', templateId: template.id, createdBy: 'dev' },
    });
    initiativeId = initiative.id;

    const region = (name: string) => ({ connectOrCreate: { where: { name }, create: { name } } });
    const oem = { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } };

    // BMW: an ACTIVE member — must not be listed.
    const bmw = await prisma.partner.create({ data: { name: 'BMW', type: oem, region: region('EMEA') } });
    await prisma.initiativePartner.create({ data: { initiativeId, partnerId: bmw.id } });

    // Audi: a REMOVED member — must be listed (re-adding is legal). Its products come
    // from its real program, never from the initiative copy left behind by the earlier
    // membership (copies are created all-false, so counting one would report nothing —
    // this fixture gives the copy a product so leakage would ADD a wrong key instead).
    const audi = await prisma.partner.create({ data: { name: 'Audi', type: oem, region: region('EMEA') } });
    await prisma.initiativePartner.create({
      data: { initiativeId, partnerId: audi.id, status: 'removed', removedAt: new Date() },
    });
    await prisma.project.create({ data: { name: 'Audi Q9', partnerId: audi.id, ...flags({ hasGbi: true }) } });
    await prisma.project.create({
      data: { name: 'Fleet rollout — Audi', partnerId: audi.id, initiativeId, lifecycle: 'cancelled', ...flags({ hasDigitalKey: true }) },
    });

    // Toyota: never a member, two programs whose products union.
    const toyota = await prisma.partner.create({ data: { name: 'Toyota', type: oem, region: region('APAC') } });
    await prisma.project.create({ data: { name: 'Corolla', partnerId: toyota.id, ...flags({ hasGas: true }) } });
    await prisma.project.create({ data: { name: 'Hilux', partnerId: toyota.id, ...flags({ hasAap: true }) } });

    // Honda: never a member, no programs at all.
    await prisma.partner.create({ data: { name: 'Honda', type: oem, region: region('APAC') } });
  });

  afterAll(async () => {
    await wipeAll();
    await disconnectTestDb();
  });

  it('lists non-members and removed members, never active members, name-ordered', async () => {
    const rows = await getAddablePartners(initiativeId);
    expect(rows.map((r) => r.name)).toEqual(['Audi', 'Honda', 'Toyota']);
  });

  it('derives Products from real device programs only, with type and region along', async () => {
    const rows = await getAddablePartners(initiativeId);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['Toyota']).toMatchObject({ typeName: 'OEM', regionName: 'APAC', products: ['gas', 'aap'] });
    expect(byName['Audi'].products).toEqual(['gbi']); // the copy's digitalKey never leaks in
    expect(byName['Honda'].products).toEqual([]);
  });
});
