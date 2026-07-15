import 'server-only';
import { prisma } from './db';
import { generateProgramBrief, geminiConfigured, SUMMARY_MODEL, type BriefEvidence } from './gemini';
import { computeCriticalChain } from './criticalChain';
import { parseHealth } from './health';
import { hillStatus } from './phase';

// The Program Brief engine (spec §2.12): gather what AutoKnow already stores about a
// program — needle updates, per-phase hill updates, ingested digests, open action
// items — hand it to Gemini as numbered evidence, and persist the structured result
// append-only. Citations map evidence ids back to exact in-app/source links, so every
// bullet is verifiable. Original sources are never re-fetched.

const WINDOW_DAYS = 30; // fallback window when a program has no prior brief

export interface BriefCitation {
  label: string;
  href: string;
  external: boolean;
}

export interface BriefBullet {
  text: string;
  citations: BriefCitation[];
}

export interface BriefSection {
  key: string;
  title: string;
  bullets: BriefBullet[];
}

export interface BriefBody {
  sections: BriefSection[];
}

export interface ProgramBriefView {
  id: number;
  generatedAt: string;
  trigger: string;
  tldr: string;
  body: BriefBody;
  sourceCount: number;
  stale: boolean; // underlying data is newer than the brief
}

const SECTION_TITLES: Record<string, string> = {
  health: 'Health & trajectory',
  risks: 'Risks',
  decisions: 'Decisions',
  nextSteps: 'Next steps',
  partnerActivity: 'Partner activity',
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

interface EvidenceRecord extends BriefEvidence {
  citation: BriefCitation;
}

/** Everything the brief may cite: current state + changes inside the window. */
async function gatherEvidence(projectId: number, windowStart: Date) {
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

  const evidence: EvidenceRecord[] = [];
  const counts = { needle: 0, hill: 0, context: 0, actions: 0, chain: 0 };
  const push = (kind: BriefEvidence['kind'], text: string, citation: BriefCitation) => {
    evidence.push({ id: evidence.length, kind, text, citation });
  };

  // The critical chain — longest remaining-duration path over the phase DAG — so the
  // brief can reason about the constraint in risks/next-steps.
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
    counts.chain++;
    push(
      'chain',
      `critical chain (longest remaining-forecast path): ${chain.path.map(nameOf).join(' → ')}; about ${chain.remainingDays} forecast days of work remain on it${constraint ? `; current constraint: "${constraint}" — delay here delays the program end-to-end` : ''}`,
      { label: 'Critical chain', href: `/programs/${projectId}`, external: false },
    );
  }

  // Program needle updates: always the latest two (current + previous for trajectory),
  // plus anything else inside the window.
  project.states
    .filter((s, i) => i < 2 || s.timestamp >= windowStart)
    .forEach((s, i) => {
      counts.needle++;
      push(
        'needle',
        `${i === 0 ? 'CURRENT ' : ''}program update ${fmtDate(s.timestamp)}: health ${parseHealth(s.theNeedle)}${s.notes ? ` — ${s.notes}` : ''}${s.source ? ` (by ${s.source})` : ''}`,
        { label: `Weekly update · ${fmtDate(s.timestamp)}`, href: `/history/project/${projectId}`, external: false },
      );
    });

  // Per-phase hill updates: latest per phase always; older ones only inside the window.
  for (const phase of project.phases) {
    const partners = phase.partners.map((pp) => `${pp.partner.name}${pp.role ? ` (${pp.role})` : ''}`).join(', ');
    phase.states
      .filter((s, i) => i === 0 || s.timestamp >= windowStart)
      .forEach((s, i) => {
        counts.hill++;
        push(
          'hill',
          `${i === 0 ? 'CURRENT ' : ''}phase "${phase.name}" ${fmtDate(s.timestamp)}: ${hillStatus(s.hillChartProgress ?? 0)}${s.notes ? ` — ${s.notes}` : ''}${partners && i === 0 ? ` [partners involved: ${partners}]` : ''}`,
          { label: `${phase.name} · ${fmtDate(s.timestamp)}`, href: `/history/phase/${phase.id}`, external: false },
        );
      });

    for (const item of phase.actionItems) {
      counts.actions++;
      push(
        'action',
        `open action on "${phase.name}": ${item.description}${item.assignedTo ? ` (owner ${item.assignedTo})` : ''}, next step ${item.nextStep}`,
        { label: `Action · ${phase.name}`, href: item.linkUrl || `/programs/${projectId}`, external: !!item.linkUrl },
      );
    }
  }

  // Ingested digests (already distilled — the brief never re-fetches sources).
  project.contextUrls
    .filter((c) => c.ingestedText)
    .forEach((c) => {
      counts.context++;
      push(
        'context',
        `ingested ${c.type} ${fmtDate(c.createdAt)}${c.title ? ` "${c.title}"` : ''}: ${c.ingestedText!.slice(0, 600)}`,
        { label: c.title || `${c.type} source`, href: c.url, external: true },
      );
    });

  return { project, evidence, counts };
}

/** Generate + persist a new brief. Returns null when Gemini is unconfigured. */
export async function createProgramBrief(
  projectId: number,
  trigger: 'scheduled' | 'manual',
): Promise<number | null> {
  if (!geminiConfigured) return null;

  const lastBrief = await prisma.programBrief.findFirst({
    where: { projectId },
    orderBy: { generatedAt: 'desc' },
    select: { generatedAt: true },
  });
  const windowEnd = new Date();
  const windowStart = lastBrief?.generatedAt ?? new Date(windowEnd.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);

  const gathered = await gatherEvidence(projectId, windowStart);
  if (!gathered) return null;
  const { project, evidence, counts } = gathered;

  const raw = await generateProgramBrief(project.name, project.partner.name, evidence);
  if (!raw) return null;

  // Map evidence ids back to concrete citations, dropping ids the model hallucinated.
  // Belt-and-braces: strip any bracketed id references the model wrote into the prose —
  // citations belong in the superscripts, not the reading line.
  const stripIds = (text: string) => text.replace(/\s*\[[0-9,\s]+\]/g, '').trim();
  const toBullets = (bullets: { text: string; evidence: number[] }[]): BriefBullet[] =>
    bullets.map((b) => ({
      text: stripIds(b.text),
      citations: [...new Set(b.evidence)]
        .map((id) => evidence[id]?.citation)
        .filter((c): c is BriefCitation => !!c),
    }));

  const body: BriefBody = {
    sections: (['health', 'risks', 'decisions', 'nextSteps', 'partnerActivity'] as const)
      .map((key) => ({ key, title: SECTION_TITLES[key], bullets: toBullets(raw[key] ?? []) }))
      .filter((s) => s.bullets.length > 0),
  };

  const row = await prisma.programBrief.create({
    data: {
      projectId,
      trigger,
      model: SUMMARY_MODEL,
      windowStart,
      windowEnd,
      tldr: stripIds(raw.tldr),
      body: JSON.parse(JSON.stringify(body)),
      sourceCounts: counts,
    },
  });
  return row.id;
}

/** Latest brief for a program, with a staleness flag against newer activity. */
export async function getLatestBrief(projectId: number): Promise<ProgramBriefView | null> {
  const brief = await prisma.programBrief.findFirst({
    where: { projectId },
    orderBy: { generatedAt: 'desc' },
  });
  if (!brief) return null;

  const after = brief.generatedAt;
  const [newerState, newerPhase, newerContext] = await Promise.all([
    prisma.projectState.findFirst({ where: { projectId, timestamp: { gt: after } }, select: { id: true } }),
    prisma.phaseState.findFirst({ where: { phase: { projectId }, timestamp: { gt: after } }, select: { id: true } }),
    prisma.contextUrl.findFirst({ where: { projectId, createdAt: { gt: after } }, select: { id: true } }),
  ]);

  const countsRow = brief.sourceCounts as Record<string, number> | null;
  return {
    id: brief.id,
    generatedAt: brief.generatedAt.toISOString(),
    trigger: brief.trigger,
    tldr: brief.tldr,
    body: brief.body as unknown as BriefBody,
    sourceCount: countsRow ? Object.values(countsRow).reduce((a, b) => a + b, 0) : 0,
    stale: !!(newerState || newerPhase || newerContext),
  };
}

/** Batch generation for the daily trigger: every non-archived program whose data is
 *  newer than its last brief (or that has no brief yet). */
export async function generateDueBriefs(): Promise<{ generated: number[]; skipped: number }> {
  const projects = await prisma.project.findMany({ where: { isArchived: false }, select: { id: true } });
  const generated: number[] = [];
  let skipped = 0;
  for (const p of projects) {
    const latest = await getLatestBrief(p.id);
    if (latest && !latest.stale) {
      skipped++;
      continue;
    }
    const id = await createProgramBrief(p.id, 'scheduled');
    if (id) generated.push(p.id);
  }
  return { generated, skipped };
}
