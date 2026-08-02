/** @jest-environment node */
// The FeedKind -> FeedCategory mapping (#245 section A's "also needed" ratchet). The real
// guard is the exhaustive switch in lib/feedCategory.ts itself — no `default`, so
// `npm run typecheck` fails with "Function lacks ending return statement" the moment a new
// FeedKind is added without a matching case (verified by hand: removing a case from that
// switch and running `tsc --noEmit` reproduces exactly that error). This file pins the
// CURRENT mapping so a reviewer sees the assignment change, not just a green checkmark.

import { feedCategory, FEED_CATEGORY_KEY, FEED_CATEGORY_ORDER, type FeedCategory } from '../src/lib/feedCategory';
import type { FeedKind } from '../src/lib/feed';

describe('feedCategory', () => {
  it('maps every known FeedKind to its category', () => {
    const expected: Record<FeedKind, FeedCategory> = {
      status: 'needle',
      relationship: 'needle',
      phase: 'hill',
      context: 'context',
      'program-created': 'created',
      escalation: 'escalation',
      partner: 'entity',
      program: 'entity',
      person: 'entity',
    };
    for (const [kind, category] of Object.entries(expected)) {
      expect(feedCategory(kind as FeedKind)).toBe(category);
    }
  });

  it('never puts a system-of-record event kind in the search-hit bucket', () => {
    // 'entity' is the correct answer ONLY for the four searchable types — a bug that
    // widened the switch's fallthrough would land a new event kind here silently, which
    // is exactly the drift this file exists to catch.
    for (const kind of ['status', 'relationship', 'phase', 'program-created', 'escalation'] as const) {
      expect(feedCategory(kind)).not.toBe('entity');
    }
  });

  it('gives every category a display key and exactly one place in the filter-chip order', () => {
    const categories = Object.keys(FEED_CATEGORY_KEY) as FeedCategory[];
    for (const c of categories) {
      expect(FEED_CATEGORY_KEY[c]).toBeTruthy();
      expect(FEED_CATEGORY_ORDER.filter((o) => o === c)).toHaveLength(1);
    }
    expect(FEED_CATEGORY_ORDER).toHaveLength(categories.length);
  });

  it('reuses the nav label for the escalation chip rather than minting a second string', () => {
    expect(FEED_CATEGORY_KEY.escalation).toBe('escalationsLabel');
  });
});
