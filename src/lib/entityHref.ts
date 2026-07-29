// The entity → in-app route map for the briefing and activity surfaces. "Everything is
// a URL" (design.md §2): an entity shown here links to its detail route, and a URL is
// DATA resolved at this boundary — never a string a model emitted (AGENTS lessons 3,
// 15). The phase link is its own family (`#phase-:id`, phase.ts), re-exported so
// a caller building entity links has one import. Client-safe (no server-only): the
// summary renderer and the activity feed build hrefs from here. Other call sites still
// hand-roll these literals — folding them in is a future sweep (AGENTS lesson 7).

import { relUpdateHash } from './relationship';
import { statusUpdateHash } from './needle';

export const personHref = (id: number): string => `/people/${id}`;
export const partnerHref = (id: number): string => `/partners/${id}`;
export const programHref = (id: number): string => `/programs/${id}`;

/** `/escalations/42` (#245). Here from the first commit rather than hand-rolled at the
 *  call sites, because this URL is DATA the moment it exists: the Chat reply posts it into
 *  a thread that keeps it forever, and AI-brief citations persist hrefs — so retiring or
 *  moving it later means migrating rows, not grepping `src/**` (AGENTS lesson 15). */
export const escalationHref = (id: number): string => `/escalations/${id}`;

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
