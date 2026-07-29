import 'server-only';
import { prisma } from './db';
import { formatNeedleValue } from './needle';
import { deriveScore } from './relationship';
import { hillStatus, phaseColor } from './phase';
import { phaseDetailHref, programHref, relationshipUpdateHref } from './entityHref';
import { coversDay, jobLabel, personAliases } from './people';
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

/**
 * PERSON SCOPE needs two things the other scopes do not, and both come from one query:
 * the strings that count as "written by them" in the free-text actor columns, and the
 * CAREER, for `labelWithJobHeldThen` below.
 *
 * The career is fetched WHOLE rather than asked per item; the argument for that is on
 * `labelWithJobHeldThen`, where the comparison happens.
 */
async function personActor(personId: number) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true, name: true, email: true,
      affiliations: {
        // `email` is for `personAliases`, not for the labelling: a row written under an
        // address this person has since left is still a row they wrote (#127 E8), and
        // dropping the column here would silently narrow the feed back to their current
        // address. `role`, `startDate`, `endDate` and `partner.name` are
        // `labelWithJobHeldThen`'s.
        select: {
          email: true, role: true, startDate: true, endDate: true,
          partner: { select: { name: true } },
        },
        // Newest start first — the ordering contract `labelWithJobHeldThen` depends on.
        orderBy: { startDate: 'desc' },
      },
    },
  });
  if (!person) return null;
  return { aliases: personAliases(person), career: person.affiliations };
}

type Career = NonNullable<Awaited<ReturnType<typeof personActor>>>['career'];

/**
 * EACH ITEM AS OF ITS OWN DAY — ADR `a-dated-row-is-labelled-as-of-its-own-date`, which
 * carries the decision and the readings rejected. A person's company and title are
 * properties of an employment PERIOD, so a feed spanning a career resolves them per row:
 * the 2022 update says Bosch because that is where she was in 2022, and the row above it
 * says Google. Stamping every row with the job held TODAY is #124 Class 2.
 *
 * Compared in JS by `coversDay` against a career already in hand, not asked per item
 * through `profileAsOf` — `lib/profiles`' header draws exactly that line, and 25 items
 * would otherwise be 25 round trips. The two spellings answer identically since
 * autoknow-yid made `asOfWhere` day-granular too, so a row here and the identity line
 * above it agree on a boundary date; they used to disagree, and /people/:id rendering
 * both is how that showed. Writing a third date comparison here rather than using one of
 * them is still the bug.
 *
 * A row in a GAP between jobs — or older than the first period — keeps its subtitle
 * unchanged rather than borrowing the nearest company. Null is a real answer here too.
 *
 * `career` MUST be newest-start-first (`personActor` orders it so). A contiguous career
 * has exactly one covering period, but the affiliations API can still author an overlap
 * (autoknow-2of), and taking the FIRST match of that ordering is what makes this pick the
 * same row `profileAsOf` would. Reorder the query and the two silently disagree.
 */
function labelWithJobHeldThen(items: FeedItem[], career: Career): FeedItem[] {
  return items.map((item) => {
    const at = item.timestamp;
    if (!at) return item;
    const heldPeriod = career.find((period) => coversDay(period, new Date(at)));
    if (!heldPeriod) return item;
    return { ...item, subtitle: [item.subtitle, jobLabel(heldPeriod)].filter(Boolean).join(' · ') };
  });
}

export async function getActivity(scope: FeedScope, take = ACTIVITY_PAGE_SIZE): Promise<FeedItem[]> {
  let actor: Awaited<ReturnType<typeof personActor>> = null;
  if (scope.kind === 'person') {
    actor = await personActor(scope.id);
    // An id naming nobody yields an empty alias list, and `{ OR: [] }` already matches no
    // rows — so this is not load-bearing for correctness. It is here to skip four queries
    // that cannot return anything, and to say that outright at the top.
    if (!actor) return [];
  }
  // PERSON SCOPE ONLY — the actor filter, per column: `source` on the three state tables,
  // `addedBy` on ContextUrl (what those columns hold is on `personAliases`, lib/people).
  // An OR of case-insensitive equals rather than an `IN`, because nothing normalizes
  // these on the way in and `IN` cannot be case-insensitive.
  const aliases = actor?.aliases ?? [];
  const wroteStateWhere = { OR: aliases.map((a) => ({ source: { equals: a, mode: 'insensitive' as const } })) };
  const addedContextWhere = { OR: aliases.map((a) => ({ addedBy: { equals: a, mode: 'insensitive' as const } })) };

  // Name the program/partner on each item except when the page IS that program —
  // a partner page spans many programs, so items there stay ambiguous without it.
  const showEntity = scope.kind !== 'project';
  const meta = (entityLabel: string | null, source: string | null, withSource: boolean): string | null => {
    const parts: string[] = [];
    if (showEntity && entityLabel) parts.push(entityLabel);
    // On a person's own feed every row is theirs, so "by <handle>" is the same word 25
    // times. The attribution that DOES vary comes from `labelWithJobHeldThen`.
    if (withSource && scope.kind !== 'person' && source) parts.push(`by ${source}`);
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
        : scope.kind === 'person'
          ? addedContextWhere
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
    // when they were last checked; frozen ones say why they no longer are. The
    // frozen case stays a plain (still unlocalized — getActivity has no locale in
    // scope, a pre-existing gap this issue does not extend) string; the "checked"
    // case is a FRESHNESS STAMP (#171), not a caption, so it rides in `checkedAt` as
    // a raw instant instead of being baked into `subtitle` — the renderer (FeedList /
    // LatestTeasers) answers "is this current" as a duration via RelativeTime,
    // client-side, hydration-safe, on the viewer's own locale.
    const frozenNote = c.frozenReason ? `frozen — ${c.frozenReason}` : null;
    const checkedAt = !c.frozenReason && c.mode === 'watched' ? c.lastCheckedAt?.toISOString() ?? null : null;
    push(events, {
      id: `ctx-${c.id}`,
      kind: 'context',
      title: c.title || 'Ingested document',
      subtitle: [meta(c.project?.name ?? c.partner?.name ?? null, c.type, false), frozenNote]
        .filter(Boolean)
        .join(' · ') || null,
      detail: clampDetail(c.ingestedText),
      href: c.url,
      external: true,
      timestamp: c.createdAt.toISOString(),
      checkedAt,
    });
  }

  // ---- Source updates: one event per re-distillation with a real delta (plan §7) ----
  // Skipped in person scope: `ContextRevision` has no actor column, because a
  // re-distillation is MACHINE-driven — there is no human to attribute it to (#176).
  // Filtering it by `contextWhere` here would attribute the re-check to whoever added
  // the document, which is a different person and a different act.
  if (scope.kind !== 'person') {
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
  }

  // ---- Project status events (needle / hill-chart / program created) ----
  const projectStateWhere =
    scope.kind === 'partner'
      ? { project: { partnerId: scope.id } }
      : scope.kind === 'project'
        ? { projectId: scope.id }
        : scope.kind === 'person'
          ? wroteStateWhere
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
      href: created ? programHref(s.project.id) : `${programHref(s.project.id)}#status-history`,
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
        : scope.kind === 'person'
          ? wroteStateWhere
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
    const partnerStateWhere =
      scope.kind === 'partner'
        ? { partnerId: scope.id }
        : scope.kind === 'person'
          ? wroteStateWhere
          : {};
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
        title: 'Relationship update',
        // On the partner's own page the name is redundant; every OTHER scope spans
        // partners (a person's feed as much as the ecosystem's), so it labels.
        subtitle: meta(scope.kind === 'partner' ? null : s.partner.name, s.source, true),
        detail: clampDetail(s.notes),
        // Deep-link to THIS update inside the partner-health popover, the way the
        // status and phase rows above already deep-link (#111). The bare partner
        // page was a dead end: the reader clicked one update and got the whole page.
        href: relationshipUpdateHref(s.partner.id, s.id),
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
  const pageItems = events.slice(0, take);
  // After the slice, so the career is walked `take` times and not once per candidate.
  return actor ? labelWithJobHeldThen(pageItems, actor.career) : pageItems;
}
