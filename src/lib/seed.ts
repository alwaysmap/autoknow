import { prisma } from './db';
import { ingestContent } from './ingest';
import { MOCK_CORPUS, mockSourceRef, mockVersion, type MockSource } from './mockCorpus';
import { reindexAll } from './search';
import { scoreToHealth } from './relationship';
import { ensureBuiltinTemplates } from './programTemplates';
import { assertDestructiveDbAllowed } from './dbSafety';
import { getCurrentUser } from './session';
import { localDate } from './dates';

// The mock seeder creates its data THROUGH the application's own mutation
// boundaries — API route handlers invoked in-process, plus the server actions for
// surfaces that have no route (dependencies, involvements, the Active toggle).
// Rationale (docs/CRITICAL_CHAIN_VIEW_PLAN.md §6): the seed then exercises the API
// and inherits its constraints — zod validation, name→id resolution, owner/person
// resolution, parentage checks, derived status, cycle rejection — so seeded data is
// correct by construction. Dated histories ride the routes' seed-only `timestamp`
// override, which is fail-closed on the same lib/dbSafety policy as the wipe below.
//
// Deliberate direct-write residue (each commented at the site): reference lookup
// tables, Partner.phone/googleTeam, backdated relationship history, and the ingest
// dates of the authored corpus.
import { POST as postPartnerRoute } from '../app/api/partners/route';
import { POST as postPersonRoute } from '../app/api/people/route';
import { POST as postAffiliationRoute } from '../app/api/people/[id]/affiliations/route';
import { POST as postProjectRoute } from '../app/api/projects/route';
import { POST as postNeedleRoute } from '../app/api/projects/[id]/needle/route';
import { POST as postPhaseRoute } from '../app/api/projects/[id]/phases/route';
import { POST as postPhaseStateRoute } from '../app/api/projects/[id]/phases/[phaseId]/state/route';
import { POST as postActionItemRoute } from '../app/api/projects/[id]/phases/[phaseId]/action-items/route';
import { addPhaseDependency } from '../app/actions/dependencies';
import { movePersonCompany } from '../app/actions/people';
import { addPhasePartner } from '../app/actions/phasePartners';
import { addPhasePerson } from '../app/actions/phasePeople';
import { setPhaseStarted } from '../app/actions/hill';

// Phase progress is no longer hand-authored per program: the template-based programs
// derive it from their plan position (seedPhasesFromBuiltin), which keeps it
// DAG-coherent by construction.

export async function wipeAllData() {
  // Fail closed: refuse unless the target DB is a disposable *_test database or the
  // operator has explicitly named THIS database in DESTRUCTIVE_DB_ALLOWED. seedCore/
  // seedMock both funnel through here, so this one guard covers every wipe path.
  assertDestructiveDbAllowed('wipe all data');
  console.log('Wiping all database records...');
  await prisma.actionItem.deleteMany();
  await prisma.contextRevision.deleteMany();
  await prisma.syncCursor.deleteMany();
  await prisma.contextUrl.deleteMany();
  await prisma.phasePartner.deleteMany();
  await prisma.phasePerson.deleteMany();
  await prisma.phaseState.deleteMany();
  await prisma.phaseDependency.deleteMany();
  await prisma.phase.deleteMany();
  await prisma.projectState.deleteMany();
  await prisma.summary.deleteMany();
  await prisma.summaryPrompt.deleteMany();
  await prisma.partnerState.deleteMany();
  await prisma.project.deleteMany();
  await prisma.personAffiliation.deleteMany();
  await prisma.person.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.region.deleteMany();
  await prisma.partnerType.deleteMany();
}

/**
 * Seed the core reference data (partner types, regions, the Google partner).
 * IDEMPOTENT and non-destructive: it upserts the reference rows and find-or-creates
 * Google LLC, so running it repeatedly converges to the same state without duplicates
 * and without touching any operational data (partners, programs, history). Safe to run
 * against a live database — it never wipes.
 */
export async function seedCoreData() {
  console.log('Seeding core reference data (idempotent)...');

  // PartnerType.name and Region.name are @unique — upsert by name.
  const typeOem = await prisma.partnerType.upsert({ where: { name: 'OEM' }, update: {}, create: { name: 'OEM' } });
  await prisma.partnerType.upsert({ where: { name: 'Supplier' }, update: {}, create: { name: 'Supplier' } });

  const regAmer = await prisma.region.upsert({ where: { name: 'AMER' }, update: {}, create: { name: 'AMER' } });
  for (const name of ['APAC', 'EMEA', 'Other']) {
    await prisma.region.upsert({ where: { name }, update: {}, create: { name } });
  }

  // Partner.name is NOT unique, so find-or-create the default Google partner
  // (employees affiliate to it). A concurrent double-run could still race here; the
  // reference-data path is single-operator, so a findFirst guard is sufficient.
  const google = await prisma.partner.findFirst({ where: { name: 'Google LLC' }, select: { id: true } });
  if (!google) {
    await prisma.partner.create({ data: { name: 'Google LLC', typeId: typeOem.id, regionId: regAmer.id } });
  }
}

// ---------------------------------------------------------------------------------
// In-process API invocation. The route handlers ARE the mutation boundary; calling
// them directly (the tests/phaseStateRoute.test.ts pattern) exercises the exact same
// code an HTTP client hits — auth check, zod parse, resolution, derived fields —
// without needing a base URL or a live socket, so seeding works identically from the
// admin console, the /api/admin/seed route, jest, and Playwright's dev server.
// ---------------------------------------------------------------------------------

// `params: Promise<never>` makes every concrete route signature assignable here
// (parameter contravariance); the one cast below hands each handler the exact
// params object its own type declares.
type ApiHandler = (
  req: Request,
  props: { params: Promise<never> },
) => Promise<Response>;

async function apiPost<T>(
  handler: ApiHandler,
  path: string,
  body: unknown,
  params: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // requireRouteAuth admits a session or a valid admin token. When seeding runs
  // inside a signed-in request the session applies; the token covers headless
  // callers (curl to /api/admin/seed) on deployments where auth is configured.
  if (process.env.ADMIN_TOKEN) headers['x-admin-token'] = process.env.ADMIN_TOKEN;
  const req = new Request(`http://seed.internal${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve(params) as Promise<never> });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(`Seed POST ${path} failed (${res.status}): ${json?.error ?? 'unknown error'}`);
  }
  return json;
}

/** FormData for the server actions (dependencies, involvements, Active toggle). */
function fd(fields: Record<string, string | number>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, String(v));
  return f;
}

interface CreatedPartner { partner: { id: number } }
interface CreatedPerson { person: { id: number } }
interface CreatedProject { project: { id: number } }
interface CreatedPhase { phase: { id: number } }

async function createPartner(body: {
  name: string; type: string; region: string;
  website?: string; internalDetailsUrl?: string; summary?: string;
}): Promise<number> {
  const { partner } = await apiPost<CreatedPartner>(postPartnerRoute, '/api/partners', body);
  return partner.id;
}

async function createPerson(body: {
  name: string; email: string; currentPartnerId: number; notes?: string;
}): Promise<number> {
  const { person } = await apiPost<CreatedPerson>(postPersonRoute, '/api/people', body);
  return person.id;
}

async function addAffiliation(
  personId: number,
  body: { partnerId: number; role: string; startDate: string; endDate?: string },
): Promise<void> {
  await apiPost(postAffiliationRoute, `/api/people/${personId}/affiliations`, body, {
    id: String(personId),
  });
}

async function createProject(body: {
  name: string; partnerId: number; ownerName: string; sopDate?: string; volumeFirstYear?: number;
}): Promise<number> {
  const { project } = await apiPost<CreatedProject>(postProjectRoute, '/api/projects', body);
  return project.id;
}

/** Append a program status update (and sync the Project columns) via the needle route. */
async function postProjectState(
  projectId: number,
  body: {
    theNeedle: string; hillChartProgress: number; notes?: string | null;
    source?: string; sourceUrl?: string; timestamp?: string;
  },
): Promise<void> {
  await apiPost(postNeedleRoute, `/api/projects/${projectId}/needle`, body, {
    id: String(projectId),
  });
}

/** Create a phase; `stateTimestamp` backdates its auto-created initial state so the
 *  dated history posted afterwards stays the newest-wins truth. */
async function createPhase(
  projectId: number,
  body: { name: string; forecastedDuration: number; stateTimestamp?: string },
): Promise<number> {
  const { phase } = await apiPost<CreatedPhase>(
    postPhaseRoute, `/api/projects/${projectId}/phases`, body, { id: String(projectId) },
  );
  return phase.id;
}

async function postPhaseState(
  projectId: number,
  phaseId: number,
  body: {
    theNeedle?: string; hillChartProgress: number; notes?: string | null;
    source?: string | null; sourceUrl?: string | null; timestamp?: string;
  },
): Promise<void> {
  await apiPost(
    postPhaseStateRoute,
    `/api/projects/${projectId}/phases/${phaseId}/state`,
    body,
    { id: String(projectId), phaseId: String(phaseId) },
  );
}

async function createActionItem(
  projectId: number,
  phaseId: number,
  body: {
    description: string; assignedTo: string; status: 'Pending' | 'Completed';
    nextStep: 'Undecided' | 'Resolved' | 'Partner' | 'Googler';
    linkUrl?: string; source?: string; sourceUrl?: string;
  },
): Promise<void> {
  await apiPost(
    postActionItemRoute,
    `/api/projects/${projectId}/phases/${phaseId}/action-items`,
    body,
    { id: String(projectId), phaseId: String(phaseId) },
  );
}

/** Dependency edges go through the server action so its cycle rejection applies. */
async function addDependency(projectId: number, phaseId: number, dependsOnPhaseId: number): Promise<void> {
  const result = await addPhaseDependency(fd({ phaseId, dependsOnPhaseId, projectId }));
  if (result.error) {
    throw new Error(`Seed dependency ${dependsOnPhaseId} → ${phaseId} rejected: ${result.error}`);
  }
}

async function involvePartner(projectId: number, phaseId: number, partnerId: number, role?: string): Promise<void> {
  await addPhasePartner(fd({ phaseId, partnerId, projectId, role: role ?? '' }));
}

async function involvePerson(projectId: number, phaseId: number, personId: number, role?: string): Promise<void> {
  const result = await addPhasePerson(fd({ phaseId, personId, projectId, role: role ?? '' }));
  if (result.error) {
    throw new Error(`Seed phase-person involvement failed: ${result.error}`);
  }
}

/** The Active toggle: explicit "work has begun" claim, day precision. */
async function markStarted(projectId: number, phaseId: number, startedOn: Date): Promise<void> {
  await setPhaseStarted(fd({ phaseId, projectId, startedOn: startedOn.toISOString().slice(0, 10) }));
}

/**
 * Backdated relationship journal entries. PartnerState has no API route — the only
 * mutation surface is the updatePartnerRelationship action, which stamps at write
 * time — so DATED relationship history stays direct-write (the §6 fallback), with
 * theNeedle derived through the canonical scoreToHealth so feed/filters stay
 * coherent with what the action would have written.
 */
async function recordRelationship(
  partnerId: number,
  entry: { score: number; notes: string; timestamp: Date; hillChartProgress?: number },
): Promise<void> {
  await prisma.partnerState.create({
    data: {
      partnerId,
      relationshipScore: entry.score,
      theNeedle: scoreToHealth(entry.score),
      hillChartProgress: entry.hillChartProgress ?? 0,
      notes: entry.notes,
      source: 'seed',
      timestamp: entry.timestamp,
    },
  });
}

/**
 * Ingest the authored corpus (lib/mockCorpus) through the app's REAL ingest boundary.
 *
 * Going through `ingestContent` is what makes a seeded source indistinguishable from one
 * a user pasted — same dedupe, digest, embedding, contentHash and initial
 * ContextRevision — so the whole freshness path has something real to act on. Why that
 * is a rule rather than a preference: [ADR: Seeded content moves through the real
 * connectors](../../docs/adr/2026-07-25-seeded-content-runs-the-real-pipeline-and-fakes-only-the-schedule.md).
 *
 * Anchors are authored as NAMES and resolved here, and an unresolvable name THROWS
 * rather than attaching to nothing: a corpus entry silently anchored to null would read
 * as "ingested fine" while being invisible on every page it was written for.
 */
async function seedMockCorpus(): Promise<number> {
  const [projects, partners] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true } }),
    prisma.partner.findMany({ select: { id: true, name: true } }),
  ]);
  const projectByName = new Map(projects.map((p) => [p.name, p.id]));
  const partnerByName = new Map(partners.map((p) => [p.name, p.id]));

  const resolveAnchor = async (s: MockSource) => {
    let projectId: number | null = null;
    let partnerId: number | null = null;
    let phaseId: number | null = null;

    if (s.anchor.program) {
      projectId = projectByName.get(s.anchor.program) ?? null;
      if (projectId == null) throw new Error(`Corpus "${s.key}": no program named "${s.anchor.program}".`);
    }
    if (s.anchor.partner) {
      partnerId = partnerByName.get(s.anchor.partner) ?? null;
      if (partnerId == null) throw new Error(`Corpus "${s.key}": no partner named "${s.anchor.partner}".`);
    }
    if (s.anchor.phase) {
      if (projectId == null) throw new Error(`Corpus "${s.key}": a phase anchor needs a program anchor.`);
      const phase = await prisma.phase.findFirst({
        where: { projectId, name: s.anchor.phase },
        select: { id: true },
      });
      if (!phase) throw new Error(`Corpus "${s.key}": "${s.anchor.program}" has no phase "${s.anchor.phase}".`);
      phaseId = phase.id;
    }
    return { projectId, partnerId, phaseId };
  };

  let ingested = 0;
  for (const s of MOCK_CORPUS) {
    const anchor = await resolveAnchor(s);
    const v0 = s.revisions[0];
    const result = await ingestContent({
      url: s.url,
      title: s.title,
      text: v0.text,
      source: { kind: s.kind, mode: s.mode, sourceRef: mockSourceRef(s.key) },
      mode: s.mode,
      modeSource: s.modeSource,
      sourceVersion: mockVersion(0),
      anchor,
      addedBy: s.addedBy,
    });
    if (!result.ok || !result.contextUrlId) {
      throw new Error(`Corpus "${s.key}" failed to ingest: ${result.error ?? 'no row returned'}`);
    }

    // Documented direct-write residue, like recordRelationship above: ingestion stamps
    // "now" by design, and there is no mutation surface for a DATED ingest. Backdating is
    // what makes the corpus read as history instead of a wall of items created this second.
    //
    // This is NOT the falsified-timestamp the refresh path refuses to write (lib/refresh
    // cadenceScale, and the ADR cited above). The distinction is whose claim the column
    // carries: here it is the authored INGEST DATE of a document that is pretending to be
    // three weeks old, set once at creation. There it would be a claim that the app
    // PERFORMED a check it did not perform, overwriting a real observation with a false
    // one on every cycle.
    const at = new Date(Date.now() - v0.daysAgo * 86_400_000);
    await prisma.contextUrl.update({
      where: { id: result.contextUrlId },
      data: { createdAt: at, lastCheckedAt: at, lastChangedAt: at },
    });
    await prisma.contextRevision.updateMany({
      where: { contextUrlId: result.contextUrlId },
      data: { checkedAt: at },
    });
    ingested++;
  }
  return ingested;
}

const WEEK_MS = 7 * 86_400_000;

/** Load a built-in template and forward-pass its DAG: planned start = max(dependency
 *  planned ends). `planWeeks` is the critical path — the whole program's plan length. */
async function builtinPlan(templateName: string) {
  const template = await prisma.programTemplate.findFirstOrThrow({
    where: { name: templateName, isBuiltIn: true },
    include: { phases: { include: { dependsOn: true }, orderBy: { sortOrder: 'asc' } } },
  });
  const byId = new Map(template.phases.map((p) => [p.id, p]));
  const startWeeks = new Map<number, number>();
  const endWeeks = new Map<number, number>();
  const resolve = (id: number): number => {
    const done = endWeeks.get(id);
    if (done != null) return done;
    const p = byId.get(id)!;
    const start = p.dependsOn.length === 0 ? 0 : Math.max(...p.dependsOn.map((d) => resolve(d.dependsOnId)));
    startWeeks.set(id, start);
    const end = start + p.durationWeeks;
    endWeeks.set(id, end);
    return end;
  };
  for (const p of template.phases) resolve(p.id);
  return { template, startWeeks, endWeeks, planWeeks: Math.max(...endWeeks.values()) };
}

/** The SOP a program of this plan length would carry: whatever plan remains after
 *  today, plus a buffer, normalized to month end the way lib/sop expects. Keeps a
 *  demo program from reading as catastrophically late just because the real 15-phase
 *  AAOS plan is ~86 weeks long. */
async function sopForPlan(templateName: string, throughWeeks: number, bufferWeeks: number): Promise<string> {
  const { planWeeks } = await builtinPlan(templateName);
  const finish = new Date(Date.now() + (planWeeks - throughWeeks + bufferWeeks) * WEEK_MS);
  const monthEnd = new Date(Date.UTC(finish.getUTCFullYear(), finish.getUTCMonth() + 1, 0));
  return monthEnd.toISOString().slice(0, 10);
}

/**
 * Instantiate a demo program's phases from a BUILT-IN template — the same rich content
 * real program creation copies (lib/builtinTemplates: a **Goal** + provable **Done
 * when** checklist, googleFocus, plan durations and the converging DAG), so sample
 * programs read like real ones instead of nameless stubs.
 *
 * Progress and DATES are both DERIVED, never hand-authored. `throughWeeks` places the
 * program on its own plan and the calendar is anchored so that point is TODAY, so the
 * demo always reads as "now". Each phase's history is dated at its PLANNED window —
 * work begins at its planned start and a finished phase closes at its planned end — so
 * the schedule chart cascades down the DAG instead of collapsing every phase onto one
 * start date. Because a phase's planned start is max(its dependencies' planned ends),
 * progress > 0 implies every dependency is already complete: the DAG-coherence guard in
 * tests/seedMock holds by construction, with no per-phase tuning to drift out of sync.
 *
 * Returns name → phaseId so involvements and action items can attach to real phases.
 */
async function seedPhasesFromBuiltin(
  projectId: number,
  templateName: string,
  throughWeeks: number,
): Promise<Record<string, number>> {
  const { template, startWeeks, endWeeks } = await builtinPlan(templateName);
  const anchorMs = Date.now() - throughWeeks * WEEK_MS; // week 0 of the plan
  const at = (weeks: number) => new Date(anchorMs + weeks * WEEK_MS).toISOString().slice(0, 10);

  const idsByName: Record<string, number> = {};
  const phaseIdByTemplateId = new Map<number, number>();

  for (const p of template.phases) {
    const start = startWeeks.get(p.id)!;
    const end = endWeeks.get(p.id)!;
    const pct = Math.round(Math.max(0, Math.min(1, (throughWeeks - start) / p.durationWeeks)) * 100);
    const phase = await prisma.phase.create({
      data: {
        projectId,
        name: p.name,
        forecastedDuration: p.durationWeeks * 7, // templates store weeks; runtime is days
        description: p.description,
        googleFocus: p.googleFocus,
        isEndPhase: p.isEndPhase,
      },
    });
    idsByName[p.name] = phase.id;
    phaseIdByTemplateId.set(p.id, phase.id);

    // Backdated initial row, so a dated progress row stays newest-wins (CRITICAL_CHAIN §6).
    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: 'Not Started',
        theNeedle: 'On Track',
        hillChartProgress: 0,
        notes: 'Initial state',
        timestamp: new Date(anchorMs - 2 * WEEK_MS),
      },
    });

    if (pct > 0) {
      // Work began at the phase's planned start — this row is what the schedule chart
      // reads as startedAt, and it is what makes the bars cascade down the chain.
      await postPhaseState(projectId, phase.id, {
        theNeedle: 'On Track',
        hillChartProgress: Math.min(10, pct),
        notes: `${p.name} under way.`,
        source: 'seed',
        timestamp: at(start),
      });
      if (pct >= 100) {
        await postPhaseState(projectId, phase.id, {
          theNeedle: 'On Track', hillChartProgress: 100, notes: null, source: 'seed', timestamp: at(end),
        });
      } else if (pct > 10) {
        await postPhaseState(projectId, phase.id, {
          theNeedle: 'On Track',
          hillChartProgress: pct,
          notes: `${p.name} in flight.`,
          source: 'seed',
          timestamp: at(throughWeeks), // today
        });
      }
    }
  }

  // Edges go through the cycle-rejecting action, like the rest of the seed.
  for (const p of template.phases) {
    for (const d of p.dependsOn) {
      await addDependency(projectId, phaseIdByTemplateId.get(p.id)!, phaseIdByTemplateId.get(d.dependsOnId)!);
    }
  }
  return idsByName;
}

export async function seedMockData() {
  console.log('Seeding full mock data...');
  await wipeAllData();

  // WHO IS "ME": taken from the live session, never authored as a literal.
  //
  // The seed used to hardcode dylan@google.com as the lead PM. Signed in as a real
  // Workspace account (dylan@alwaysmap.com), /me then resolved to a person the
  // seed had invented and the app disagreed with itself about who you are — the
  // nav said one address, the Me page showed another, and the programs "you" own
  // belonged to a stranger. The seeder cannot anticipate the address, so it stops
  // guessing: it runs through the API routes as the signed-in user, so it just
  // ASKS. Every place that used to name Dylan now names `me.email`, which
  // resolvePerson matches exactly — so this holds for any login, not just Dylan's.
  const me = await getCurrentUser();
  console.log(`Seeding as ${me.name} <${me.email}> — the lead PM persona is bound to this login.`);

  // Reference lookup tables are seed/migration-owned — there is deliberately no API
  // that creates partner types or regions, so these two stay direct writes.
  console.log('Seeding lookup tables (Regions, Partner Types)...');
  for (const name of ['OEM', 'Supplier']) {
    await prisma.partnerType.create({ data: { name } });
  }
  for (const name of ['AMER', 'APAC', 'EMEA', 'Other']) {
    await prisma.region.create({ data: { name } });
  }

  // The built-in program templates are the source of the phases' Goal/"Done when"
  // content. wipeAllData leaves ProgramTemplate alone and this is idempotent, so it
  // just guarantees they exist before any program instantiates from them.
  await ensureBuiltinTemplates();

  console.log('Seeding partners (Google self + external OEM & supplier)...');
  // Type and region travel as NAMES — the partners route resolves them to ids and
  // 400s on unknowns, which is exactly the boundary check we want the seed to pass.
  const googlePartnerId = await createPartner({
    name: 'Google LLC', type: 'OEM', region: 'AMER',
    website: 'https://www.google.com',
    internalDetailsUrl: 'https://drive.google.com/drive/folders/google-internal',
    summary: 'Internal Google team profiles and program manager affiliations.',
  });
  const fordId = await createPartner({
    name: 'Ford', type: 'OEM', region: 'AMER',
    website: 'https://www.ford.com',
    internalDetailsUrl: 'https://drive.google.com/drive/folders/ford-partnership',
    summary: 'Strategic OEM partnership focused on Ford Evos AAOS software stack, instrument cluster integration, and cockpit security features.',
  });
  const toyotaId = await createPartner({
    name: 'Toyota', type: 'OEM', region: 'APAC',
    website: 'https://www.toyota-global.com',
    internalDetailsUrl: 'https://drive.google.com/drive/folders/toyota-partnership',
    summary: 'Long-term OEM relationship for standardizing Android Automotive OS components on next-gen e-TNGA EV platform architectures.',
  });
  const boschId = await createPartner({
    name: 'Bosch', type: 'Supplier', region: 'EMEA',
    website: 'https://www.bosch.com',
    internalDetailsUrl: 'https://drive.google.com/drive/folders/bosch-partnership',
    summary: 'Tier-1 supplier collaboration delivering telematics control units (TCU) and ADAS sensor suite calibration protocols.',
  });
  const qualcommId = await createPartner({
    name: 'Qualcomm', type: 'Supplier', region: 'AMER',
    website: 'https://www.qualcomm.com',
    internalDetailsUrl: 'https://drive.google.com/drive/folders/qualcomm-partnership',
    summary: 'Silicon provider alignment for optimizing Snapdragon Cockpit platforms (SA8155P/SA8295P) with Google Automotive Services (GAS).',
  });

  // Contact phone and the googleTeam roster are display-only fields with no
  // mutation surface (API or action) — patched directly onto the API-created rows.
  const contactPatches: Array<{ id: number; phone: string; googleTeam: { email: string; role: string }[] }> = [
    { id: googlePartnerId, phone: '+1-650-253-0000', googleTeam: [] },
    { id: fordId, phone: '+1-313-322-3000', googleTeam: [
      { email: me.email, role: 'Relationship Lead' },
      { email: 'bob@google.com', role: 'Cloud Account Manager' },
    ] },
    { id: toyotaId, phone: '+81-565-28-2121', googleTeam: [
      { email: 'alice@google.com', role: 'Partner Engineering Manager' },
    ] },
    { id: boschId, phone: '+49-711-400-40290', googleTeam: [
      { email: 'clara@google.com', role: 'Supplier Operations Lead' },
    ] },
    { id: qualcommId, phone: '+1-858-587-1121', googleTeam: [
      { email: me.email, role: 'Silicon Alignment Engineer' },
    ] },
  ];
  for (const patch of contactPatches) {
    await prisma.partner.update({
      where: { id: patch.id },
      data: { phone: patch.phone, googleTeam: patch.googleTeam },
    });
  }

  console.log('Seeding people...');
  // People come BEFORE programs: the projects route resolves each program's owner
  // against existing people and refuses freeform names.
  const meId = await createPerson({
    name: me.name, email: me.email, currentPartnerId: googlePartnerId,
    notes: 'Lead Program Manager for AutoKnow ecosystem and Ford relationship.',
  });
  const bobId = await createPerson({
    name: 'Bob AccountManager', email: 'bob@google.com', currentPartnerId: googlePartnerId,
    notes: 'Cloud Account Manager supervising OEM contract executions.',
  });
  const aliceId = await createPerson({
    name: 'Alice PM', email: 'alice@google.com', currentPartnerId: googlePartnerId,
    notes: 'Partner Engineering Manager for the Toyota relationship.',
  });
  const claraId = await createPerson({
    name: 'Clara Operations', email: 'clara@google.com', currentPartnerId: googlePartnerId,
    notes: 'Supplier Operations Lead covering Bosch programs.',
  });
  const kenjiId = await createPerson({
    name: 'Kenji Sato', email: 'kenji.sato@toyota.com', currentPartnerId: toyotaId,
    notes: 'VP of Software Engineering at Toyota Connected.',
  });
  const dieterId = await createPerson({
    name: 'Dieter Meyer', email: 'dieter.meyer@bosch.com', currentPartnerId: boschId,
    notes: 'Senior Lead ADAS architect at Bosch GmbH.',
  });
  const sarahId = await createPerson({
    name: 'Sarah Jenkins', email: 'sjenkins@qualcomm.com', currentPartnerId: qualcommId,
    notes: 'Qualcomm Snapdragon Cockpit product manager.',
  });

  console.log('Seeding person affiliations...');
  await addAffiliation(meId, { partnerId: googlePartnerId, role: 'Lead Program Manager', startDate: '2024-01-01' });
  await addAffiliation(bobId, { partnerId: googlePartnerId, role: 'Cloud Account Manager', startDate: '2024-03-15' });
  await addAffiliation(aliceId, { partnerId: googlePartnerId, role: 'Partner Engineering Manager', startDate: '2023-02-01' });
  await addAffiliation(claraId, { partnerId: googlePartnerId, role: 'Supplier Operations Lead', startDate: '2023-07-01' });
  await addAffiliation(kenjiId, { partnerId: toyotaId, role: 'VP of Software Engineering', startDate: '2022-06-01' });
  await addAffiliation(dieterId, { partnerId: boschId, role: 'Senior ADAS Systems Lead', startDate: '2023-01-10' });
  await addAffiliation(sarahId, { partnerId: qualcommId, role: 'Snapdragon Automotive PM', startDate: '2023-09-01' });

  // Demo programs instantiate these real templates, so their phases carry the
  // researched Goal/"Done when" content and the full DAG. `through` is how far into
  // the plan each program sits; SOPs derive from the plan so nothing reads as absurdly
  // late just because the real AAOS plan is ~86 weeks long.
  const AAOS_T = 'AAOS Bring-up (chipset \u2192 GBI)';
  const DK_T = 'Digital Key';
  const FORD_THROUGH = 48, BOSCH_THROUGH = 44, QUALCOMM_THROUGH = 38, TOYOTA_THROUGH = 5;

  console.log('Seeding projects...');

  // 1. Ford Evos AAOS Bring-up
  const fordProjectId = await createProject({
    name: 'Ford Evos AAOS Bring-up', partnerId: fordId, ownerName: me.email,
    sopDate: await sopForPlan(AAOS_T, FORD_THROUGH, 8), volumeFirstYear: 180000,
  });
  // Dated program history through the needle route, oldest first — the final post
  // also lands the Project columns on the current needle/hill.
  await postProjectState(fordProjectId, {
    theNeedle: 'Low', hillChartProgress: 20,
    notes: 'Initial blueprint kickoff complete.',
    source: 'Google Doc', sourceUrl: 'https://docs.google.com/document/d/ford-blueprint-kickoff',
    timestamp: '2026-05-01',
  });
  await postProjectState(fordProjectId, {
    theNeedle: 'Medium', hillChartProgress: 40,
    notes: 'Progressing on BSP, but VHAL wait times are elevated.',
    source: 'Google Chat', sourceUrl: 'https://chat.google.com/room/ford-evos-dev-talk',
    timestamp: '2026-06-15',
  });

  // ~48 weeks into the 86-week AAOS critical path: architecture, silicon, BSP and the
  // display/connectivity/EVS tracks are done; VHAL (the long pole) and the hypervisor
  // and app-platform tracks are in flight; compliance onward hasn't started.
  const fordPhases = await seedPhasesFromBuiltin(fordProjectId, AAOS_T, FORD_THROUGH);

  await createActionItem(fordProjectId, fordPhases['BSP & power-on'], {
    description: 'Determine cause for VHAL wait time delay',
    assignedTo: me.email, status: 'Pending', nextStep: 'Googler',
    linkUrl: 'https://buganizer.corp.google.com/issues/889218',
    source: 'Buganizer', sourceUrl: 'https://buganizer.corp.google.com/issues/889218',
  });
  await createActionItem(fordProjectId, fordPhases['BSP & power-on'], {
    description: 'Verify cluster instrumentation panel interface specifications',
    assignedTo: 'Kenji Sato', status: 'Pending', nextStep: 'Partner',
    linkUrl: 'https://docs.google.com/document/d/cluster-specs-evos',
    source: 'Google Doc', sourceUrl: 'https://docs.google.com/document/d/cluster-specs-evos',
  });

  // 2. Toyota Highlander Digital Key
  const toyotaProjectId = await createProject({
    name: 'Toyota Highlander Digital Key', partnerId: toyotaId, ownerName: 'Alice PM',
    sopDate: await sopForPlan(DK_T, TOYOTA_THROUGH, 4), volumeFirstYear: 250000,
  });
  await postProjectState(toyotaProjectId, {
    theNeedle: 'Low', hillChartProgress: 15,
    notes: 'Kickoff and initial threat modeling drafted.',
    source: 'Google Doc', sourceUrl: 'https://docs.google.com/document/d/toyota-digital-key-threat-model',
    timestamp: '2026-06-01',
  });

  // ~5 weeks into a 10-week Digital Key plan: the NFC and Secure Element tracks are
  // done and CCC conformance has just begun — an early-stage program.
  const toyotaPhases = await seedPhasesFromBuiltin(toyotaProjectId, DK_T, TOYOTA_THROUGH);

  await createActionItem(toyotaProjectId, toyotaPhases['Secure Element configuration'], {
    description: 'Review security key exchange protocols for Highlander',
    assignedTo: 'Kenji Sato', status: 'Pending', nextStep: 'Partner',
    linkUrl: 'https://docs.google.com/document/d/security-key-toyota',
    source: 'Google Doc', sourceUrl: 'https://docs.google.com/document/d/security-key-toyota',
  });

  // 3. Ford Explorer VHAL Integration (Bosch)
  const boschProjectId = await createProject({
    name: 'Ford Explorer VHAL Integration (Bosch)', partnerId: boschId, ownerName: 'Clara Operations',
    sopDate: await sopForPlan(AAOS_T, BOSCH_THROUGH, 6), volumeFirstYear: 120000,
  });
  await postProjectState(boschProjectId, {
    theNeedle: 'Medium', hillChartProgress: 50,
    notes: 'Initial integration testing succeeded.',
    source: 'Gerrit', sourceUrl: 'https://android-review.googlesource.com/c/platform/hardware/interfaces/+/12345',
    timestamp: '2026-05-15',
  });
  await postProjectState(boschProjectId, {
    theNeedle: 'High', hillChartProgress: 60,
    notes: 'Telemetry calibration failures reported in telemetry unit.',
    source: 'Buganizer', sourceUrl: 'https://buganizer.corp.google.com/issues/9987211',
    timestamp: '2026-06-25',
  });

  // ~44 weeks in: a little behind Ford Evos — VHAL is mid-flight and the parallel
  // tracks off BSP are closing out.
  const boschPhases = await seedPhasesFromBuiltin(boschProjectId, AAOS_T, BOSCH_THROUGH);

  await createActionItem(boschProjectId, boschPhases['Vehicle sensors & VHAL'], {
    description: 'Resolve CAN bus telemetry frame drop issues',
    assignedTo: 'Dieter Meyer', status: 'Pending', nextStep: 'Partner',
    linkUrl: 'https://buganizer.corp.google.com/issues/9987211',
    source: 'Buganizer', sourceUrl: 'https://buganizer.corp.google.com/issues/9987211',
  });

  // 4. Qualcomm Snapdragon Support (SA8295P cockpit)
  const qualcommProjectId = await createProject({
    name: 'Qualcomm Snapdragon Cockpit Support', partnerId: qualcommId, ownerName: me.email,
    sopDate: await sopForPlan(AAOS_T, QUALCOMM_THROUGH, 10), volumeFirstYear: 500000,
  });
  await postProjectState(qualcommProjectId, {
    theNeedle: 'Medium', hillChartProgress: 75,
    notes: 'Driver ports in progress, validation suite running.',
    source: 'Gerrit', sourceUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/99812',
    timestamp: '2026-06-01',
  });
  await postProjectState(qualcommProjectId, {
    theNeedle: 'Critical', hillChartProgress: 85,
    notes: 'Audio driver deadlock causes complete system freeze on cold boot.',
    source: 'Google Chat', sourceUrl: 'https://chat.google.com/room/qcom-audio-deadlocks',
    timestamp: '2026-06-27',
  });

  // ~38 weeks in: earlier than the OEM programs — BSP is done and the audio,
  // display and connectivity tracks are still running.
  const qualcommPhases = await seedPhasesFromBuiltin(qualcommProjectId, AAOS_T, QUALCOMM_THROUGH);

  await createActionItem(qualcommProjectId, qualcommPhases['Audio'], {
    description: 'Debug audio HAL cold boot freeze issue',
    assignedTo: 'Sarah Jenkins', status: 'Pending', nextStep: 'Partner',
    linkUrl: 'https://chat.google.com/room/qcom-audio-deadlocks',
    source: 'Google Chat', sourceUrl: 'https://chat.google.com/room/qcom-audio-deadlocks',
  });
  await createActionItem(qualcommProjectId, qualcommPhases['Audio'], {
    description: 'Review Snapdragon SA8295 firmware registry patches',
    assignedTo: me.email, status: 'Pending', nextStep: 'Googler',
    linkUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/99812',
    source: 'Gerrit', sourceUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/99812',
  });

  // Per-phase partner involvement: partners either OWN a program (Project.partnerId)
  // or are INVOLVED in specific phases of someone else's program via PhasePartner.
  console.log('Seeding phase-partner involvements...');
  // Ford Evos (owned by Ford): Qualcomm supplies silicon, Bosch supplies audio + VHAL
  await involvePartner(fordProjectId, fordPhases['BSP & power-on'], qualcommId, 'Silicon');
  await involvePartner(fordProjectId, fordPhases['Audio'], boschId, 'Supplier');
  await involvePartner(fordProjectId, fordPhases['Vehicle sensors & VHAL'], boschId, 'Supplier');
  // Toyota Digital Key (owned by Toyota): Qualcomm secure element
  await involvePartner(toyotaProjectId, toyotaPhases['Secure Element configuration'], qualcommId, 'Silicon');
  // Bosch VHAL program (owned by Bosch): Ford is the OEM whose vehicle it lands in
  await involvePartner(boschProjectId, boschPhases['Vehicle sensors & VHAL'], fordId, 'OEM');
  await involvePartner(boschProjectId, boschPhases['Compliance gates'], fordId, 'OEM');
  // Qualcomm cockpit program (owned by Qualcomm): Bosch integrates audio
  await involvePartner(qualcommProjectId, qualcommPhases['Audio'], boschId, 'Integrator');

  // Ingested context is seeded LAST (below, after the enrichment and showcase
  // programs exist), because corpus entries anchor to programs from all three blocks.

  // ---------------------------------------------------------------------------
  // Ecosystem enrichment: several ACTIVE programs of each type (AAOS / GAS /
  // Digital Key) with SOP targets spread across quarters, product flags, mixed
  // health, and a broader supplier + person graph — data for validating the
  // read-only surfaces (capacity chart, risk list, filters) and visual layouts.
  // ---------------------------------------------------------------------------
  console.log('Seeding ecosystem enrichment (partners, people, programs)...');

  const DAY = 86_400_000;
  const seedNow = Date.now();
  const ago = (days: number) => new Date(seedNow - days * DAY);
  const agoIso = (days: number) => ago(days).toISOString();

  const mkPartner = (name: string, type: string, region: string, summary: string) =>
    createPartner({ name, type, region, summary });

  const hondaId = await mkPartner('Honda', 'OEM', 'APAC', 'AAOS bring-up across the next Accord and CR-V cockpits.');
  const gmId = await mkPartner('GM', 'OEM', 'AMER', 'Ultifi platform migration onto AAOS with GAS.');
  const volvoCarsId = await mkPartner('Volvo Cars', 'OEM', 'EMEA', 'EX90 follow-on programs: AAOS refresh plus Digital Key.');
  const hyundaiId = await mkPartner('Hyundai', 'OEM', 'APAC', 'Ioniq line GAS integration wave.');
  const stellantisId = await mkPartner('Stellantis', 'OEM', 'EMEA', 'STLA SmartCockpit GAS rollout across brands.');
  const densoId = await mkPartner('Denso', 'Supplier', 'APAC', 'Tier-1 cockpit integrator on Honda and Toyota programs.');
  const continentalId = await mkPartner('Continental', 'Supplier', 'EMEA', 'Cluster + cockpit compute for European OEMs.');
  const lgeId = await mkPartner('LG Electronics', 'Supplier', 'APAC', 'IVI head units for GM and Hyundai lines.');
  const harmanId = await mkPartner('Harman', 'Supplier', 'AMER', 'Audio + telematics stacks on Stellantis programs.');
  const mediatekId = await mkPartner('MediaTek', 'Supplier', 'APAC', 'Dimensity Auto silicon on mid-range cockpits.');

  const mkPerson = (name: string, email: string, currentPartnerId: number, notes: string) =>
    createPerson({ name, email, currentPartnerId, notes });

  const priyaId = await mkPerson('Priya Sharma', 'priyash@google.com', googlePartnerId, 'Partner engineer across GAS integrations.');
  const marcusId = await mkPerson('Marcus Webb', 'marcusw@google.com', googlePartnerId, 'TPM for the AAOS bring-up portfolio.');
  const aikoId = await mkPerson('Aiko Tanaka', 'aiko@honda.example', hondaId, 'Honda cockpit software lead.');
  const lenaId = await mkPerson('Lena Fischer', 'lena@continental.example', continentalId, 'Continental integration architect.');
  const carlosId = await mkPerson('Carlos Ruiz', 'carlos@gm.example', gmId, 'GM Ultifi platform owner.');
  const minjiId = await mkPerson('Min-ji Park', 'minji@lge.example', lgeId, 'LGE head-unit delivery manager.');
  const svenId = await mkPerson('Sven Larsson', 'sven@volvocars.example', volvoCarsId, 'Volvo Digital Key security lead.');
  const deepakId = await mkPerson('Deepak Rao', 'deepak@mediatek.example', mediatekId, 'MediaTek automotive FAE.');

  // A little career history so people pages have texture.
  await addAffiliation(lenaId, { partnerId: boschId, role: 'Platform engineer', startDate: '2019-02-01', endDate: '2023-05-01' });
  await addAffiliation(deepakId, { partnerId: qualcommId, role: 'FAE', startDate: '2018-06-01', endDate: '2022-01-01' });
  await addAffiliation(minjiId, { partnerId: harmanId, role: 'Delivery lead', startDate: '2020-03-01', endDate: '2024-08-01' });

  // Program specs: name, OEM, owner, SOP (month-end), 12-month volume, products,
  // health, hill position, phases (name, days, progress) chained linearly, and the
  // suppliers/people involved in the currently active phase.
  interface MockPhase { n: string; d: number; p: number }
  interface MockProgram {
    name: string; partnerId: number; owner: string; sop: string; vol: number;
    gas: boolean; gbi: boolean; dk: boolean; aap?: boolean; needle: string; hill: number;
    phases: MockPhase[]; suppliers: number[]; people: number[];
  }
  const programs: MockProgram[] = [
    // --- AAOS bring-ups ---
    { name: 'Honda Accord AAOS Bring-up', partnerId: hondaId, owner: 'marcusw', sop: '2027-04-30', vol: 220000,
      gas: true, gbi: true, dk: false, needle: 'Some Risk', hill: 45,
      phases: [ { n: 'BSP & Power-on', d: 30, p: 100 }, { n: 'HAL Integration', d: 45, p: 55 }, { n: 'Cluster Bring-up', d: 30, p: 0 }, { n: 'Certification', d: 40, p: 0 } ],
      suppliers: [densoId, mediatekId], people: [aikoId, deepakId, marcusId] },
    { name: 'GM Ultifi AAOS Migration', partnerId: gmId, owner: 'marcusw', sop: '2027-09-30', vol: 340000,
      gas: true, gbi: true, dk: false, needle: 'On Track', hill: 30,
      phases: [ { n: 'Architecture Lock', d: 25, p: 100 }, { n: 'Compute Board Bring-up', d: 40, p: 40 }, { n: 'App Platform Port', d: 50, p: 0 }, { n: 'Fleet Validation', d: 45, p: 0 } ],
      suppliers: [lgeId], people: [carlosId, minjiId, marcusId] },
    { name: 'Volvo EX90 AAOS Refresh', partnerId: volvoCarsId, owner: me.email, sop: '2026-12-31', vol: 90000,
      gas: true, gbi: false, dk: false, needle: 'Concerned', hill: 70,
      phases: [ { n: 'Platform Rebase', d: 30, p: 100 }, { n: 'Driver Update Pass', d: 25, p: 80 }, { n: 'Regression & Cert', d: 35, p: 0 } ],
      suppliers: [continentalId], people: [lenaId, svenId] },
    // --- GAS integrations ---
    { name: 'Hyundai Ioniq GAS Integration', partnerId: hyundaiId, owner: 'priyash', sop: '2027-06-30', vol: 260000,
      gas: true, gbi: false, dk: false, needle: 'On Track', hill: 35,
      phases: [ { n: 'GMS Core Enablement', d: 30, p: 100 }, { n: 'Play Store Config', d: 20, p: 45 }, { n: 'Assistant Tuning', d: 25, p: 0 }, { n: 'GAS Certification', d: 30, p: 0 } ],
      suppliers: [lgeId], people: [minjiId, priyaId] },
    { name: 'Stellantis STLA GAS Rollout', partnerId: stellantisId, owner: 'priyash', sop: '2028-03-31', vol: 410000,
      gas: true, gbi: true, dk: false, needle: 'Some Risk', hill: 20,
      phases: [ { n: 'Brand Matrix Scoping', d: 20, p: 100 }, { n: 'Reference Head Unit', d: 45, p: 30 }, { n: 'Per-brand Skinning', d: 40, p: 0 }, { n: 'Rollout Wave 1', d: 50, p: 0 } ],
      suppliers: [harmanId], people: [priyaId] },
    // --- Digital Key programs ---
    { name: 'Honda Digital Key CCC', partnerId: hondaId, owner: me.email, sop: '2027-01-31', vol: 150000,
      gas: false, gbi: false, dk: true, needle: 'Some Risk', hill: 50,
      phases: [ { n: 'NFC Driver Bring-up', d: 20, p: 100 }, { n: 'Secure Element Config', d: 30, p: 60 }, { n: 'CCC Spec Compliance', d: 40, p: 0 } ],
      suppliers: [densoId], people: [aikoId] },
    { name: 'Volvo Digital Key', partnerId: volvoCarsId, owner: me.email, sop: '2027-08-31', vol: 70000,
      gas: false, gbi: false, dk: true, needle: 'On Track', hill: 25,
      phases: [ { n: 'Key Architecture', d: 25, p: 100 }, { n: 'UWB Ranging', d: 35, p: 25 }, { n: 'Companion App', d: 30, p: 0 }, { n: 'CCC Certification', d: 30, p: 0 } ],
      suppliers: [continentalId], people: [svenId, lenaId] },
  ];

  for (const spec of programs) {
    const projectId = await createProject({
      name: spec.name,
      partnerId: spec.partnerId,
      ownerName: spec.owner,
      sopDate: spec.sop,
      volumeFirstYear: spec.vol,
    });
    // Product flags have no mutation surface of their own (the metrics form action
    // would append a synthetic history row) — set the columns directly.
    await prisma.project.update({
      where: { id: projectId },
      data: {
        hasGas: spec.gas,
        hasGbi: spec.gbi,
        hasDigitalKey: spec.dk,
        hasAap: spec.aap ?? spec.gas, // projection typically rides along with GAS builds
      },
    });
    await postProjectState(projectId, {
      theNeedle: spec.needle,
      hillChartProgress: spec.hill,
      // Prose date, not ISO: a note is narrative the AI briefing reads and copies —
      // ISO is a table format that belongs in cells, not sentences (design.md §6, #20).
      notes: `Weekly update: tracking toward the ${localDate(spec.sop, 'en-US', { month: 'long', year: 'numeric' })} SOP.`,
      source: 'seed',
    });

    let prevPhaseId: number | null = null;
    let activePhaseId: number | null = null;
    for (const ph of spec.phases) {
      const phaseId = await createPhase(projectId, {
        name: ph.n,
        forecastedDuration: ph.d,
        // The initial state predates the progress state so newest-wins ordering holds.
        stateTimestamp: agoIso(60),
      });
      await postPhaseState(projectId, phaseId, {
        theNeedle: 'On Track',
        hillChartProgress: ph.p,
        notes: ph.p > 0 && ph.p < 100 ? `${ph.n} in flight.` : null,
        source: 'seed',
      });
      if (prevPhaseId != null) {
        await addDependency(projectId, phaseId, prevPhaseId);
      }
      if (activePhaseId == null && ph.p > 0 && ph.p < 100) activePhaseId = phaseId;
      prevPhaseId = phaseId;
    }

    // Involvement rides on the active phase — pills, contention, partner pages.
    if (activePhaseId != null) {
      for (const supplierId of spec.suppliers) {
        await involvePartner(projectId, activePhaseId, supplierId);
      }
      for (const personId of spec.people) {
        await involvePerson(projectId, activePhaseId, personId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Critical Chain ledger showcase (docs/CRITICAL_CHAIN_VIEW_PLAN.md): four
  // programs with DATED progress histories exercising every situation in the
  // taxonomy — sunk overrun (with a contended partner), idle handoff, forecast
  // overrun, upcoming handoff, oversubscription with movable slack, SOP
  // overshoot (the Concerned proposal), and all-clear — plus the portfolio
  // aggregation (Priya gates several falling SOPs; Harman gates exactly one).
  // "Gemini X Cockpit" alone carries FIVE overlapping situations — the blend
  // case a structured Gemini prompt would narrate across. Dates are relative to
  // seed time so the demo always reads as "today"; they ride the routes'
  // guarded `timestamp` override — the buffer-trend replay feeds on them.
  // ---------------------------------------------------------------------------
  console.log('Seeding chain-ledger showcase programs...');
  // SOP dates are month-end normalized by policy (lib/sop) — the seed models that.
  const aheadMonthEnd = (days: number) => {
    const d = new Date(seedNow + days * DAY);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  };
  /** First of the month `months` ahead of seed time. Sibling of `aheadMonthEnd`, and the
   *  only correct way to date a SCHEDULED event in a fixture: a literal would quietly
   *  become a past date and stop being scheduled at all
   *  (docs/knowledge/a-literal-future-date-in-a-fixture-expires.md). */
  const aheadMonthStart = (months: number) => {
    const d = new Date(seedNow);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  };

  interface ShowPhase {
    n: string;
    d: number; // forecastedDuration
    startedAgo: number | null; // explicit startedAt (the Active toggle), days ago
    states: { ago: number; p: number }[]; // dated hill history, oldest first
    partnerIds?: number[];
    personIds?: number[];
  }
  interface ShowProgram {
    name: string; partnerId: number; owner: string; sopInDays: number; vol: number;
    gas?: boolean; gbi?: boolean; dk?: boolean; needle: string; hill: number; note: string;
    phases: ShowPhase[];
  }
  const showcase: ShowProgram[] = [
    // Multi-situation program: Kickoff gave back 3d; HW bring-up sank 9d while
    // Bosch was multiplexed; 6 idle days before SW integration AND before Cert;
    // Cert (constraint, Priya + Marcus) trending ~5d over; Production readiness
    // (Bosch) is the upcoming handoff. Buffer 35 → 12 of a 45-day guideline.
    { name: 'Gemini X Cockpit', partnerId: gmId, owner: me.email, sopInDays: 101, vol: 120000,
      gas: true, gbi: true, needle: 'Some Risk', hill: 55,
      note: 'Cert is moving but slower than planned; watching the buffer weekly.',
      phases: [
        { n: 'Kickoff', d: 30, startedAgo: 200, states: [{ ago: 200, p: 5 }, { ago: 190, p: 40 }, { ago: 173, p: 100 }] },
        { n: 'HW bring-up', d: 60, startedAgo: 173, partnerIds: [boschId],
          states: [{ ago: 173, p: 10 }, { ago: 150, p: 30 }, { ago: 130, p: 60 }, { ago: 110, p: 85 }, { ago: 104, p: 100 }] },
        { n: 'SW integration', d: 70, startedAgo: 98,
          states: [{ ago: 98, p: 15 }, { ago: 70, p: 45 }, { ago: 45, p: 80 }, { ago: 28, p: 100 }] },
        { n: 'Cert', d: 56, startedAgo: 22, personIds: [priyaId, marcusId],
          states: [{ ago: 22, p: 10 }, { ago: 10, p: 20 }, { ago: 3, p: 30 }] },
        { n: 'Production readiness', d: 50, startedAgo: null, partnerIds: [boschId], states: [{ ago: 1, p: 0 }] },
      ] },
    // SOP overshoot: certification forecast lands ~13 days past the SOP — the
    // "declare Concerned, propose the SOP move" example, with delayed units.
    { name: 'Polaris EV Digital Key', partnerId: volvoCarsId, owner: me.email, sopInDays: 5, vol: 60000,
      dk: true, needle: 'Concerned', hill: 60,
      note: 'UWB ranging overran and certification is pacing behind plan.',
      phases: [
        { n: 'Key Architecture', d: 30, startedAgo: 120, states: [{ ago: 120, p: 20 }, { ago: 110, p: 70 }, { ago: 95, p: 100 }] },
        { n: 'UWB Ranging', d: 45, startedAgo: 95,
          states: [{ ago: 95, p: 15 }, { ago: 75, p: 50 }, { ago: 60, p: 80 }, { ago: 40, p: 100 }] },
        { n: 'CCC Certification', d: 50, startedAgo: 40, personIds: [priyaId],
          states: [{ ago: 40, p: 10 }, { ago: 20, p: 20 }, { ago: 7, p: 25 }] },
      ] },
    // Healthy buffer but a falling trend, with Bosch gating this one SOP.
    { name: 'Meridian Van GAS', partnerId: stellantisId, owner: 'priyash', sopInDays: 150, vol: 45000,
      gas: true, needle: 'On Track', hill: 45,
      note: 'Integration slower than the last four weeks suggested; still roomy.',
      phases: [
        { n: 'Board bring-up', d: 40, startedAgo: 100, states: [{ ago: 100, p: 25 }, { ago: 80, p: 70 }, { ago: 60, p: 100 }] },
        { n: 'Integration', d: 65, startedAgo: 58, partnerIds: [boschId],
          states: [{ ago: 58, p: 20 }, { ago: 40, p: 55 }, { ago: 20, p: 70 }, { ago: 6, p: 80 }] },
        { n: 'GAS Certification', d: 30, startedAgo: null, states: [{ ago: 1, p: 0 }] },
      ] },
    // All clear: every phase on plan, no gaps, buffer untouched — the
    // nothing-to-do example AND Priya's movable slack in the portfolio view.
    { name: 'Nova Compact AAOS', partnerId: hondaId, owner: 'marcusw', sopInDays: 110, vol: 80000,
      gas: true, needle: 'On Track', hill: 60,
      note: 'Running to plan.',
      phases: [
        { n: 'Bring-up', d: 40, startedAgo: 80, states: [{ ago: 80, p: 30 }, { ago: 60, p: 70 }, { ago: 40, p: 100 }] },
        { n: 'Integration', d: 50, startedAgo: 40,
          states: [{ ago: 40, p: 20 }, { ago: 25, p: 50 }, { ago: 10, p: 70 }, { ago: 2, p: 80 }] },
        { n: 'Certification', d: 35, startedAgo: null, personIds: [priyaId], states: [{ ago: 1, p: 0 }] },
      ] },
  ];

  for (const spec of showcase) {
    const projectId = await createProject({
      name: spec.name,
      partnerId: spec.partnerId,
      ownerName: spec.owner,
      sopDate: aheadMonthEnd(spec.sopInDays).toISOString(),
      volumeFirstYear: spec.vol,
    });
    await prisma.project.update({
      where: { id: projectId },
      data: {
        hasGas: spec.gas ?? false,
        hasGbi: spec.gbi ?? false,
        hasDigitalKey: spec.dk ?? false,
        hasAap: spec.gas ?? false,
      },
    });
    await postProjectState(projectId, {
      theNeedle: spec.needle, hillChartProgress: spec.hill,
      notes: spec.note, source: 'seed', timestamp: agoIso(2),
    });

    let prevPhaseId: number | null = null;
    for (const ph of spec.phases) {
      const oldestAgo = ph.states[0]?.ago ?? 1;
      const phaseId = await createPhase(projectId, {
        name: ph.n,
        forecastedDuration: ph.d,
        // The initial state predates the phase's whole dated history.
        stateTimestamp: agoIso(oldestAgo + 2),
      });
      if (ph.startedAgo != null) {
        await markStarted(projectId, phaseId, ago(ph.startedAgo));
      }
      for (const s of ph.states) {
        await postPhaseState(projectId, phaseId, {
          theNeedle: 'On Track',
          hillChartProgress: s.p,
          notes: s.p > 0 && s.p < 100 ? `${ph.n}: progress update.` : null,
          source: 'seed',
          timestamp: agoIso(s.ago),
        });
      }
      if (prevPhaseId != null) {
        await addDependency(projectId, phaseId, prevPhaseId);
      }
      for (const partnerId of ph.partnerIds ?? []) {
        await involvePartner(projectId, phaseId, partnerId);
      }
      for (const personId of ph.personIds ?? []) {
        await involvePerson(projectId, phaseId, personId);
      }
      prevPhaseId = phaseId;
    }
  }

  // ---------------------------------------------------------------------------
  // Alice Waters — the temporal-profile fixture (spec #124 §7).
  //
  // ONE human across FOUR employment periods, so the person and partner pages have
  // a real multi-company career to get right. Everything below rides the same
  // mutation boundaries as the rest of the seed (createPerson, the affiliations
  // route, createProject/createPhase, the involvement actions), INCLUDING the
  // scheduled Honda move, which goes through `movePersonCompany` itself rather than
  // hand-writing the rows that action would write. That is the point: the fixture
  // inherits whatever the action really does. It was authored while the action
  // advanced Person.currentPartnerId unconditionally, so it RENDERED #124 Class 1 —
  // the identity line read Honda months early while every affiliation row said Google.
  // Class 1 is fixed (the action now advances the cache only once the date has
  // arrived), and the same seed call produces the correct state with no edit here —
  // which is exactly the outcome routing the fixture through the action was for.
  //
  // DATES. The three past boundaries are literal: a career is a fact and stays true
  // whenever the seed runs. The Honda move is DERIVED — first of the month, four
  // months out — so a re-seed is always genuinely in the FUTURE; a literal would
  // quietly slip into the past and turn the fixture into a lie (it would then be
  // claiming a scheduled move that has already happened). On the day this landed
  // that derives to 2026-11-01, which is §7's "2026-11" — the value the DoD's
  // Class 1 bullet quotes. (#124's Class 1 repro shows 2026-09-01 instead; that is
  // a screenshot of the buggy live demo, not a spec, so §7's table wins.)
  // ---------------------------------------------------------------------------
  console.log('Seeding the Alice Waters temporal-profile fixture (four periods, one human)...');

  // Her address changes WITH the company (#124 §2) — but email is still a
  // person-level column, so only the current period's address is storable on the
  // row. The historical two are authored here because they are half the point of
  // the fixture, and they do reach the database: they are the free-text
  // `assignedTo` on the era action items below, which is exactly how a real
  // action item captured at the time would carry them.
  const ALICE = {
    bosch: { role: 'Platform Engineer', email: 'alice.waters@bosch.com', start: '2022-01-01', end: '2024-03-01' },
    qualcomm: { role: 'Staff Engineer', email: 'awaters@qualcomm.com', start: '2024-03-01', end: '2026-07-01' },
    // §7 says alice@google.com. That address already belongs to the 'Alice PM'
    // persona seeded above and Person.email is @unique, so the fixture takes the
    // dotted form — the same shape as her Bosch address. Its local part
    // ('alice.waters') is distinct from 'alice', so resolvePerson still sends the
    // bare handle 'alice' to Alice PM and nothing else moves.
    google: { role: 'Lead Program Manager', email: 'alice.waters@google.com', start: '2026-07-01' },
    honda: { role: 'Cockpit Platform Lead' },
  };

  const aliceWatersId = await createPerson({
    name: 'Alice Waters',
    email: ALICE.google.email,
    currentPartnerId: googlePartnerId,
    // Company and title live in the periods below, so the note does not repeat them.
    notes: 'Telematics platform engineer who moved to the Google side of the same programs.',
  });

  // Contiguous and half-open (`start <= t < end`): each period's end IS the next
  // one's start, so there is no gap and no overlap anywhere in the career.
  await addAffiliation(aliceWatersId, {
    partnerId: boschId, role: ALICE.bosch.role,
    startDate: ALICE.bosch.start, endDate: ALICE.bosch.end,
  });
  await addAffiliation(aliceWatersId, {
    partnerId: qualcommId, role: ALICE.qualcomm.role,
    startDate: ALICE.qualcomm.start, endDate: ALICE.qualcomm.end,
  });
  await addAffiliation(aliceWatersId, {
    partnerId: googlePartnerId, role: ALICE.google.role, startDate: ALICE.google.start,
  });

  /** A program whose phases are dated by LITERAL calendar dates rather than by
   *  offset from "now" — the two closed eras of Alice's career happened on real
   *  dates and must not drift when the seed is re-run. Linear chain, so a finished
   *  era stays DAG-coherent by construction. */
  /** `startedOn: null` = queued, never started — the live era needs that; the two closed
   *  eras never use it. Timestamps are ISO strings rather than day-offsets so ONE helper
   *  serves both: the closed eras pass literals, the live era passes `agoIso(...)`, and
   *  which is which reads off the call site. */
  interface EraPhase { n: string; d: number; startedOn: string | null; states: { at: string; p: number }[] }
  const seedEraPhases = async (projectId: number, phases: EraPhase[]): Promise<Record<string, number>> => {
    const ids: Record<string, number> = {};
    let prevPhaseId: number | null = null;
    for (const ph of phases) {
      const phaseId = await createPhase(projectId, {
        name: ph.n,
        forecastedDuration: ph.d,
        // The auto-created initial row sits behind the whole dated history, so
        // newest-wins ordering lands on the real progress (CRITICAL_CHAIN §6).
        stateTimestamp: new Date(new Date(ph.states[0].at).getTime() - 2 * DAY).toISOString(),
      });
      if (ph.startedOn != null) await markStarted(projectId, phaseId, new Date(ph.startedOn));
      for (const s of ph.states) {
        await postPhaseState(projectId, phaseId, {
          theNeedle: 'On Track',
          hillChartProgress: s.p,
          notes: s.p > 0 && s.p < 100 ? `${ph.n}: progress update.` : null,
          source: 'seed',
          timestamp: new Date(s.at).toISOString(),
        });
      }
      if (prevPhaseId != null) await addDependency(projectId, phaseId, prevPhaseId);
      ids[ph.n] = phaseId;
      prevPhaseId = phaseId;
    }
    return ids;
  };

  // (a) INSIDE THE BOSCH WINDOW (2022-01 → 2024-03): a finished 2022–23 program
  // with her in it, so that period owns real work and not just a date range.
  const aliceBoschProjectId = await createProject({
    name: 'Bosch TCU Gen-2 Platform', partnerId: boschId, ownerName: 'clara@google.com',
    sopDate: '2023-09-30', volumeFirstYear: 95000,
  });
  await postProjectState(aliceBoschProjectId, {
    theNeedle: 'On Track', hillChartProgress: 20,
    notes: 'Gen-2 telematics board kickoff with the Bosch platform team.',
    source: 'seed', timestamp: '2022-03-01',
  });
  await postProjectState(aliceBoschProjectId, {
    theNeedle: 'On Track', hillChartProgress: 100,
    notes: 'Gen-2 shipped; field validation closed out.',
    source: 'seed', timestamp: '2023-06-01',
  });
  const aliceBoschPhases = await seedEraPhases(aliceBoschProjectId, [
    { n: 'Telematics board bring-up', d: 60, startedOn: '2022-03-01',
      states: [{ at: '2022-03-01', p: 20 }, { at: '2022-06-01', p: 100 }] },
    { n: 'Modem integration', d: 70, startedOn: '2022-06-15',
      states: [{ at: '2022-06-15', p: 30 }, { at: '2022-11-01', p: 100 }] },
    { n: 'Field validation', d: 50, startedOn: '2022-11-15',
      states: [{ at: '2022-11-15', p: 40 }, { at: '2023-06-01', p: 100 }] },
  ]);
  await involvePerson(aliceBoschProjectId, aliceBoschPhases['Modem integration'], aliceWatersId, ALICE.bosch.role);
  // Addressed to the account she actually held in 2022. It links to her only
  // because resolvePerson falls back to the email LOCAL PART and hers happens to
  // have survived the moves — which is the accident #124 Class 4 is about, not a
  // guarantee. The Qualcomm-era item below shows what happens when it doesn't.
  await createActionItem(aliceBoschProjectId, aliceBoschPhases['Modem integration'], {
    description: 'Close out LTE modem thermal throttling on the Gen-2 board',
    assignedTo: ALICE.bosch.email, status: 'Completed', nextStep: 'Resolved',
    source: 'Buganizer', sourceUrl: 'https://buganizer.corp.google.com/issues/4410932',
  });

  // (b) INSIDE THE QUALCOMM WINDOW (2024-03 → 2026-07): a 2024–25 silicon program.
  const aliceQualcommProjectId = await createProject({
    name: 'Qualcomm SA8155P Cockpit Validation', partnerId: qualcommId, ownerName: 'marcusw@google.com',
    sopDate: '2025-12-31', volumeFirstYear: 140000,
  });
  await postProjectState(aliceQualcommProjectId, {
    theNeedle: 'On Track', hillChartProgress: 25,
    notes: 'Validation programme opened against the SA8155P cockpit reference.',
    source: 'seed', timestamp: '2024-09-02',
  });
  await postProjectState(aliceQualcommProjectId, {
    theNeedle: 'On Track', hillChartProgress: 100,
    notes: 'Reference cockpit signed off; validation suite handed to the OEM programs.',
    source: 'seed', timestamp: '2025-11-03',
  });
  const aliceQualcommPhases = await seedEraPhases(aliceQualcommProjectId, [
    { n: 'Reference board enablement', d: 45, startedOn: '2024-09-02',
      states: [{ at: '2024-09-02', p: 25 }, { at: '2025-01-15', p: 100 }] },
    { n: 'Cockpit validation suite', d: 60, startedOn: '2025-02-03',
      states: [{ at: '2025-02-03', p: 35 }, { at: '2025-07-01', p: 100 }] },
    { n: 'OEM handover', d: 30, startedOn: '2025-07-15',
      states: [{ at: '2025-07-15', p: 50 }, { at: '2025-11-03', p: 100 }] },
  ]);
  await involvePerson(aliceQualcommProjectId, aliceQualcommPhases['Cockpit validation suite'], aliceWatersId, ALICE.qualcomm.role);
  // The same artifact, addressed to the account she held in 2025 — and this one
  // strands: `awaters@qualcomm.com` matches no Person, because a Person holds ONE
  // address and hers has since changed (#124 Class 4). Seeded deliberately so the
  // defect is visible in data instead of only in prose; tests/seedMock pins it.
  await createActionItem(aliceQualcommProjectId, aliceQualcommPhases['Cockpit validation suite'], {
    description: 'Sign off cockpit validation suite for the SA8155P reference',
    assignedTo: ALICE.qualcomm.email, status: 'Completed', nextStep: 'Resolved',
    source: 'Gerrit', sourceUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/71204',
  });

  // Lifecycle is a FACT someone sets and has no mutation surface of its own (like
  // the product flags above) — set the column directly. Both era programs are done,
  // which keeps them out of the risk list and the chain ledger (lib/lifecycle)
  // while they stay on Alice's page as history.
  await prisma.project.update({ where: { id: aliceBoschProjectId }, data: { lifecycle: 'complete' } });
  await prisma.project.update({ where: { id: aliceQualcommProjectId }, data: { lifecycle: 'complete' } });

  // (c) INSIDE THE GOOGLE WINDOW (2026-07 → open): TEL ownership of a LIVE program.
  // Relative dates here, not literal — a current program must always read as "now",
  // and anything a few weeks old is inside the Google period whenever it is seeded.
  const aliceGoogleProjectId = await createProject({
    name: 'Honda CR-V Cockpit Bring-up', partnerId: hondaId, ownerName: ALICE.google.email,
    sopDate: aheadMonthEnd(300).toISOString(), volumeFirstYear: 130000,
  });
  await prisma.project.update({
    where: { id: aliceGoogleProjectId },
    data: { hasGas: true, hasGbi: true, hasAap: true },
  });
  await postProjectState(aliceGoogleProjectId, {
    theNeedle: 'On Track', hillChartProgress: 40,
    notes: 'Bring-up opened on the CR-V cockpit; rebase landed, integration under way.',
    source: 'seed', timestamp: agoIso(2),
  });
  // Same helper as the two closed eras — relative dates because this program is LIVE and
  // has to stay live on every re-seed. The involvement is attached off the returned id
  // map, not by matching a phase NAME inside the loop: a rename would silently drop
  // Alice's only Google-era involvement, and the guard below asserts the PROJECT name, so
  // nothing would have gone red.
  const aliceGooglePhases = await seedEraPhases(aliceGoogleProjectId, [
    { n: 'Platform rebase', d: 30, startedOn: agoIso(20), states: [{ at: agoIso(20), p: 25 }, { at: agoIso(12), p: 100 }] },
    { n: 'Cockpit integration', d: 45, startedOn: agoIso(12), states: [{ at: agoIso(12), p: 20 }, { at: agoIso(4), p: 45 }] },
    { n: 'CCC + GAS certification', d: 35, startedOn: null, states: [{ at: agoIso(2), p: 0 }] },
  ]);
  await involvePerson(
    aliceGoogleProjectId, aliceGooglePhases['Cockpit integration'], aliceWatersId, ALICE.google.role,
  );

  // (d) THE SCHEDULED MOVE. Four months out, through the real action — which records
  // the Honda affiliation but leaves currentPartnerId on Google until the date
  // arrives, so the identity line on /people/<alice> correctly reads Google LLC · Lead
  // Program Manager. The Honda row lists under History, which is right — it is not the
  // job held today — but its open end still renders "Present", which is not. That last
  // residue is #127 E14's scheduled-move affordance, and this fixture is what keeps it
  // visible until then. Deriving the date (never a
  // literal) is what keeps it a FUTURE move on every re-seed, and therefore a live
  // guard against Class 1 coming back.
  const hondaMoveDate = aheadMonthStart(4);
  const moved = await movePersonCompany(fd({
    personId: aliceWatersId,
    newPartnerId: hondaId,
    newRole: ALICE.honda.role,
    startDate: hondaMoveDate.toISOString(),
  }));
  if (moved.error) throw new Error(`Seed scheduled move to Honda failed: ${moved.error}`);
  console.log(
    `Alice Waters: Bosch → Qualcomm → Google, with Honda SCHEDULED for ${hondaMoveDate.toISOString().slice(0, 10)}.`,
  );

  // Relationship health (1..5 scale) spread across the partner set so the
  // /partners Relationship column shows real relative variation. Two entries for
  // some partners so the "previous" ghost ring renders.
  // Every relationship update carries a WRITTEN note — the product requires one, so
  // the seed must model that (the feed is a relationship journal, not a scoreboard).
  // These are BACKDATED journal entries and PartnerState has no API route, so they
  // are the documented direct-write residue (see recordRelationship above).
  await recordRelationship(fordId, {
    score: 4, hillChartProgress: 25,
    notes: 'Executive alignment calls are positive.',
    timestamp: new Date('2026-05-10'),
  });
  await recordRelationship(fordId, {
    score: 3, hillChartProgress: 35,
    notes: 'Medium risk due to supplier delivery timelines.',
    timestamp: new Date('2026-06-20'),
  });

  const relStates: Array<{ partnerId: number; score: number; prev?: number; prevNote?: string; note: string }> = [
    { partnerId: hondaId, score: 4, prev: 3, prevNote: 'Codec sourcing worries surfaced in the quarterly review; watching weekly.', note: 'Cadence is healthy; codec supply worry contained for now.' },
    { partnerId: gmId, score: 4, prev: 4, prevNote: 'Joint roadmap review landed well; Ultifi leads engaged and responsive.', note: 'Ultifi leadership fully bought in; joint roadmap review done.' },
    { partnerId: volvoCarsId, score: 2, prev: 3, prevNote: 'Cert timeline tightening; flagged to their PMO, watching closely.', note: 'Cert slip triggered exec escalation; trust needs rebuilding.' },
    { partnerId: hyundaiId, score: 5, note: 'Model partnership — co-marketing GAS launch.' },
    { partnerId: stellantisId, score: 2, prev: 2, prevNote: 'Sponsor missed two syncs running; escalation drafted but not sent.', note: 'Brand-matrix decisions keep stalling; sponsor is disengaged.' },
    { partnerId: densoId, score: 4, note: 'Reliable execution; limited strategic alignment discussions.' },
    { partnerId: continentalId, score: 3, note: 'Delivery fine, but Volvo slip strained the three-way relationship.' },
    { partnerId: lgeId, score: 4, note: 'Strong delivery track record across GM and Hyundai lines.' },
  ];
  for (const r of relStates) {
    if (r.prev != null) {
      await recordRelationship(r.partnerId, {
        score: r.prev,
        notes: r.prevNote ?? 'Quarterly relationship review.',
        timestamp: new Date('2026-04-15'),
      });
    }
    await recordRelationship(r.partnerId, {
      score: r.score,
      notes: r.note,
      timestamp: new Date('2026-07-01'),
    });
  }

  // The ingested corpus goes in last: its entries anchor to programs created in all
  // three blocks above, and to their phases by name.
  console.log('Ingesting the mock source corpus through the ingest boundary...');
  const ingested = await seedMockCorpus();
  console.log(`Ingested ${ingested} sources.`);

  // Seeded records must be searchable immediately — build the vector index now
  // rather than waiting for a manual /api/admin/reindex.
  const indexed = await reindexAll();
  console.log('Search index built:', indexed);

  console.log('Seeding completed successfully!');
}
