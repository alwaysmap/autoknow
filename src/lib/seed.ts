import { prisma } from './db';
import { TEMPLATES } from './templates';
import { ingestRecord } from './vector';
import { reindexAll } from './search';
import { scoreToHealth } from './relationship';
import { assertDestructiveDbAllowed } from './dbSafety';

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
// tables, Partner.phone/googleTeam, backdated relationship history, vector ingest.
import { POST as postPartnerRoute } from '../app/api/partners/route';
import { POST as postPersonRoute } from '../app/api/people/route';
import { POST as postAffiliationRoute } from '../app/api/people/[id]/affiliations/route';
import { POST as postProjectRoute } from '../app/api/projects/route';
import { POST as postNeedleRoute } from '../app/api/projects/[id]/needle/route';
import { POST as postPhaseRoute } from '../app/api/projects/[id]/phases/route';
import { POST as postPhaseStateRoute } from '../app/api/projects/[id]/phases/[phaseId]/state/route';
import { POST as postActionItemRoute } from '../app/api/projects/[id]/phases/[phaseId]/action-items/route';
import { addPhaseDependency } from '../app/actions/dependencies';
import { addPhasePartner } from '../app/actions/phasePartners';
import { addPhasePerson } from '../app/actions/phasePeople';
import { setPhaseStarted } from '../app/actions/hill';

// Per-program phase progress (0..100), spread across the hill so each program's summary
// chart shows a distinguishable dot per phase. Status is derived from progress.
const FORD_PROGRESS: Record<string, number> = {
  'BSP & power-on': 100,
  'VHAL Integration': 65,
  'Audio HAL': 45,
  'Car Service Integration': 20,
  'Compliance Testing': 0,
};
const TOYOTA_PROGRESS: Record<string, number> = {
  'NFC Driver bring-up': 100,
  'Secure Element configuration': 50,
  'CCC Spec Compliance': 15,
};
const BOSCH_PROGRESS: Record<string, number> = {
  'BSP & power-on': 100,
  'VHAL Integration': 60,
  'Audio HAL': 35,
  'Car Service Integration': 15,
  'Compliance Testing': 0,
};
const QUALCOMM_PROGRESS: Record<string, number> = {
  'BSP & power-on': 100,
  'VHAL Integration': 100,
  'Audio HAL': 85,
  'Car Service Integration': 55,
  'Compliance Testing': 30,
};

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

interface TemplatePhaseSeed {
  /** Extra earlier state (mid-flight snapshot) for cycle-time texture. */
  earlier?: { progress: number; timestamp: string };
  progress: number;
  timestamp: string;
  notes?: string;
  source?: string;
  sourceUrl?: string;
}

/** Create one program's phases from a template: phase + dated states via the API,
 *  dependency edges via the action. Returns name → phaseId. */
async function seedTemplatePhases(
  projectId: number,
  template: { phases: { name: string; forecastedDuration: number; dependsOn: string[] }[] },
  perPhase: (name: string) => TemplatePhaseSeed,
  initialStateTimestamp: string,
): Promise<Record<string, number>> {
  const idsByName: Record<string, number> = {};
  const seeds = template.phases.map((p) => ({ p, s: perPhase(p.name) }));

  // DAG gate: seed a phase as started (progress > 0) ONLY once EVERY dependency is
  // complete. A real program can fast-track a downstream phase before its predecessor
  // finishes — but sample data must not depict it, or the schedule chart reads as if
  // Car Service Integration began the day VHAL did, which the dependency forbids.
  // Template phases are listed in dependency order, so one forward pass gates them.
  const gated: Record<string, number> = {};
  for (const { p, s } of seeds) {
    gated[p.name] = p.dependsOn.every((d) => (gated[d] ?? 0) >= 100) ? s.progress : 0;
  }

  for (const { p, s } of seeds) {
    const phaseId = await createPhase(projectId, {
      name: p.name,
      forecastedDuration: p.forecastedDuration,
      stateTimestamp: initialStateTimestamp,
    });
    idsByName[p.name] = phaseId;

    // Gated-to-zero phases keep only the initial 0 state createPhase wrote — no
    // started/progress rows — so the ledger schedules them ASAP after their deps.
    if (gated[p.name] <= 0) continue;

    if (s.earlier) {
      await postPhaseState(projectId, phaseId, {
        theNeedle: 'On Track',
        hillChartProgress: s.earlier.progress,
        timestamp: s.earlier.timestamp,
      });
    }
    await postPhaseState(projectId, phaseId, {
      theNeedle: 'On Track',
      hillChartProgress: gated[p.name],
      notes: s.notes ?? null,
      source: s.source ?? null,
      sourceUrl: s.sourceUrl ?? null,
      timestamp: s.timestamp,
    });
  }
  for (const p of template.phases) {
    for (const depName of p.dependsOn) {
      await addDependency(projectId, idsByName[p.name], idsByName[depName]);
    }
  }
  return idsByName;
}

export async function seedMockData() {
  console.log('Seeding full mock data...');
  await wipeAllData();

  // Reference lookup tables are seed/migration-owned — there is deliberately no API
  // that creates partner types or regions, so these two stay direct writes.
  console.log('Seeding lookup tables (Regions, Partner Types)...');
  for (const name of ['OEM', 'Supplier']) {
    await prisma.partnerType.create({ data: { name } });
  }
  for (const name of ['AMER', 'APAC', 'EMEA', 'Other']) {
    await prisma.region.create({ data: { name } });
  }

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
      { email: 'dylan@google.com', role: 'Relationship Lead' },
      { email: 'bob@google.com', role: 'Cloud Account Manager' },
    ] },
    { id: toyotaId, phone: '+81-565-28-2121', googleTeam: [
      { email: 'alice@google.com', role: 'Partner Engineering Manager' },
    ] },
    { id: boschId, phone: '+49-711-400-40290', googleTeam: [
      { email: 'clara@google.com', role: 'Supplier Operations Lead' },
    ] },
    { id: qualcommId, phone: '+1-858-587-1121', googleTeam: [
      { email: 'dylan@google.com', role: 'Silicon Alignment Engineer' },
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
  const dylanId = await createPerson({
    name: 'Dylan PM', email: 'dylan@google.com', currentPartnerId: googlePartnerId,
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
  await addAffiliation(dylanId, { partnerId: googlePartnerId, role: 'Lead Program Manager', startDate: '2024-01-01' });
  await addAffiliation(bobId, { partnerId: googlePartnerId, role: 'Cloud Account Manager', startDate: '2024-03-15' });
  await addAffiliation(aliceId, { partnerId: googlePartnerId, role: 'Partner Engineering Manager', startDate: '2023-02-01' });
  await addAffiliation(claraId, { partnerId: googlePartnerId, role: 'Supplier Operations Lead', startDate: '2023-07-01' });
  await addAffiliation(kenjiId, { partnerId: toyotaId, role: 'VP of Software Engineering', startDate: '2022-06-01' });
  await addAffiliation(dieterId, { partnerId: boschId, role: 'Senior ADAS Systems Lead', startDate: '2023-01-10' });
  await addAffiliation(sarahId, { partnerId: qualcommId, role: 'Snapdragon Automotive PM', startDate: '2023-09-01' });

  console.log('Seeding projects...');

  // 1. Ford Evos AAOS Bring-up
  const fordProjectId = await createProject({
    name: 'Ford Evos AAOS Bring-up', partnerId: fordId, ownerName: 'Dylan PM',
    sopDate: '2026-10-01', volumeFirstYear: 180000,
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

  const fordPhases = await seedTemplatePhases(
    fordProjectId,
    TEMPLATES.AAOS,
    (name) => {
      const isBsp = name === 'BSP & power-on';
      return {
        progress: FORD_PROGRESS[name] ?? 0,
        timestamp: '2026-06-10', // to give it some cycle time
        notes: isBsp ? 'VHAL wait times are elevated.' : undefined,
        source: isBsp ? 'Buganizer' : undefined,
        sourceUrl: isBsp ? 'https://buganizer.corp.google.com/issues/889218' : undefined,
      };
    },
    '2026-02-01',
  );

  await createActionItem(fordProjectId, fordPhases['BSP & power-on'], {
    description: 'Determine cause for VHAL wait time delay',
    assignedTo: '@dylan', status: 'Pending', nextStep: 'Googler',
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
    sopDate: '2027-02-15', volumeFirstYear: 250000,
  });
  await postProjectState(toyotaProjectId, {
    theNeedle: 'Low', hillChartProgress: 15,
    notes: 'Kickoff and initial threat modeling drafted.',
    source: 'Google Doc', sourceUrl: 'https://docs.google.com/document/d/toyota-digital-key-threat-model',
    timestamp: '2026-06-01',
  });

  const toyotaPhases = await seedTemplatePhases(
    toyotaProjectId,
    TEMPLATES['Digital Key'],
    (name) => {
      const isSecure = name === 'Secure Element configuration';
      return {
        progress: TOYOTA_PROGRESS[name] ?? 0,
        timestamp: '2026-06-01',
        notes: isSecure ? 'Threat modeling in review by partner teams.' : undefined,
        source: isSecure ? 'Google Doc' : undefined,
        sourceUrl: isSecure ? 'https://docs.google.com/document/d/toyota-digital-key-threat-model' : undefined,
      };
    },
    '2026-02-01',
  );

  await createActionItem(toyotaProjectId, toyotaPhases['Secure Element configuration'], {
    description: 'Review security key exchange protocols for Highlander',
    assignedTo: 'Kenji Sato', status: 'Pending', nextStep: 'Partner',
    linkUrl: 'https://docs.google.com/document/d/security-key-toyota',
    source: 'Google Doc', sourceUrl: 'https://docs.google.com/document/d/security-key-toyota',
  });

  // 3. Ford Explorer VHAL Integration (Bosch)
  const boschProjectId = await createProject({
    name: 'Ford Explorer VHAL Integration (Bosch)', partnerId: boschId, ownerName: 'Clara Operations',
    sopDate: '2026-11-20', volumeFirstYear: 120000,
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

  const boschPhases = await seedTemplatePhases(
    boschProjectId,
    TEMPLATES.AAOS,
    (name) => {
      const isBsp = name === 'BSP & power-on';
      const isVhal = name === 'VHAL Integration';
      return {
        earlier: isBsp ? { progress: 50, timestamp: '2026-04-01' } : undefined,
        progress: BOSCH_PROGRESS[name] ?? 0,
        timestamp: isBsp ? '2026-05-01' : '2026-05-05',
        notes: isVhal ? 'Telemetry calibration failures reported.' : undefined,
        source: isVhal ? 'Buganizer' : undefined,
        sourceUrl: isVhal ? 'https://buganizer.corp.google.com/issues/9987211' : undefined,
      };
    },
    '2026-02-01',
  );

  await createActionItem(boschProjectId, boschPhases['VHAL Integration'], {
    description: 'Resolve CAN bus telemetry frame drop issues',
    assignedTo: 'Dieter Meyer', status: 'Pending', nextStep: 'Partner',
    linkUrl: 'https://buganizer.corp.google.com/issues/9987211',
    source: 'Buganizer', sourceUrl: 'https://buganizer.corp.google.com/issues/9987211',
  });

  // 4. Qualcomm Snapdragon Support (SA8295P cockpit)
  const qualcommProjectId = await createProject({
    name: 'Qualcomm Snapdragon Cockpit Support', partnerId: qualcommId, ownerName: 'Dylan PM',
    sopDate: '2026-08-30', volumeFirstYear: 500000,
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

  const qualcommPhases = await seedTemplatePhases(
    qualcommProjectId,
    TEMPLATES.AAOS,
    (name) => {
      const isAudio = name === 'Audio HAL';
      return {
        earlier: isAudio ? { progress: 50, timestamp: '2026-04-15' } : undefined,
        progress: QUALCOMM_PROGRESS[name] ?? 0,
        timestamp: isAudio ? '2026-06-27' : '2026-03-01',
        notes: isAudio ? 'Audio driver cold boot freeze deadlock.' : undefined,
        source: isAudio ? 'Google Chat' : undefined,
        sourceUrl: isAudio ? 'https://chat.google.com/room/qcom-audio-deadlocks' : undefined,
      };
    },
    '2026-02-01',
  );

  await createActionItem(qualcommProjectId, qualcommPhases['Audio HAL'], {
    description: 'Debug audio HAL cold boot freeze issue',
    assignedTo: 'Sarah Jenkins', status: 'Pending', nextStep: 'Partner',
    linkUrl: 'https://chat.google.com/room/qcom-audio-deadlocks',
    source: 'Google Chat', sourceUrl: 'https://chat.google.com/room/qcom-audio-deadlocks',
  });
  await createActionItem(qualcommProjectId, qualcommPhases['Audio HAL'], {
    description: 'Review Snapdragon SA8295 firmware registry patches',
    assignedTo: '@dylan', status: 'Pending', nextStep: 'Googler',
    linkUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/99812',
    source: 'Gerrit', sourceUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/99812',
  });

  // Per-phase partner involvement: partners either OWN a program (Project.partnerId)
  // or are INVOLVED in specific phases of someone else's program via PhasePartner.
  console.log('Seeding phase-partner involvements...');
  // Ford Evos (owned by Ford): Qualcomm supplies silicon, Bosch supplies audio + VHAL
  await involvePartner(fordProjectId, fordPhases['BSP & power-on'], qualcommId, 'Silicon');
  await involvePartner(fordProjectId, fordPhases['Audio HAL'], boschId, 'Supplier');
  await involvePartner(fordProjectId, fordPhases['VHAL Integration'], boschId, 'Supplier');
  // Toyota Digital Key (owned by Toyota): Qualcomm secure element
  await involvePartner(toyotaProjectId, toyotaPhases['Secure Element configuration'], qualcommId, 'Silicon');
  // Bosch VHAL program (owned by Bosch): Ford is the OEM whose vehicle it lands in
  await involvePartner(boschProjectId, boschPhases['VHAL Integration'], fordId, 'OEM');
  await involvePartner(boschProjectId, boschPhases['Compliance Testing'], fordId, 'OEM');
  // Qualcomm cockpit program (owned by Qualcomm): Bosch integrates audio
  await involvePartner(qualcommProjectId, qualcommPhases['Audio HAL'], boschId, 'Integrator');

  console.log('Seeding Context URLs for vector search mapping...');
  // Vector ingest is a lib boundary of its own (embedding + raw SQL insert); there is
  // no HTTP surface for it, and ingestRecord IS what the app's ingestion paths call.
  await ingestRecord(
    fordProjectId,
    'https://chat.google.com/room/ford-evos-dev-talk',
    'Chat',
    'Ford Evos AAOS Development Chat',
    'Ford Evos AAOS Bring-up project updates on VHAL sensor inputs and cluster panel configurations. We are diagnosing BSP power-on latencies and telemetry drops on cold boot.'
  );
  await ingestRecord(
    toyotaProjectId,
    'https://docs.google.com/document/d/toyota-digital-key-threat-model',
    'Doc',
    'Toyota Highlander Digital Key Threat Model',
    'Toyota Highlander Digital Key threat modeling document. Details cryptographic key exchanges, NFC antenna protocols on the e-TNGA chassis, and companion app verification procedures.'
  );
  await ingestRecord(
    boschProjectId,
    'https://buganizer.corp.google.com/issues/9987211',
    'Chat', // mock category
    'Bosch Explorer VHAL Telemetry Bug',
    'Bosch Explorer VHAL frame drops on telemetry unit. Dieter Meyer noted that telemetry drops occur when ADAS sensor calibrations start during active ignition sequences.'
  );
  await ingestRecord(
    qualcommProjectId,
    'https://chat.google.com/room/qcom-audio-deadlocks',
    'Chat',
    'Qualcomm Snapdragon Audio Drivers chat',
    'Snapdragon audio HAL driver deadlocks during system start. Cold boot freezes are caused by priority inversion in thread scheduling for hardware outputs.'
  );

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
    { name: 'Volvo EX90 AAOS Refresh', partnerId: volvoCarsId, owner: 'dylan', sop: '2026-12-31', vol: 90000,
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
    { name: 'Honda Digital Key CCC', partnerId: hondaId, owner: 'dylan', sop: '2027-01-31', vol: 150000,
      gas: false, gbi: false, dk: true, needle: 'Some Risk', hill: 50,
      phases: [ { n: 'NFC Driver Bring-up', d: 20, p: 100 }, { n: 'Secure Element Config', d: 30, p: 60 }, { n: 'CCC Spec Compliance', d: 40, p: 0 } ],
      suppliers: [densoId], people: [aikoId] },
    { name: 'Volvo Digital Key', partnerId: volvoCarsId, owner: 'dylan', sop: '2027-08-31', vol: 70000,
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
      notes: `Weekly update: tracking toward SOP ${spec.sop.slice(0, 7)}.`,
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
    { name: 'Gemini X Cockpit', partnerId: gmId, owner: 'dylan', sopInDays: 101, vol: 120000,
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
    { name: 'Polaris EV Digital Key', partnerId: volvoCarsId, owner: 'dylan', sopInDays: 5, vol: 60000,
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

  // Seeded records must be searchable immediately — build the vector index now
  // rather than waiting for a manual /api/admin/reindex.
  const indexed = await reindexAll();
  console.log('Search index built:', indexed);

  console.log('Seeding completed successfully!');
}
