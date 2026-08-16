/** @jest-environment node */
// #167: "active work" has ONE definition (lib/activeWork), and two surfaces depend on it
// agreeing with itself — the Critical Chain's owner-load bullet states a COUNT, and the
// person page's Programs table holds the ROWS that count links to. Before this, the
// program page spelled the predicate inline as `p > 0 && p < 100` over programs the
// person OWNS, and the person page had no notion of active work at all.
//
// These pin the two arms the definition deliberately draws at different distances (a TEL
// is on the hook for every phase of a program they lead; being named on one phase says
// nothing about the rest), plus the exclusions, plus the fact that the Programs table's
// ACTIVE status is that same answer rather than a second one.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl(); // bind lib/db to the *_test database

import { prisma, disconnectTestDb } from './helpers/db';
import { wipeAll } from './helpers/fixtures';

jest.mock('server-only', () => ({}));

// Dynamic import AFTER the env assignment above (docs/knowledge).
let personActivePhases: typeof import('../src/lib/activeWork')['personActivePhases'];
let projectIdsOf: typeof import('../src/lib/activeWork')['projectIdsOf'];
let personProgramRows: typeof import('../src/lib/personPrograms')['personProgramRows'];

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let personId: number;
const project: Record<string, number> = {};

beforeAll(async () => {
  ({ personActivePhases, projectIdsOf } = await import('../src/lib/activeWork'));
  ({ personProgramRows } = await import('../src/lib/personPrograms'));
  await wipeAll();

  const region = { connectOrCreate: { where: { name: 'AMER' }, create: { name: 'AMER' } } };
  const type = { connectOrCreate: { where: { name: 'OEM' }, create: { name: 'OEM' } } };
  const partner = await prisma.partner.create({ data: { name: 'Rivian', region, type } });

  const person = await prisma.person.create({
    data: { name: 'Priya Sharma', email: 'priya@example.com', currentPartnerId: partner.id },
  });
  personId = person.id;
  await prisma.personAffiliation.create({
    data: { personId, partnerId: partner.id, role: 'TEL', startDate: d('2020-01-01') },
  });

  /** A phase with its latest progress, optionally explicitly started, optionally with
   *  this person named on it. */
  const mkPhase = async (
    projectId: number, name: string,
    opts: { progress?: number; startedAt?: Date; named?: boolean } = {},
  ) => {
    const phase = await prisma.phase.create({
      data: { name, projectId, ...(opts.startedAt ? { startedAt: opts.startedAt } : {}) },
    });
    if (opts.progress != null) {
      await prisma.phaseState.create({
        data: { phaseId: phase.id, status: 'x', hillChartProgress: opts.progress, timestamp: d('2026-01-01') },
      });
    }
    if (opts.named) await prisma.phasePerson.create({ data: { phaseId: phase.id, personId, role: 'FAE' } });
    return phase;
  };

  const mkProject = async (name: string, opts: { owned?: boolean; archived?: boolean } = {}) => {
    const p = await prisma.project.create({
      data: {
        name, partnerId: partner.id,
        ...(opts.owned ? { ownerPersonId: personId } : {}),
        ...(opts.archived ? { isArchived: true } : {}),
      },
    });
    project[name] = p.id;
    return p.id;
  };

  // LED, with a mixed bag of phases: only the two that are actually running count, and
  // they count even though this person is named on neither — leading the program is the
  // attachment.
  const led = await mkProject('Led', { owned: true });
  await mkPhase(led, 'Led · running', { progress: 40 });
  await mkPhase(led, 'Led · marked started, hill unmoved', { progress: 0, startedAt: d('2026-02-01') });
  await mkPhase(led, 'Led · finished', { progress: 100 });
  await mkPhase(led, 'Led · never touched');

  // NAMED on one phase: only that phase counts, however busy the rest of the program is.
  const named = await mkProject('Named');
  await mkPhase(named, 'Named · mine, running', { progress: 60, named: true });
  await mkPhase(named, 'Named · someone else, running', { progress: 60 });
  await mkPhase(named, 'Named · mine, finished', { progress: 100, named: true });

  // Reached by an ACTION ITEM only — the third route.
  const viaAction = await mkProject('Via action');
  const actionPhase = await mkPhase(viaAction, 'Via action · running', { progress: 25 });
  await prisma.actionItem.create({
    data: { phaseId: actionPhase.id, description: 'Chase the bench', status: 'Pending', assignedToPersonId: personId },
  });

  // Attached, nothing running — the row that reads Current rather than Active.
  const quiet = await mkProject('Quiet', { owned: true });
  await mkPhase(quiet, 'Quiet · not started');

  // Archived programs are not work.
  const archived = await mkProject('Archived', { owned: true, archived: true });
  await mkPhase(archived, 'Archived · running', { progress: 50 });
});

afterAll(async () => {
  await wipeAll();
  await disconnectTestDb();
});

describe('personActivePhases', () => {
  test('a program they LEAD contributes every running phase, named on it or not', async () => {
    const phases = await personActivePhases(personId);
    const led = phases.filter((p) => p.projectId === project['Led']).map((p) => p.phaseName).sort();
    // The explicitly-started phase at 0% is in, because the predicate is `isPhaseActive`
    // — the same one the rail reads. The old inline `p > 0 && p < 100` dropped it, so the
    // rail called it In Progress and the count did not.
    expect(led).toEqual(['Led · marked started, hill unmoved', 'Led · running']);
  });

  test('a program they are NAMED on contributes only their own running phases', async () => {
    const phases = await personActivePhases(personId);
    const named = phases.filter((p) => p.projectId === project['Named']).map((p) => p.phaseName);
    expect(named).toEqual(['Named · mine, running']);
  });

  test('an action item is an attachment too', async () => {
    const phases = await personActivePhases(personId);
    expect(phases.filter((p) => p.projectId === project['Via action'])).toHaveLength(1);
  });

  test('archived programs and programs with nothing running are absent', async () => {
    const ids = projectIdsOf(await personActivePhases(personId));
    expect(ids.has(project['Archived'])).toBe(false);
    expect(ids.has(project['Quiet'])).toBe(false);
    expect([...ids].sort()).toEqual([project['Led'], project['Named'], project['Via action']].sort());
  });

  test('excludeProjectId drops the program already being read — the bullet\'s "elsewhere"', async () => {
    const ids = projectIdsOf(await personActivePhases(personId, { excludeProjectId: project['Led'] }));
    expect(ids.has(project['Led'])).toBe(false);
    expect(ids.size).toBe(2);
  });
});

describe('the Programs table status', () => {
  test('ACTIVE is exactly what personActivePhases found; attached-but-quiet stays Current', async () => {
    const person = await prisma.person.findUniqueOrThrow({
      where: { id: personId },
      include: {
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
      where: { ownerPersonId: personId }, select: { id: true, name: true },
    });
    const rows = await personProgramRows({
      owned,
      phaseInvolvements: person.phaseInvolvements,
      actionItems: person.actionItems,
      career: person.affiliations,
      activeProjectIds: projectIdsOf(await personActivePhases(personId)),
    });
    const byName = new Map(rows.map((r) => [r.name, r.status]));

    // The three the definition found, and only those. This is the assertion that makes
    // the count in the Critical Chain sentence and the rows behind its link the same
    // question asked once.
    expect(byName.get('Led')).toBe('active');
    expect(byName.get('Named')).toBe('active');
    expect(byName.get('Via action')).toBe('active');
    expect(byName.get('Quiet')).toBe('live');
    // An archived program still LISTS (the table is a person's record, and the query
    // behind it does not hide archived rows) — it just is not WORK, so its running phase
    // buys it no Active badge.
    expect(byName.get('Archived')).toBe('live');
  });
});
