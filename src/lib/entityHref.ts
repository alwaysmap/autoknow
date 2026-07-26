// The entity → in-app route map for the briefing and activity surfaces. "Everything is
// a URL" (design.md §2): an entity shown here links to its detail route, and a URL is
// DATA resolved at this boundary — never a string a model emitted (AGENTS lessons 3,
// 15). The phase link is its own family (`#phase-:id-detail`, phase.ts), re-exported so
// a caller building entity links has one import. Client-safe (no server-only): the
// summary renderer and the activity feed build hrefs from here. Other call sites still
// hand-roll these literals — folding them in is a future sweep (AGENTS lesson 7).

import { relUpdateHash } from './relationship';

export const personHref = (id: number): string => `/people/${id}`;
export const partnerHref = (id: number): string => `/partners/${id}`;
export const programHref = (id: number): string => `/programs/${id}`;

export { phaseDetailHref } from './phase';

// Partner health (#111). The fragment vocabulary is owned by `lib/relationship` (the
// domain module, as `#phase-:id-detail` is owned by `lib/phase`); the ROUTE it hangs
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
