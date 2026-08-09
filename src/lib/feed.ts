import 'server-only';
import { unifiedSearch } from './search';
import { getActivity } from './activity';

// The one shape shared by search results and the activity feed, so a single endpoint
// and a single component serve both. Search fills `score` (relevance); activity fills
// `timestamp` (recency). Same list, two orderings.

// `partner` and `project` narrow by SUBJECT — what an item is about. `person` is the odd
// one and narrows by ACTOR — who recorded it (#127 E10, #176). That difference is
// why it reads the free-text `source`/`addedBy` columns rather than a foreign key, and
// why `lib/activity` labels its items with the job held on each item's OWN day instead
// of a single company for the whole list.
export type FeedScope =
  | { kind: 'ecosystem' }
  | { kind: 'partner'; id: number }
  | { kind: 'project'; id: number }
  | { kind: 'person'; id: number };

/** Entity/context types that search can filter by. */
export type FeedType = 'partner' | 'program' | 'person' | 'context' | 'initiative';
export const FEED_TYPES: FeedType[] = ['partner', 'program', 'person', 'context', 'initiative'];

/** All item kinds: the searchable types plus system-of-record event kinds. */
export type FeedKind = FeedType | 'status' | 'phase' | 'relationship' | 'program-created' | 'escalation';

/** Payload that lets an item render as a compact needle "list card" in the feed. */
export interface NeedlePayload {
  progress: number; // 0..100
  health: string | null;
  previousProgress?: number | null;
  previousHealth?: string | null;
}

/** Payload that lets a phase item render as a compact hill-chart "list card".
 *  Status is inferred from progress; `color` is the phase's own dot color. */
export interface HillPayload {
  progress: number; // 0..100
  previousProgress?: number | null;
  color: string;
}

/** Payload for partner relationship events -> renders the colorless 1..5 scale
 *  track (lib/relationship) instead of a needle gauge. */
export interface RelationshipPayload {
  score: number; // 1..5
  previousScore?: number | null;
}

export interface FeedItem {
  id: string; // unique within a list, e.g. "partner-52" or "ps-9"
  kind: FeedKind;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  href: string;
  external?: boolean; // links out to an external system of record
  timestamp?: string | null; // ISO; present for activity events
  score?: number | null; // 0..1 relevance; present for search hits
  needle?: NeedlePayload | null; // present on needle-change events -> renders a mini gauge
  hill?: HillPayload | null; // present on phase hill updates -> renders a mini hill chart
  relationship?: RelationshipPayload | null; // partner relationship updates -> 1..5 scale track
  /** #171: a watched source's "last checked" instant, kept as raw ISO rather than
   *  baked into `subtitle` — `getActivity` has no locale in scope (server-side, shared
   *  across viewers), and a freshness stamp has to render relative-to-now on the
   *  CLIENT (RelativeTime) to be hydration-safe and to stay current on a page left
   *  open. Absent unless the item's source is actively watched (see lib/activity.ts). */
  checkedAt?: string | null;
}

export interface FeedQuery {
  q?: string;
  types?: FeedType[];
  scope?: FeedScope;
  limit?: number;
}

/**
 * One entry point for both modes:
 *  - a query present  -> relevance-ranked search across the requested types + scope
 *  - no query         -> recent activity in scope (time-ordered)
 */
export async function getFeed({ q, types, scope = { kind: 'ecosystem' }, limit }: FeedQuery): Promise<FeedItem[]> {
  if (q && q.trim()) return unifiedSearch(q, { types, scope, limit });
  return getActivity(scope, limit);
}
