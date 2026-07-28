/** @jest-environment node */
// seedMockData creates its data THROUGH the application's API routes and server
// actions (docs/CRITICAL_CHAIN_VIEW_PLAN.md §6), so this suite is the proof that the
// mutation boundaries accept the whole seed and that what lands is correct by
// construction: canonical owners, resolved assignees, canonical health labels,
// dated histories that survive newest-wins ordering, and dependency edges that
// passed cycle rejection.
import { testDatabaseUrl } from './helpers/testDatabaseUrl';
process.env.DATABASE_URL = testDatabaseUrl();

import { prisma, disconnectTestDb } from './helpers/db';
import { BUILTIN_TEMPLATES } from '../src/lib/builtinTemplates';
import { MOCK_CORPUS } from '../src/lib/mockCorpus';

jest.mock('server-only', () => ({}));
jest.mock('../src/auth', () => ({ authConfigured: false, auth: jest.fn(async () => null) }));
jest.mock('../src/lib/session', () => ({
  getCurrentUser: jest.fn(async () => ({ handle: 'dev', display: '@dev', email: 'dev@google.com', name: 'Dev Eloper', image: null })),
  getAccessToken: jest.fn(async () => null),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

// The full seed touches every route many times; give it room.
jest.setTimeout(180_000);

beforeAll(async () => {
  const { seedMockData } = await import('../src/lib/seed');
  await seedMockData();
});

afterAll(async () => {
  await disconnectTestDb();
});

describe('seedMockData through the API', () => {
  it('lands the full entity graph', async () => {
    // 1 Google + 4 classic + 10 enrichment partners.
    expect(await prisma.partner.count()).toBe(15);
    // 6 classic-era people + Alice Waters (created with them because she owns a classic
    // program) + 8 enrichment. FIFTEEN, not sixteen: the 'Alice PM' persona is retired,
    // and there is now exactly one Alice.
    expect(await prisma.person.count()).toBe(15);
    // 4 classic + 7 enrichment + 4 showcase + 3 Alice-era programs.
    expect(await prisma.project.count()).toBe(18);
    expect(await prisma.phaseDependency.count()).toBeGreaterThan(0);
    expect(await prisma.phasePartner.count()).toBeGreaterThan(0);
    expect(await prisma.phasePerson.count()).toBeGreaterThan(0);
    // One row per authored corpus entry — asserted against the corpus itself, because a
    // literal here would have to be edited every time a document is added and would
    // therefore be edited to whatever the code produced (the a-test-sharing-the-codes-
    // hard-coded-answer trap). What is worth asserting is that every entry landed.
    expect(await prisma.contextUrl.count()).toBe(MOCK_CORPUS.length);
  });

  it('every ingested source carries the freshness identity the refresh cycle needs', async () => {
    // Seeded sources must be indistinguishable from pasted ones, or the whole freshness
    // path silently has nothing to act on. A row missing any of these is invisible to the
    // refresh cycle, to /manage/sources, and to the feed's "Updated: …" card.
    const rows = await prisma.contextUrl.findMany({
      select: { sourceRef: true, contentHash: true, mode: true, url: true, addedBy: true },
    });
    for (const row of rows) {
      expect(row.sourceRef).toMatch(/^mock:/);
      expect(row.contentHash).toEqual(expect.any(String));
      expect(row.addedBy).toEqual(expect.any(String));
    }
    // Every source starts its history with an initial revision (delta null).
    expect(await prisma.contextRevision.count()).toBe(MOCK_CORPUS.length);
  });

  it('anchors every source to something — a corpus entry attached to nothing is invisible', async () => {
    const orphans = await prisma.contextUrl.findMany({
      where: { projectId: null, partnerId: null, phaseId: null },
      select: { title: true },
    });
    expect(orphans).toEqual([]);
  });

  it('program owners are canonical emails of existing people (requireOwner at the route)', async () => {
    const byName = async (name: string) =>
      prisma.project.findFirstOrThrow({ where: { name }, select: { ownerName: true } });
    // The lead-PM persona is bound to the SIGNED-IN identity (mocked to dev@google.com
    // above), not to a literal in the seed — see 'the lead PM is the signed-in user'.
    expect((await byName('Ford Evos AAOS Bring-up')).ownerName).toBe('dev@google.com');
    // Unchanged, and that is the point: the route stores the resolved email, not the
    // string the seed passes, so retiring the persona that used to hold this address
    // moves the owner (it is Alice Waters now) without moving the value. NOT true of
    // prod, seeded when neither the resolution nor the Person rows existed — see
    // docs/knowledge/a-backfills-unmatched-rows-may-name-people-who-never-existed.md.
    expect((await byName('Toyota Highlander Digital Key')).ownerName).toBe('alice@google.com');
    expect((await byName('Ford Explorer VHAL Integration (Bosch)')).ownerName).toBe('clara@google.com');
    expect((await byName('Honda Accord AAOS Bring-up')).ownerName).toBe('marcusw@google.com');

    // Every seeded owner resolves to a person on file — none is freeform text.
    const owners = await prisma.project.findMany({
      select: { ownerName: true, ownerPersonId: true },
    });
    const people = await prisma.person.findMany({ select: { id: true, email: true } });
    const emails = new Set(people.map((p) => p.email));
    const idByEmail = new Map(people.map((p) => [p.email, p.id]));
    for (const { ownerName } of owners) {
      expect(ownerName && emails.has(ownerName)).toBe(true);
    }

    // …and the DUAL WRITE happened (#127 E6): the seed goes through POST /api/projects
    // like every other caller, so an ownerPersonId missing here means the seam that is
    // supposed to make writing one column without the other impossible has a hole.
    for (const { ownerName, ownerPersonId } of owners) {
      expect(ownerPersonId).toBe(idByEmail.get(ownerName as string));
    }
  });

  // The seed cannot anticipate who is signed in — a real Workspace login is
  // whatever Google returns (dylan@alwaysmap.com), not the address someone typed
  // into this file. So the lead-PM persona is minted FROM the session, and /me
  // lands on a person whose email really is the login. Guarded because the failure
  // is silent and only shows up in a demo: the nav says one address, the Me page
  // shows another, and the programs "you" own belong to a stranger.
  it('the lead PM persona is the signed-in user, not a hardcoded identity', async () => {
    // Name AND address come from the session (mocked above): 'Dev Eloper' appears
    // nowhere in the seed, so matching it proves the row was minted from the
    // identity rather than from any string the seeder authored.
    const me = await prisma.person.findFirstOrThrow({ where: { email: 'dev@google.com' } });
    expect(me.name).toBe('Dev Eloper');

    // resolvePerson matches the session email EXACTLY — the ownership chips, the
    // action-item assignees and /me all agree on one row.
    const ownedByMe = await prisma.project.count({ where: { ownerName: 'dev@google.com' } });
    expect(ownedByMe).toBeGreaterThan(0);

    // Nothing anywhere reintroduced the literal the seed used to carry. (The third
    // place it could hide, Partner.googleTeam, no longer gets seeded at all — #127 E13.)
    expect(await prisma.person.count({ where: { email: 'dylan@google.com' } })).toBe(0);
    expect(await prisma.project.count({ where: { ownerName: 'dylan@google.com' } })).toBe(0);
  });

  it('health labels are canonical — the routes normalized the legacy risk values', async () => {
    const bosch = await prisma.project.findFirstOrThrow({
      where: { name: 'Ford Explorer VHAL Integration (Bosch)' },
    });
    expect(bosch.theNeedle).toBe('Concerned'); // seeded as legacy 'High'
    expect(bosch.hillChartProgress).toBe(60);

    const allStates = await prisma.projectState.findMany({ select: { theNeedle: true } });
    for (const s of allStates) {
      expect(['On Track', 'Some Risk', 'Concerned']).toContain(s.theNeedle);
    }
  });

  it('project columns agree with the newest project state (the needle route writes both in one tx)', async () => {
    const projects = await prisma.project.findMany({
      include: { states: { orderBy: { timestamp: 'desc' }, take: 1 } },
    });
    for (const p of projects) {
      expect(p.states).toHaveLength(1);
      expect(p.states[0].theNeedle).toBe(p.theNeedle);
      expect(p.states[0].hillChartProgress).toBe(p.hillChartProgress);
    }
  });

  it('showcase phases carry dated histories and the newest row is the real progress', async () => {
    const gemini = await prisma.project.findFirstOrThrow({
      where: { name: 'Gemini X Cockpit' },
      include: { phases: { include: { states: { orderBy: { timestamp: 'desc' } } } } },
    });
    const cert = gemini.phases.find((ph) => ph.name === 'Cert');
    expect(cert).toBeDefined();
    // Initial state + 3 dated rows, all in the past, newest-first = 30%.
    expect(cert!.states.length).toBeGreaterThanOrEqual(4);
    expect(cert!.states[0].hillChartProgress).toBe(30);
    for (const s of cert!.states) {
      expect(s.timestamp.getTime()).toBeLessThan(Date.now());
    }
    // The Active toggle landed an explicit start.
    expect(cert!.startedAt).not.toBeNull();

    const hw = gemini.phases.find((ph) => ph.name === 'HW bring-up');
    expect(hw!.states[0].hillChartProgress).toBe(100);
    // History spans months — the buffer-trend replay has something to chew on.
    const span = hw!.states[0].timestamp.getTime() - hw!.states[hw!.states.length - 1].timestamp.getTime();
    expect(span).toBeGreaterThan(60 * 86_400_000);
  });

  it('classic dated histories beat the phase-create initial state (stateTimestamp override)', async () => {
    const ford = await prisma.project.findFirstOrThrow({
      where: { name: 'Ford Evos AAOS Bring-up' },
      include: { phases: { include: { states: { orderBy: { timestamp: 'desc' } } } } },
    });
    const bsp = ford.phases.find((ph) => ph.name === 'BSP & power-on');
    expect(bsp!.states[0].hillChartProgress).toBe(100);
    expect(bsp!.states[0].status).toBe('Done');
    // The auto-created initial row exists and sits at the back of the history.
    const oldest = bsp!.states[bsp!.states.length - 1];
    expect(oldest.hillChartProgress).toBe(0);
  });

  // Demo programs instantiate the REAL built-in templates, so they carry the researched
  // phase set, its DAG, and each phase's Goal + provable Done-when — not a bare stub.
  // Derived from BUILTIN_TEMPLATES so editing a template can't silently desync the demo.
  it('phases and dependency edges mirror the built-in AAOS template', async () => {
    const aaos = BUILTIN_TEMPLATES.find((t) => t.name.startsWith('AAOS'))!;
    const ford = await prisma.project.findFirstOrThrow({
      where: { name: 'Ford Evos AAOS Bring-up' },
      include: { phases: true },
    });

    expect(ford.phases.map((p) => p.name).sort()).toEqual(aaos.phases.map((p) => p.name).sort());
    for (const p of ford.phases) {
      expect(p.description).toMatch(/\*\*Goal:\*\*/);
      expect(p.description).toMatch(/\*\*Done when:\*\*/);
      expect(p.googleFocus?.trim()).toBeTruthy();
    }
    // Exactly one convergence point, carried over from the template.
    expect(ford.phases.filter((p) => p.isEndPhase).map((p) => p.name)).toEqual(
      aaos.phases.filter((p) => p.isEndPhase).map((p) => p.name),
    );

    const edges = await prisma.phaseDependency.count({
      where: { phaseId: { in: ford.phases.map((p) => p.id) } },
    });
    expect(edges).toBe(aaos.phases.reduce((n, p) => n + p.dependsOn.length, 0));
  });

  it('action items resolved their assignees to people (resolvePerson at the route)', async () => {
    const dylan = await prisma.person.findFirstOrThrow({ where: { email: 'dev@google.com' } });
    const kenji = await prisma.person.findFirstOrThrow({ where: { email: 'kenji.sato@toyota.com' } });

    const vhal = await prisma.actionItem.findFirstOrThrow({
      where: { description: 'Determine cause for VHAL wait time delay' },
    });
    expect(vhal.assignedToPersonId).toBe(dylan.id);
    expect(vhal.source).toBe('Buganizer');
    expect(vhal.sourceUrl).toContain('buganizer');

    const cluster = await prisma.actionItem.findFirstOrThrow({
      where: { description: 'Verify cluster instrumentation panel interface specifications' },
    });
    expect(cluster.assignedToPersonId).toBe(kenji.id);

    // NOTHING seeded strands any more, and that is #127 E8's whole point in data.
    // The case that used to fail is Alice Waters' 2025 item, addressed to
    // `awaters@qualcomm.com` — the account she held at the time and shares no local
    // part with her current one. While a Person carried ONE address, resolvePerson had
    // nothing to match and the item detached from the only human it could mean (spec
    // #124 Class 4). Her Qualcomm period now records that address, so it resolves.
    //
    // Asserted as an empty LIST, not a count of zero: when this regresses, the failure
    // names the address that stopped resolving, which is the whole diagnosis.
    const unlinked = await prisma.actionItem.findMany({
      where: { assignedToPersonId: null },
      select: { assignedTo: true },
    });
    expect(unlinked.map((a) => a.assignedTo)).toEqual([]);

    // And it resolves to HER, not to some near-miss the local-part tier reached for.
    const qualcommEraItem = await prisma.actionItem.findFirstOrThrow({
      where: { assignedTo: 'awaters@qualcomm.com' },
    });
    const alice = await prisma.person.findFirstOrThrow({
      where: { email: 'alice@google.com' },
    });
    expect(qualcommEraItem.assignedToPersonId).toBe(alice.id);
  });

  // The temporal-profile fixture (spec #124 §7): one human, four periods. Guarded
  // here because every later piece of that work is demonstrated against THIS data,
  // and a fixture that silently loses a boundary would make the demos lie.
  it('Alice Waters carries four contiguous periods, with Honda still in the future', async () => {
    const alice = await prisma.person.findFirstOrThrow({
      where: { email: 'alice@google.com' },
      include: { affiliations: { include: { partner: true }, orderBy: { startDate: 'asc' } } },
    });
    const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

    // The three settled periods carry literal dates — a career is a fact. Honda's
    // start is derived, so it is asserted by its PROPERTIES further down instead.
    expect(alice.affiliations.map((a) => [a.partner.name, a.role])).toEqual([
      ['Bosch', 'Platform Engineer'],
      ['Qualcomm', 'Staff Engineer'],
      ['Google LLC', 'Lead Program Manager'],
      ['Honda', 'Cockpit Platform Lead'],
    ]);
    expect(alice.affiliations.slice(0, 3).map((a) => [iso(a.startDate), iso(a.endDate)])).toEqual([
      ['2022-01-01', '2024-03-01'],
      ['2024-03-01', '2026-07-01'],
      ['2026-07-01', iso(alice.affiliations[3].startDate)], // closed AT the scheduled move
    ]);

    // Half-open and contiguous: each period ends exactly where the next begins, so
    // there is no gap and no overlap anywhere in the career.
    const [bosch, qualcomm, google, honda] = alice.affiliations;
    expect(iso(bosch.endDate)).toBe(iso(qualcomm.startDate));
    expect(iso(qualcomm.endDate)).toBe(iso(google.startDate));
    expect(iso(google.endDate)).toBe(iso(honda.startDate));
    expect(honda.endDate).toBeNull();

    // The Honda move is DERIVED, so it is in the future on every re-seed — that is
    // what makes it exercise Class 1 at all. Asserted by properties, not by a
    // literal: genuinely ahead, by months rather than days, and on a month
    // boundary (§7 states the move as a month, "2026-11").
    const now = Date.now();
    expect(honda.startDate.getTime()).toBeGreaterThan(now + 60 * 86_400_000);
    expect(honda.startDate.getUTCDate()).toBe(1);
    expect(google.startDate.getTime()).toBeLessThanOrEqual(now);
    expect(google.endDate!.getTime()).toBeGreaterThan(now);

    // The scheduled move is RECORDED but not APPLIED (#124 Class 1, fixed). The
    // Honda affiliation above exists — the move is on the books — yet the cache the
    // identity line reads still points at the company she is actually at today.
    // This assertion is the whole point of routing the fixture through the real
    // `movePersonCompany`: it is what would go red if the action ever went back to
    // advancing `currentPartnerId` unconditionally.
    const current = await prisma.partner.findUniqueOrThrow({ where: { id: alice.currentPartnerId } });
    expect(current.name).toBe('Google LLC');

    // Work inside each window, not just date ranges: Bosch-era and Qualcomm-era
    // phase involvement, plus TEL ownership of a live program under Google.
    const involvements = await prisma.phasePerson.findMany({
      where: { personId: alice.id },
      select: { phase: { select: { project: { select: { name: true } } } } },
    });
    expect(involvements.map((i) => i.phase.project.name).sort()).toEqual([
      'Bosch TCU Gen-2 Platform', 'Honda CR-V Cockpit Bring-up', 'Qualcomm SA8155P Cockpit Validation',
    ]);
    // Ownership is matched on the ID, not on the address, because that is the column the
    // demo will actually read once #127 E7 moves the readers onto the FK — and it is the
    // one that would survive her next move. Two programs, from two directions: the Toyota
    // one she inherits from the retired persona, and her Google-era program, already hers
    // before this change.
    const owned = await prisma.project.findMany({
      where: { ownerPersonId: alice.id },
      select: { name: true, ownerName: true },
    });
    expect(owned.map((p) => p.name).sort())
      .toEqual(['Honda CR-V Cockpit Bring-up', 'Toyota Highlander Digital Key']);
    expect(new Set(owned.map((p) => p.ownerName))).toEqual(new Set(['alice@google.com']));
  });

  it('relationship journal keeps the ghost-ring pair with canonical derived health', async () => {
    const honda = await prisma.partner.findFirstOrThrow({ where: { name: 'Honda' } });
    const states = await prisma.partnerState.findMany({
      where: { partnerId: honda.id },
      orderBy: { timestamp: 'desc' },
    });
    expect(states).toHaveLength(2);
    expect(states[0].relationshipScore).toBe(4);
    expect(states[0].theNeedle).toBe('On Track'); // scoreToHealth(4)
    expect(states[1].relationshipScore).toBe(3);
    expect(states[1].theNeedle).toBe('Some Risk'); // scoreToHealth(3)
    expect(states[0].notes).toBeTruthy(); // the journal requires a written note
  });

  // Faulty-mock-data guard. A phase must not be seeded as started (current progress
  // > 0) while any dependency is still incomplete — that would draw the schedule
  // chart as if a downstream phase began before its prerequisite finished, which the
  // DAG forbids. seedTemplatePhases enforces it for template programs; the chain-ledger
  // showcase is hand-authored to respect it. This asserts it holds across EVERY seeded
  // program, so a future edit that reintroduces the incoherence fails loudly here. (A
  // deliberate edge case would be documented and exempted — none exists today.)
  it('no phase is started before its dependencies are complete (DAG coherence)', async () => {
    const projects = await prisma.project.findMany({
      include: {
        phases: {
          include: {
            states: { orderBy: { timestamp: 'desc' }, take: 1 },
            dependencies: true,
          },
        },
      },
    });
    const violations: string[] = [];
    for (const proj of projects) {
      const progressById = new Map(proj.phases.map((ph) => [ph.id, ph.states[0]?.hillChartProgress ?? 0]));
      const nameById = new Map(proj.phases.map((ph) => [ph.id, ph.name]));
      for (const ph of proj.phases) {
        const progress = progressById.get(ph.id) ?? 0;
        if (progress <= 0) continue; // not started — nothing to gate
        for (const dep of ph.dependencies) {
          const depProgress = progressById.get(dep.dependsOnPhaseId) ?? 0;
          if (depProgress < 100) {
            violations.push(
              `${proj.name}: "${ph.name}" is ${progress}% but its dependency ` +
                `"${nameById.get(dep.dependsOnPhaseId)}" is only ${depProgress}%`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
