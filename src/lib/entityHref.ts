// The entity → in-app route map for the briefing and activity surfaces. "Everything is
// a URL" (design.md §2): an entity shown here links to its detail route, and a URL is
// DATA resolved at this boundary — never a string a model emitted (AGENTS lessons 3,
// 15). The phase link is its own family (`#phase-:id-detail`, phase.ts), re-exported so
// a caller building entity links has one import. Client-safe (no server-only): the
// summary renderer and the activity feed build hrefs from here. Other call sites still
// hand-roll these literals — folding them in is a future sweep (AGENTS lesson 7).

export const personHref = (id: number): string => `/people/${id}`;
export const partnerHref = (id: number): string => `/partners/${id}`;
export const programHref = (id: number): string => `/programs/${id}`;

export { phaseDetailHref } from './phase';
