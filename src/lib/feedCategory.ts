import type { FeedKind } from './feed';
import type { StringKey } from './i18n';

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

// Locale-aware labels: each category maps to an i18n key (rendered via t(locale, key));
// the English values match the labels this table used to hold verbatim.
export const FEED_CATEGORY_KEY: Record<FeedCategory, StringKey> = {
  needle: 'feedCatNeedle',
  hill: 'feedCatHill',
  context: 'contextLabel',
  created: 'feedCatCreated',
  entity: 'otherLabel',
};

export const FEED_CATEGORY_ORDER: FeedCategory[] = ['needle', 'hill', 'context', 'created', 'entity'];
