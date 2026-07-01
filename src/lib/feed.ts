import 'server-only';
import { unifiedSearch } from './search';
import { getActivity } from './activity';

// The one shape shared by search results and the activity feed, so a single endpoint
// and a single component serve both. Search fills `score` (relevance); activity fills
// `timestamp` (recency). Same list, two orderings.

export type FeedScope =
  | { kind: 'ecosystem' }
  | { kind: 'partner'; id: number }
  | { kind: 'project'; id: number };

/** Entity/context types that search can filter by. */
export type FeedType = 'partner' | 'program' | 'person' | 'context';
export const FEED_TYPES: FeedType[] = ['partner', 'program', 'person', 'context'];

/** All item kinds: the searchable types plus system-of-record event kinds. */
export type FeedKind = FeedType | 'status' | 'phase' | 'relationship' | 'program-created';

/**
 * Broad categories the activity feed can be filtered by. Each maps from one or more
 * FeedKinds — filtering to 'needle' yields the effect of a needle-change history, and
 * 'hill' the phase progress history. Kept kind-derived so filters and rendering stay in
 * sync as new update types are added.
 */
export type FeedCategory = 'needle' | 'hill' | 'context' | 'created' | 'entity';
export function feedCategory(kind: FeedKind): FeedCategory {
  switch (kind) {
    case 'status':
    case 'relationship':
      return 'needle';
    case 'phase':
      return 'hill';
    case 'context':
      return 'context';
    case 'program-created':
      return 'created';
    default:
      return 'entity'; // partner / program / person (search hits)
  }
}

/** Payload that lets an item render as a compact needle "list card" in the feed. */
export interface NeedlePayload {
  progress: number; // 0..100
  health: string | null;
  previousProgress?: number | null;
  previousHealth?: string | null;
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
