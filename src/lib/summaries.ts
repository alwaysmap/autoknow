import 'server-only';
import { prisma } from './db';
import { generateStructuredSummary, geminiConfigured, SUMMARY_MODEL, type SummaryEvidence } from './gemini';
import { DEFAULT_SUMMARY_PROMPTS, type SummaryScope } from './summaryPrompts';
import { computeCriticalChain } from './criticalChain';
import { parseHealth } from './health';
import { deriveScore } from './relationship';
import { hillStatus } from './phase';
import { sopOutlook } from './sop';

// The leadership-summary engine, one machine for three scopes (ecosystem / partner /
// program): gather what AutoKnow already stores — needle updates, hill updates,
// relationship states, ingested digests, SOP outlooks — hand it to Gemini as numbered
// evidence under a DB-tunable prompt (defaults in lib/summaryPrompts.ts), and persist
// the structured result (risks / progress / themes / actions) append-only. Citations
// map evidence ids back to exact in-app/source links, so every bullet is verifiable.
// A summary is STALE when scope-relevant content is newer than it; readers see the
// cached copy immediately and the panel refreshes it in the background.

const WINDOW_DAYS = 30; // fallback window when a scope has no prior summary
const MAX_EVIDENCE = 60; // hard cap so the prompt stays inside the model context

export const SECTION_KEYS = ['progress', 'risks', 'themes', 'actions'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface SummaryCitation {
  label: string;
  href: string;
  external: boolean;
}

export interface SummaryBullet {
  text: string;
  citations: SummaryCitation[];
}

export interface SummarySection {
  key: SectionKey;
  bullets: SummaryBullet[];
}

export interface SummaryBody {
  sections: SummarySection[];
}

export interface SummaryView {
  id: number;
  scope: SummaryScope;
  targetId: number;
  generatedAt: string;
  trigger: string;
  model: string;
  tldr: string;
  body: SummaryBody;
  sourceCount: number;
  stale: boolean; // scope-relevant data is newer than the summary
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

interface EvidenceRecord extends SummaryEvidence {
  citation: SummaryCitation;
}

class EvidenceList {
  records: EvidenceRecord[] = [];
  counts: Record<string, number> = {};
  push(kind: SummaryEvidence['kind'], text: string, citation: SummaryCitation) {
    if (this.records.length >= MAX_EVIDENCE) return;
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    this.records.push({ id: this.records.length, kind, text, citation });
  }
}

/** One program's evidence (chain, needle, hill, actions, ingested digests). */
async function gatherProgramEvidence(projectId: number, windowStart: Date, ev: EvidenceList) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      partner: { select: { name: true } },
      states: { orderBy: { timestamp: 'desc' }, take: 6 },
      phases: {
        orderBy: { id: 'asc' },
        include: {
          states: { orderBy: { timestamp: 'desc' }, take: 3 },
          partners: { include: { partner: { select: { name: true } } } },
          actionItems: { where: { status: 'Pending' } },
          dependencies: true,
        },
      },
      contextUrls: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!project) return null;

  // Critical chain + SOP outlook — the on-track story in one record.
  const chain = computeCriticalChain(
    project.phases.map((ph) => ({
      id: ph.id,
      name: ph.name,
      forecastedDuration: ph.forecastedDuration,
      progress: ph.states[0]?.hillChartProgress ?? 0,
      parentIds: ph.dependencies.map((d) => d.dependsOnPhaseId),
    })),
  );
  if (chain.path.length > 0) {
    const nameOf = (id: number) => project.phases.find((ph) => ph.id === id)?.name ?? `phase ${id}`;
    const constraint = chain.constraintId != null ? nameOf(chain.constraintId) : null;
    let sopClause = '';
    if (project.sopDate) {
      const o = sopOutlook(chain.remainingDays, project.sopDate, Date.now());
      sopClause = o.onTrack
        ? `; SOP target ${fmtDate(project.sopDate)} looks reachable (≈${o.slackDays} days of slack)`
        : `; SOP target ${fmtDate(project.sopDate)} is at risk — remaining chain work overshoots it by ≈${-o.slackDays} days`;
    } else {
      sopClause = '; NO SOP target set (it is required)';
    }
    ev.push(
      'chain',
      `critical chain of "${project.name}": ${chain.path.map(nameOf).join(' → ')}; about ${chain.remainingDays} forecast days remain${constraint ? `; current constraint: "${constraint}"` : ''}${sopClause}`,
      { label: `Critical chain · ${project.name}`, href: `/programs/${projectId}`, external: false },
    );
  }

  project.states
    .filter((s, i) => i < 2 || s.timestamp >= windowStart)
    .forEach((s, i) => {
      ev.push(
        'needle',
        `${i === 0 ? 'CURRENT ' : ''}"${project.name}" program update ${fmtDate(s.timestamp)}: health ${parseHealth(s.theNeedle)}${s.notes ? ` — ${s.notes}` : ''}${s.source ? ` (by ${s.source})` : ''}`,
        { label: `Weekly update · ${fmtDate(s.timestamp)}`, href: `/history/project/${projectId}`, external: false },
      );
    });

  for (const phase of project.phases) {
    const partners = phase.partners.map((pp) => `${pp.partner.name}${pp.role ? ` (${pp.role})` : ''}`).join(', ');
    phase.states
      .filter((s, i) => i === 0 || s.timestamp >= windowStart)
      .forEach((s, i) => {
        ev.push(
          'hill',
          `${i === 0 ? 'CURRENT ' : ''}phase "${phase.name}" (${project.name}) ${fmtDate(s.timestamp)}: ${hillStatus(s.hillChartProgress ?? 0)}${s.notes ? ` — ${s.notes}` : ''}${partners && i === 0 ? ` [partners involved: ${partners}]` : ''}`,
          { label: `${phase.name} · ${fmtDate(s.timestamp)}`, href: `/history/phase/${phase.id}`, external: false },
        );
      });

    for (const item of phase.actionItems) {
      ev.push(
        'action',
        `open action on "${phase.name}" (${project.name}): ${item.description}${item.assignedTo ? ` (owner ${item.assignedTo})` : ''}, next step ${item.nextStep}`,
        { label: `Action · ${phase.name}`, href: item.linkUrl || `/programs/${projectId}`, external: !!item.linkUrl },
      );
    }
  }

  project.contextUrls
    .filter((c) => c.ingestedText)
    .forEach((c) => {
      ev.push(
        'context',
        `ingested ${c.type} ${fmtDate(c.createdAt)}${c.title ? ` "${c.title}"` : ''} (${project.name}): ${c.ingestedText!.slice(0, 600)}`,
        { label: c.title || `${c.type} source`, href: c.url, external: true },
      );
    });

  return project;
}

/** Partner-scope evidence: the relationship states + a portfolio pass over its programs. */
async function gatherPartnerEvidence(partnerId: number, windowStart: Date, ev: EvidenceList) {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    include: {
      states: { orderBy: { timestamp: 'desc' }, take: 6 },
      contextUrls: { orderBy: { createdAt: 'desc' }, take: 8 },
      projects: { where: { isArchived: false }, select: { id: true } },
    },
  });
  if (!partner) return null;

  partner.states
    .filter((s, i) => i < 2 || s.timestamp >= windowStart)
    .forEach((s, i) => {
      ev.push(
        'relationship',
        `${i === 0 ? 'CURRENT ' : ''}relationship update ${fmtDate(s.timestamp)}: score ${deriveScore(s)}/7 (1=critical, 7=exemplary)${s.notes ? ` — ${s.notes}` : ''}${s.source ? ` (by ${s.source})` : ''}`,
        { label: `Relationship · ${fmtDate(s.timestamp)}`, href: `/history/partner/${partnerId}`, external: false },
      );
    });

  partner.contextUrls
    .filter((c) => c.ingestedText)
    .forEach((c) => {
      ev.push(
        'context',
        `ingested ${c.type} ${fmtDate(c.createdAt)}${c.title ? ` "${c.title}"` : ''}: ${c.ingestedText!.slice(0, 600)}`,
        { label: c.title || `${c.type} source`, href: c.url, external: true },
      );
    });

  // Their program portfolio, each with full program evidence (capped by MAX_EVIDENCE).
  for (const proj of partner.projects) {
    await gatherProgramEvidence(proj.id, windowStart, ev);
  }

  return partner;
}

/** Ecosystem-scope evidence: every active program's chain/current state + recent
 *  cross-program updates and digests, newest first, capped. */
async function gatherEcosystemEvidence(windowStart: Date, ev: EvidenceList) {
  const projects = await prisma.project.findMany({
    where: { isArchived: false },
    orderBy: { id: 'asc' },
    include: {
      partner: { select: { name: true } },
      states: { orderBy: { timestamp: 'desc' }, take: 1 },
      phases: {
        include: {
          states: { orderBy: { timestamp: 'desc' }, take: 1 },
          dependencies: true,
        },
      },
    },
  });

  // One portfolio record per program: partner, health, SOP outlook, volume, products.
  for (const proj of projects) {
    const chain = computeCriticalChain(
      proj.phases.map((ph) => ({
        id: ph.id,
        name: ph.name,
        forecastedDuration: ph.forecastedDuration,
        progress: ph.states[0]?.hillChartProgress ?? 0,
        parentIds: ph.dependencies.map((d) => d.dependsOnPhaseId),
      })),
    );
    let sopClause = 'no SOP target set (required)';
    if (proj.sopDate) {
      const o = sopOutlook(chain.remainingDays, proj.sopDate, Date.now());
      sopClause = o.onTrack
        ? `SOP ${fmtDate(proj.sopDate)} reachable (≈${o.slackDays}d slack)`
        : `SOP ${fmtDate(proj.sopDate)} AT RISK (≈${-o.slackDays}d overshoot)`;
    }
    const products = [proj.hasGas && 'GAS', proj.hasGbi && 'GBI', proj.hasDigitalKey && 'Digital Key']
      .filter(Boolean)
      .join('+') || 'AAOS only';
    ev.push(
      'portfolio',
      `program "${proj.name}" (partner ${proj.partner.name}): health ${parseHealth(proj.theNeedle)}; ${sopClause}; 12-month volume ${proj.volumeFirstYear.toLocaleString('en')}; products ${products}${proj.states[0]?.notes ? `; latest note: ${proj.states[0].notes}` : ''}`,
      { label: proj.name, href: `/programs/${proj.id}`, external: false },
    );
  }

  // Recent cross-program signal: newest notes + digests inside the window.
  const [recentStates, recentContext] = await Promise.all([
    prisma.projectState.findMany({
      where: { timestamp: { gte: windowStart }, notes: { not: null }, project: { isArchived: false } },
      orderBy: { timestamp: 'desc' },
      take: 15,
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.contextUrl.findMany({
      where: { createdAt: { gte: windowStart }, ingestedText: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { project: { select: { id: true, name: true } } },
    }),
  ]);
  for (const s of recentStates) {
    ev.push(
      'needle',
      `"${s.project.name}" update ${fmtDate(s.timestamp)}: health ${parseHealth(s.theNeedle)} — ${s.notes}`,
      { label: `Weekly update · ${s.project.name}`, href: `/history/project/${s.project.id}`, external: false },
    );
  }
  for (const c of recentContext) {
    ev.push(
      'context',
      `ingested ${c.type} ${fmtDate(c.createdAt)}${c.title ? ` "${c.title}"` : ''}${c.project ? ` (${c.project.name})` : ''}: ${c.ingestedText!.slice(0, 500)}`,
      { label: c.title || `${c.type} source`, href: c.url, external: true },
    );
  }

  return projects.length;
}

/** The active prompt for a scope: DB row wins, defaults (lib/summaryPrompts) otherwise. */
export async function getPrompt(scope: SummaryScope): Promise<{ prompt: string; source: 'db' | 'default' }> {
  const row = await prisma.summaryPrompt.findUnique({ where: { scope } });
  return row?.prompt?.trim()
    ? { prompt: row.prompt, source: 'db' }
    : { prompt: DEFAULT_SUMMARY_PROMPTS[scope], source: 'default' };
}

/** Generate + persist a new summary for the scope. Null when Gemini is unconfigured
 *  or the target does not exist. */
export async function createSummary(
  scope: SummaryScope,
  targetId: number,
  trigger: 'auto' | 'manual',
): Promise<number | null> {
  if (!geminiConfigured) return null;

  const last = await prisma.summary.findFirst({
    where: { scope, targetId },
    orderBy: { generatedAt: 'desc' },
    select: { generatedAt: true },
  });
  const windowEnd = new Date();
  const windowStart = last?.generatedAt ?? new Date(windowEnd.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);

  const ev = new EvidenceList();
  let subject: string;
  if (scope === 'program') {
    const project = await gatherProgramEvidence(targetId, windowStart, ev);
    if (!project) return null;
    subject = `"${project.name}" (partner: ${project.partner.name})`;
  } else if (scope === 'partner') {
    const partner = await gatherPartnerEvidence(targetId, windowStart, ev);
    if (!partner) return null;
    subject = `"${partner.name}"`;
  } else {
    const count = await gatherEcosystemEvidence(windowStart, ev);
    subject = `the AutoKnow ecosystem (${count} active programs)`;
  }
  if (ev.records.length === 0) return null;

  const { prompt } = await getPrompt(scope);
  const fullPrompt = `${prompt.replaceAll('{SUBJECT}', subject)}

EVIDENCE:
${ev.records.map((e) => `[${e.id}] (${e.kind}) ${e.text}`).join('\n')}`;

  const raw = await generateStructuredSummary(fullPrompt);
  if (!raw) return null;

  // Map evidence ids to concrete citations, dropping hallucinated ids; strip any
  // bracketed id references the model wrote into the prose.
  const stripIds = (text: string) => text.replace(/\s*\[[0-9,\s]+\]/g, '').trim();
  const toBullets = (bullets: { text: string; evidence: number[] }[]): SummaryBullet[] =>
    (bullets ?? []).map((b) => ({
      text: stripIds(b.text),
      citations: [...new Set(b.evidence)]
        .map((id) => ev.records[id]?.citation)
        .filter((c): c is SummaryCitation => !!c),
    }));

  const body: SummaryBody = {
    sections: SECTION_KEYS.map((key) => ({ key, bullets: toBullets(raw[key]) })).filter(
      (s) => s.bullets.length > 0,
    ),
  };

  const row = await prisma.summary.create({
    data: {
      scope,
      targetId,
      trigger,
      model: SUMMARY_MODEL,
      windowStart,
      windowEnd,
      tldr: stripIds(raw.tldr),
      body: JSON.parse(JSON.stringify(body)),
      sourceCounts: ev.counts,
    },
  });
  return row.id;
}

/** Latest summary for a scope, with a staleness flag against newer scope-relevant
 *  content (new content ingested or added ⇒ stale ⇒ the panel refreshes it). */
export async function getSummary(scope: SummaryScope, targetId: number): Promise<SummaryView | null> {
  const row = await prisma.summary.findFirst({
    where: { scope, targetId },
    orderBy: { generatedAt: 'desc' },
  });
  if (!row) return null;

  const after = row.generatedAt;
  let stale = false;
  if (scope === 'program') {
    const [a, b, c] = await Promise.all([
      prisma.projectState.findFirst({ where: { projectId: targetId, timestamp: { gt: after } }, select: { id: true } }),
      prisma.phaseState.findFirst({ where: { phase: { projectId: targetId }, timestamp: { gt: after } }, select: { id: true } }),
      prisma.contextUrl.findFirst({ where: { projectId: targetId, createdAt: { gt: after } }, select: { id: true } }),
    ]);
    stale = !!(a || b || c);
  } else if (scope === 'partner') {
    const [a, b, c, d] = await Promise.all([
      prisma.partnerState.findFirst({ where: { partnerId: targetId, timestamp: { gt: after } }, select: { id: true } }),
      prisma.contextUrl.findFirst({ where: { partnerId: targetId, createdAt: { gt: after } }, select: { id: true } }),
      prisma.projectState.findFirst({ where: { project: { partnerId: targetId }, timestamp: { gt: after } }, select: { id: true } }),
      prisma.phaseState.findFirst({ where: { phase: { project: { partnerId: targetId } }, timestamp: { gt: after } }, select: { id: true } }),
    ]);
    stale = !!(a || b || c || d);
  } else {
    const [a, b, c] = await Promise.all([
      prisma.projectState.findFirst({ where: { timestamp: { gt: after } }, select: { id: true } }),
      prisma.phaseState.findFirst({ where: { timestamp: { gt: after } }, select: { id: true } }),
      prisma.contextUrl.findFirst({ where: { createdAt: { gt: after } }, select: { id: true } }),
    ]);
    stale = !!(a || b || c);
  }

  const counts = row.sourceCounts as Record<string, number> | null;
  return {
    id: row.id,
    scope,
    targetId,
    generatedAt: row.generatedAt.toISOString(),
    trigger: row.trigger,
    model: row.model,
    tldr: row.tldr,
    body: row.body as unknown as SummaryBody,
    sourceCount: counts ? Object.values(counts).reduce((x, y) => x + y, 0) : 0,
    stale,
  };
}
