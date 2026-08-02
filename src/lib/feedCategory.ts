import type { FeedKind } from './feed';
import type { StringKey } from './i18n';

// Broad categories the activity feed filters by, derived from FeedKind so filtering
// stays in sync with rendering as new update types are added. Lives outside lib/feed
// (which is server-only) so client components can share the same mapping.

export type FeedCategory = 'needle' | 'hill' | 'context' | 'created' | 'escalation' | 'entity';

/**
 * EVERY FeedKind member gets its own case, and there is deliberately no `default`.
 *
 * A `default: return 'entity'` was tried here once and silently caught the FIRST new
 * kind added after it (#245's escalation events, briefly) — exactly the drift this
 * file's own header comment warns about. Enumerating every member instead makes the
 * omission a COMPILE ERROR: with `strict` mode's return-type checking, a switch that is
 * missing a case for one of the union's members leaves a code path with no return, and
 * `npm run typecheck` fails with "Function lacks ending return statement" — no runtime
 * test required, and it cannot be forgotten the way a default branch can.
 */
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
    case 'escalation':
      return 'escalation';
    case 'partner':
    case 'program':
    case 'person':
      return 'entity'; // search hits
  }
}

// Locale-aware labels: each category maps to an i18n key (rendered via t(locale, key));
// the English values match the labels this table used to hold verbatim.
export const FEED_CATEGORY_KEY: Record<FeedCategory, StringKey> = {
  needle: 'feedCatNeedle',
  hill: 'feedCatHill',
  context: 'contextLabel',
  created: 'feedCatCreated',
  // Reuses the nav/list-page label rather than minting a feed-specific string: the same
  // noun ("Escalations") names the same thing everywhere in the app.
  escalation: 'escalationsLabel',
  entity: 'otherLabel',
};

export const FEED_CATEGORY_ORDER: FeedCategory[] = ['needle', 'hill', 'context', 'created', 'escalation', 'entity'];
