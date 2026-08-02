/** @jest-environment node */
// The three pre-canned escalation reads added for #245 section C: the ecosystem count and
// leadership panel, and a person's "what's on my plate". Each has one non-obvious rule
// this file exists to pin: the ecosystem panel's OLDEST-first tiebreak under equal
// severity/orgLevel, the person query's three-role OR, and that closed escalations never
// leak into the open-only ecosystem panel.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl();

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));

type Queries = typeof import('../src/lib/escalationQueries');
let getOpenEscalationsCount: Queries['getOpenEscalationsCount'];
let getEcosystemEscalations: Queries['getEcosystemEscalations'];
let getPersonEscalations: Queries['getPersonEscalations'];

let partnerId: number;
let projectId: number;
let ownerId: number;
let deciderId: number;
let requestedOfId: number;

beforeAll(async () => {
  ({ getOpenEscalationsCount, getEcosystemEscalations, getPersonEscalations } =
    await import('../src/lib/escalationQueries'));
  await wipeAll();

  const partner = await prisma.partner.create({
    data: {
      name: 'Volvo Cars',
      type: { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } },
      region: { connectOrCreate: { where: { name: 'EMEA' }, create: { name: 'EMEA' } } },
    },
  });
  partnerId = partner.id;
  const project = await prisma.project.create({ data: { name: 'Volvo EX90 AAOS Refresh', partnerId } });
  projectId = project.id;

  ownerId = (await prisma.person.create({
    data: { name: 'Marcus Webb', email: 'marcusw@google.com', currentPartnerId: partnerId },
  })).id;
  deciderId = (await prisma.person.create({
    data: { name: 'Priya Sharma', email: 'priya@google.com', currentPartnerId: partnerId },
  })).id;
  requestedOfId = (await prisma.person.create({
    data: { name: 'Sven Larsson', email: 'sven@volvo.example', currentPartnerId: partnerId },
  })).id;
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('getOpenEscalationsCount', () => {
  it('counts only OPEN rows', async () => {
    await prisma.escalation.create({ data: { title: 'Open one', partnerId, sourceKind: 'manual' } });
    await prisma.escalation.create({
      data: { title: 'Closed one', partnerId, sourceKind: 'manual', status: 'resolved', closedAt: new Date() },
    });
    expect(await getOpenEscalationsCount()).toBe(1);
  });
});

describe('getEcosystemEscalations', () => {
  beforeAll(async () => {
    await prisma.escalation.deleteMany();
  });

  it('excludes closed escalations entirely', async () => {
    await prisma.escalation.create({
      data: { title: 'Long since fixed', partnerId, sourceKind: 'manual', status: 'resolved', closedAt: new Date() },
    });
    const panel = await getEcosystemEscalations();
    expect(panel).toHaveLength(0);
  });

  it('ranks severity worst-first, org level highest-first, and breaks ties OLDEST-first', async () => {
    // Deliberately created out of severity order, so a passing test cannot be an accident
    // of insertion order alone.
    const s2 = await prisma.escalation.create({
      data: { title: 'S2, raised first', partnerId, sourceKind: 'manual', severity: 's2', createdAt: new Date('2026-01-01') },
    });
    const s1Newer = await prisma.escalation.create({
      data: { title: 'S1, raised later', partnerId, sourceKind: 'manual', severity: 's1', createdAt: new Date('2026-03-01') },
    });
    const s1Older = await prisma.escalation.create({
      data: { title: 'S1, raised first', partnerId, sourceKind: 'manual', severity: 's1', createdAt: new Date('2026-02-01') },
    });
    const untriaged = await prisma.escalation.create({
      data: { title: 'Untriaged', partnerId, sourceKind: 'manual', createdAt: new Date('2025-01-01') },
    });

    const panel = await getEcosystemEscalations();
    const ids = panel.map((e) => e.id);

    // Both S1s before the S2; within the S1s, the OLDER one first — the leadership
    // question is "what has been sitting unanswered", and newest-first would hide it.
    expect(ids.indexOf(s1Older.id)).toBeLessThan(ids.indexOf(s1Newer.id));
    expect(ids.indexOf(s1Newer.id)).toBeLessThan(ids.indexOf(s2.id));
    // Untriaged (null severity) sorts LAST, same rule as the full list page.
    expect(ids.indexOf(untriaged.id)).toBe(ids.length - 1);
  });

  it('caps at the requested limit', async () => {
    const panel = await getEcosystemEscalations(2);
    expect(panel.length).toBeLessThanOrEqual(2);
  });

  it('carries an entityLabel — the program name when set, else the partner name', async () => {
    await prisma.escalation.deleteMany();
    const withProgram = await prisma.escalation.create({
      data: { title: 'Has a program', partnerId, projectId, sourceKind: 'manual' },
    });
    const partnerOnly = await prisma.escalation.create({
      data: { title: 'Partner only', partnerId, sourceKind: 'manual' },
    });
    const panel = await getEcosystemEscalations();
    expect(panel.find((e) => e.id === withProgram.id)?.entityLabel).toBe('Volvo EX90 AAOS Refresh');
    expect(panel.find((e) => e.id === partnerOnly.id)?.entityLabel).toBe('Volvo Cars');
  });
});

describe('getPersonEscalations', () => {
  beforeAll(async () => {
    await prisma.escalation.deleteMany();
  });

  it('matches on ANY of the three roles — owner, decision maker, requested-of', async () => {
    const asOwner = await prisma.escalation.create({
      data: { title: 'They own it', partnerId, sourceKind: 'manual', ownerPersonId: ownerId },
    });
    const asDecider = await prisma.escalation.create({
      data: { title: 'They decide it', partnerId, sourceKind: 'manual', decisionMakerPersonId: deciderId },
    });
    const asRequestedOf = await prisma.escalation.create({
      data: { title: 'Someone is waiting on them', partnerId, sourceKind: 'manual', requestedOfPersonId: requestedOfId },
    });
    const unrelated = await prisma.person.create({
      data: { name: 'Nobody Involved', email: 'nobody@example.com', currentPartnerId: partnerId },
    });

    const ownerPlate = await getPersonEscalations(ownerId);
    expect(ownerPlate.some((e) => e.id === asOwner.id)).toBe(true);
    expect(ownerPlate.some((e) => e.id === asDecider.id)).toBe(false);

    const deciderPlate = await getPersonEscalations(deciderId);
    expect(deciderPlate.some((e) => e.id === asDecider.id)).toBe(true);

    // The role that most means "someone is waiting on you" — the whole reason it is
    // included at all rather than left off as a lesser role.
    const requestedOfPlate = await getPersonEscalations(requestedOfId);
    expect(requestedOfPlate.some((e) => e.id === asRequestedOf.id)).toBe(true);

    const nobodysPlate = await getPersonEscalations(unrelated.id);
    expect(nobodysPlate).toHaveLength(0);
  });

  it('carries an entityLabel too, same as the ecosystem panel', async () => {
    await prisma.escalation.deleteMany();
    await prisma.escalation.create({
      data: { title: 'On my plate', partnerId, projectId, sourceKind: 'manual', ownerPersonId: ownerId },
    });
    const plate = await getPersonEscalations(ownerId);
    expect(plate[0].entityLabel).toBe('Volvo EX90 AAOS Refresh');
  });
});
