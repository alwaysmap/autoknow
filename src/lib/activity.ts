import 'server-only';
import { prisma } from './db';
import { formatNeedleValue } from './needle';
import { hillStatus, phaseColor } from './phase';
import type { FeedItem, FeedScope, FeedKind } from './feed';

// The unified activity stream as FeedItem[]: ingested context AND core system-of-record
// events (program created, needle changed, hill-chart progress moved, phase tagged,
// relationship needle changed), merged chronologically and sliceable by scope. Shares
// the FeedItem shape with search so one component renders both.

const PROGRAM_CREATED_NOTE = 'Program created';

export async function getActivity(scope: FeedScope, take = 60): Promise<FeedItem[]> {
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
      project: { select: { name: true } },
      partner: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });
  for (const c of context) {
    push(events, {
      id: `ctx-${c.id}`,
      kind: 'context',
      title: c.title || 'Ingested document',
      subtitle: meta(c.project?.name ?? c.partner?.name ?? null, c.type, false),
      detail: c.ingestedText,
      href: c.url,
      external: true,
      timestamp: c.createdAt.toISOString(),
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
  for (let i = 0; i < projectStates.length; i++) {
    const s = projectStates[i];
    const created = s.notes?.startsWith(PROGRAM_CREATED_NOTE);
    const kind: FeedKind = created ? 'program-created' : 'status';
    // previous (older) state for this same project, for the ghost marker
    const prev = created ? null : projectStates.slice(i + 1).find((o) => o.project.id === s.project.id) ?? null;
    push(events, {
      id: `ps-${s.id}`,
      kind,
      title: created ? 'Program created' : `Weekly update: ${formatNeedleValue(s.theNeedle)}`,
      subtitle: meta(s.project.name, s.source, true),
      detail: created ? null : s.notes,
      // Metric changes link to the value-over-time chart; creation links to the program.
      href: created ? `/programs/${s.project.id}` : `/history/project/${s.project.id}`,
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
  for (let i = 0; i < phaseStates.length; i++) {
    const s = phaseStates[i];
    const prev = phaseStates.slice(i + 1).find((o) => o.phaseId === s.phaseId) ?? null;
    const progress = s.hillChartProgress ?? 0;
    push(events, {
      id: `phs-${s.id}`,
      kind: 'phase',
      title: `${s.phase.name}: ${hillStatus(progress)}`,
      subtitle: meta(s.phase.project.name, s.source, true),
      detail: s.notes,
      href: `/history/phase/${s.phaseId}`,
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
        id: true, theNeedle: true, hillChartProgress: true, notes: true, source: true, timestamp: true,
        partner: { select: { id: true, name: true } },
      },
      orderBy: { timestamp: 'desc' },
      take,
    });
    for (let i = 0; i < partnerStates.length; i++) {
      const s = partnerStates[i];
      const prev = partnerStates.slice(i + 1).find((o) => o.partner.id === s.partner.id) ?? null;
      push(events, {
        id: `pas-${s.id}`,
        kind: 'relationship',
        // On the partner's own page the name is redundant — only label at ecosystem scope.
        title: `Relationship: ${formatNeedleValue(s.theNeedle)}`,
        subtitle: meta(scope.kind === 'ecosystem' ? s.partner.name : null, s.source, true),
        detail: s.notes,
        href: `/history/partner/${s.partner.id}`,
        external: false,
        timestamp: s.timestamp.toISOString(),
        needle: {
          progress: s.hillChartProgress ?? 0,
          health: s.theNeedle,
          previousProgress: prev ? prev.hillChartProgress ?? null : null,
          previousHealth: prev ? prev.theNeedle : null,
        },
      });
    }
  }

  events.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return events.slice(0, take);
}
