import type { FeedKind } from './feed';

// Broad categories the activity feed filters by, derived from FeedKind so filtering
// stays in sync with rendering as new update types are added. Lives outside lib/feed
// (which is server-only) so client components can share the same mapping.

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

export const FEED_CATEGORY_LABEL: Record<FeedCategory, string> = {
  needle: 'Needle changes',
  hill: 'Hill updates',
  context: 'Context',
  created: 'Created',
  entity: 'Other',
};

export const FEED_CATEGORY_ORDER: FeedCategory[] = ['needle', 'hill', 'context', 'created', 'entity'];
