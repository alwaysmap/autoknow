// The entity → in-app route map for the briefing and activity surfaces. "Everything is
// a URL" (design.md §2): an entity shown here links to its detail route, and a URL is
// DATA resolved at this boundary — never a string a model emitted (AGENTS lessons 3,
// 15). The phase link is its own family (`#phase-:id`, phase.ts), re-exported so
// a caller building entity links has one import. Client-safe (no server-only): the
// summary renderer and the activity feed build hrefs from here. Other call sites still
// hand-roll these literals — folding them in is a future sweep (AGENTS lesson 7).

import { relUpdateHash } from './relationship';
import { statusUpdateHash } from './needle';

import type { SummaryScope } from './summaryPrompts';

export const personHref = (id: number): string => `/people/${id}`;
export const partnerHref = (id: number): string => `/partners/${id}`;
export const programHref = (id: number): string => `/programs/${id}`;

/** `/escalations/42` (#245). Here from the first commit rather than hand-rolled at the
 *  call sites, because this URL is DATA the moment it exists: the Chat reply posts it into
 *  a thread that keeps it forever, and AI-brief citations persist hrefs — so retiring or
 *  moving it later means migrating rows, not grepping `src/**` (AGENTS lesson 15). */
export const escalationHref = (id: number): string => `/escalations/${id}`;

export const initiativeHref = (id: number): string => `/initiatives/${id}`;

/** The USER-VISIBLE home of an initiative's per-partner copy (gh-286, owner call
 *  2026-08-08): copies present under their initiative, not as free-standing programs.
 *  `/programs/[id]` REDIRECTS copies here, so `programHref` callers and every persisted
 *  citation to the old shape keep resolving (AGENTS lesson 15) — new surfaces that KNOW
 *  the pair should link here directly. */
export const initiativeProjectHref = (initiativeId: number, projectId: number): string =>
  `/initiatives/${initiativeId}/${projectId}`;

/** Where a leadership brief LIVES, for the citation on the previous-brief evidence record
 *  (#236). There is no per-brief URL — a scope's panel always shows its newest — so this
 *  addresses the page that rendered it, the honest target for "the claim you already
 *  have". Here rather than in `summaries.ts` for the same reason as `escalationHref`
 *  above: a brief citation persists its href, so this one is DATA (AGENTS lesson 15). */
export const summaryScopeHref = (scope: SummaryScope, targetId: number): string => {
  if (scope === 'program') return programHref(targetId);
  if (scope === 'partner') return partnerHref(targetId);
  if (scope === 'initiative') return initiativeHref(targetId);
  return '/ecosystem';
};

export { phaseHref, phaseProgressHref, phaseUpdateHref } from './phase';

/** `/programs/7#status-update-42` — opens the program's status log at ONE update.
 *  Every reference to a program-status update (feed row, briefing citation) uses this,
 *  for the same reason `relationshipUpdateHref` exists: a link to one update that lands
 *  on the whole log makes the reader find it again (autoknow-51j). */
export const programStatusUpdateHref = (projectId: number, stateId: number): string =>
  `${programHref(projectId)}#${statusUpdateHash(stateId)}`;

// Partner health (#111). The fragment vocabulary is owned by `lib/relationship` (the
// domain module, as `#phase-:id` is owned by `lib/phase`); the ROUTE it hangs
// off is owned here, so `/partners/:id` has one spelling — the small divergence from
// `phase.ts`, which repeats `/programs/:id`.
//
// Only the per-update link has a builder, because only it has callers. The log's own
// fragment (`RELATIONSHIP_HISTORY_HASH`) is written by the popover when a user opens
// it by hand, and needs no href helper until something links to it.

/** `/partners/13#relationship-update-42` — opens the log at ONE update. Every
 *  reference to a partner-health update (feed row, briefing citation) uses this:
 *  a link to an update that lands on the bare partner page is a dead end. */
export const relationshipUpdateHref = (partnerId: number, stateId: number): string =>
  `${partnerHref(partnerId)}#${relUpdateHash(stateId)}`;
