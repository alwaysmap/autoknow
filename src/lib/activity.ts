import 'server-only';
import { prisma } from './db';
import { formatNeedleValue } from './needle';
import { deriveScore } from './relationship';
import { hillStatus, phaseColor, phaseDetailHref } from './phase';
import type { FeedItem, FeedScope, FeedKind } from './feed';

// The unified activity stream as FeedItem[]: ingested context AND core system-of-record
// events (program created, needle changed, hill-chart progress moved, phase tagged,
// relationship needle changed), merged chronologically and sliceable by scope. Shares
// the FeedItem shape with search so one component renders both.

const PROGRAM_CREATED_NOTE = 'Program created';
// Feed cards clamp the detail visually; truncating here keeps whole ingested digests
// (up to `take` of them) out of the serialized page payload.
const DETAIL_MAX = 600;
const clampDetail = (text: string | null | undefined): string | null =>
  !text ? null : text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text;

/**
 * For a newest-first list, map each index to the next OLDER item sharing its group
 * (the "previous" state for the ghost marker) in one linear pass — the per-item
 * `slice(i+1).find(...)` it replaces is O(n²).
 */
function previousByGroup<T>(items: T[], keyOf: (item: T) => number): (T | null)[] {
  const lastSeen = new Map<number, T>();
  const prev: (T | null)[] = new Array(items.length);
  for (let i = items.length - 1; i >= 0; i--) {
    const key = keyOf(items[i]);
    prev[i] = lastSeen.get(key) ?? null; // the older neighbour seen so far
    lastSeen.set(key, items[i]);
  }
  return prev;
}

// Page size for every activity stream. Each source is SQL-limited to this (take),
// then the merged list is sliced to it — so no query is ever unbounded and no page
// loads more than this many cards.
export const ACTIVITY_PAGE_SIZE = 25;

export async function getActivity(scope: FeedScope, take = ACTIVITY_PAGE_SIZE): Promise<FeedItem[]> {
  // Name the program/partner on each item except when the page IS that program —
  // a partner page spans many programs, so items there stay ambiguous without it.
  const showEntity = scope.kind !== 'project';
  const meta = (entityLabel: string | null, source: string | null, withSource: boolean): string | null => {
    const parts: string[] = [];
    if (showEntity && entityLabel) parts.push(entityLabel);
    if (withSource && source) parts.push(`by ${source}`);
    return parts.length ? parts.join(' · ') : null;
  };
  const push = (
    events: FeedItem[],
    e: Omit<FeedItem, 'score'>,
  ) => events.push({ ...e, score: null });

  const events: FeedItem[] = [];

  // ---- Ingested context ----
  const contextWhere =
    scope.kind === 'partner'
      ? { OR: [{ partnerId: scope.id }, { project: { partnerId: scope.id } }] }
      : scope.kind === 'project'
        ? { OR: [{ projectId: scope.id }, { phase: { projectId: scope.id } }] }
        : {};
  const context = await prisma.contextUrl.findMany({
    where: contextWhere,
    select: {
      id: true, url: true, type: true, title: true, ingestedText: true, createdAt: true,
      mode: true, frozenReason: true, lastCheckedAt: true,
      project: { select: { name: true } },
      partner: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });
  for (const c of context) {
    // Freshness provenance rides on the subtitle (plan §2.2): watched sources say
    // when they were last checked; frozen ones say why they no longer are.
    const provenance = c.frozenReason
      ? `frozen — ${c.frozenReason}`
      : c.mode === 'watched' && c.lastCheckedAt
        ? `checked ${c.lastCheckedAt.toISOString().slice(0, 10)}`
        : null;
    push(events, {
      id: `ctx-${c.id}`,
      kind: 'context',
      title: c.title || 'Ingested document',
      subtitle: [meta(c.project?.name ?? c.partner?.name ?? null, c.type, false), provenance]
        .filter(Boolean)
        .join(' · ') || null,
      detail: clampDetail(c.ingestedText),
      href: c.url,
      external: true,
      timestamp: c.createdAt.toISOString(),
    });
  }

  // ---- Source updates: one event per re-distillation with a real delta (plan §7) ----
  const revisions = await prisma.contextRevision.findMany({
    where: { delta: { not: null }, contextUrl: contextWhere },
    select: {
      id: true, delta: true, checkedAt: true, sourceStatus: true,
      contextUrl: {
        select: {
          url: true, title: true,
          project: { select: { name: true } },
          partner: { select: { name: true } },
        },
      },
    },
    orderBy: { checkedAt: 'desc' },
    take,
  });
  for (const r of revisions) {
    const resolvedTag = r.sourceStatus === 'resolved' ? ' (resolved)' : '';
    push(events, {
      id: `rev-${r.id}`,
      kind: 'context',
      title: `Updated: ${r.contextUrl.title || 'Ingested document'}${resolvedTag}`,
      subtitle: meta(r.contextUrl.project?.name ?? r.contextUrl.partner?.name ?? null, null, false),
      detail: clampDetail(r.delta),
      href: r.contextUrl.url,
      external: true,
      timestamp: r.checkedAt.toISOString(),
    });
  }

  // ---- Project status events (needle / hill-chart / program created) ----
  const projectStateWhere =
    scope.kind === 'partner'
      ? { project: { partnerId: scope.id } }
      : scope.kind === 'project'
        ? { projectId: scope.id }
        : {};
  const projectStates = await prisma.projectState.findMany({
    where: projectStateWhere,
    select: {
      id: true, theNeedle: true, hillChartProgress: true, notes: true, source: true, timestamp: true,
      project: { select: { id: true, name: true } },
    },
    orderBy: { timestamp: 'desc' },
    take,
  });
  const projectPrev = previousByGroup(projectStates, (o) => o.project.id);
  for (let i = 0; i < projectStates.length; i++) {
    const s = projectStates[i];
    const created = s.notes?.startsWith(PROGRAM_CREATED_NOTE);
    const kind: FeedKind = created ? 'program-created' : 'status';
    // previous (older) state for this same project, for the ghost marker
    const prev = created ? null : projectPrev[i];
    push(events, {
      id: `ps-${s.id}`,
      kind,
      title: created ? 'Program created' : `Weekly update: ${formatNeedleValue(s.theNeedle)}`,
      subtitle: meta(s.project.name, s.source, true),
      detail: created ? null : clampDetail(s.notes),
      // Metric changes link to the value-over-time chart; creation links to the program.
      href: created ? `/programs/${s.project.id}` : `/programs/${s.project.id}#status-history`,
      external: false,
      timestamp: s.timestamp.toISOString(),
      needle: created ? null : {
        progress: s.hillChartProgress ?? 0,
        health: s.theNeedle,
        previousProgress: prev ? prev.hillChartProgress ?? null : null,
        previousHealth: prev ? prev.theNeedle : null,
      },
    });
  }

  // ---- Phase status events ----
  const phaseStateWhere =
    scope.kind === 'partner'
      ? { phase: { project: { partnerId: scope.id } } }
      : scope.kind === 'project'
        ? { phase: { projectId: scope.id } }
        : {};
  const phaseStates = await prisma.phaseState.findMany({
    where: phaseStateWhere,
    select: {
      id: true, phaseId: true, status: true, theNeedle: true, hillChartProgress: true, notes: true, source: true, timestamp: true,
      phase: { select: { name: true, project: { select: { id: true, name: true } } } },
    },
    orderBy: { timestamp: 'desc' },
    take,
  });
  const phasePrev = previousByGroup(phaseStates, (o) => o.phaseId);
  for (let i = 0; i < phaseStates.length; i++) {
    const s = phaseStates[i];
    const prev = phasePrev[i];
    const progress = s.hillChartProgress ?? 0;
    push(events, {
      id: `phs-${s.id}`,
      kind: 'phase',
      title: `${s.phase.name}: ${hillStatus(progress)}`,
      subtitle: meta(s.phase.project.name, s.source, true),
      detail: clampDetail(s.notes),
      href: phaseDetailHref(s.phase.project.id, s.phaseId),
      external: false,
      timestamp: s.timestamp.toISOString(),
      hill: {
        progress,
        previousProgress: prev ? prev.hillChartProgress ?? null : null,
        color: phaseColor(s.phaseId),
      },
    });
  }

  // ---- Partner relationship events (skip in project scope) ----
  if (scope.kind !== 'project') {
    const partnerStateWhere = scope.kind === 'partner' ? { partnerId: scope.id } : {};
    const partnerStates = await prisma.partnerState.findMany({
      where: partnerStateWhere,
      select: {
        id: true, theNeedle: true, relationshipScore: true, notes: true, source: true, timestamp: true,
        partner: { select: { id: true, name: true } },
      },
      orderBy: { timestamp: 'desc' },
      take,
    });
    const partnerPrev = previousByGroup(partnerStates, (o) => o.partner.id);
    for (let i = 0; i < partnerStates.length; i++) {
      const s = partnerStates[i];
      const prev = partnerPrev[i];
      // Relationship health is a 1..5 position, not a needle (lib/relationship).
      const score = deriveScore(s);
      push(events, {
        id: `pas-${s.id}`,
        kind: 'relationship',
        // On the partner's own page the name is redundant — only label at ecosystem scope.
        title: 'Relationship update',
        subtitle: meta(scope.kind === 'ecosystem' ? s.partner.name : null, s.source, true),
        detail: clampDetail(s.notes),
        href: `/partners/${s.partner.id}`,
        external: false,
        timestamp: s.timestamp.toISOString(),
        relationship: {
          score,
          previousScore: prev ? deriveScore(prev) : null,
        },
      });
    }
  }

  events.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return events.slice(0, take);
}
