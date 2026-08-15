import 'server-only';
import { prisma } from './db';
import { orgEmailDomain } from './auth';
import { addressesOnFile, personDirectorySelect } from './people';
import type { UntrackedContext } from './untrackedPeople';

// The database half of #126 / #127 E15: what the pure detector cannot know — which
// addresses already name a Person, and which a human has dismissed as not-a-person.
//
// It is a SEPARATE module from `untrackedPeople` so that one stays client-safe and
// unit-testable without a database, which is the same division `lib/people` and
// `lib/profiles` draw and for the same reason.

/**
 * Every address that already names somebody, plus every address a human has silenced.
 *
 * THE SAFETY ARGUMENT LIVES HERE. `addressesOnFile` is what makes the tracked set
 * include addresses a person has LEFT (#127 E8) — without that, a mention of
 * `alice.waters@bosch.com` for an Alice who moved to Google reads as untracked, and one
 * click forks her: every `personId` FK stays on the original, her history splits, and
 * both rows then compete in `resolvePerson`. That is `copyPerson`'s damage (#124 Class
 * 3) with a friendly button, at ingestion scale — and it is precisely why #126 blocked
 * itself on #124 Phase 3 rather than shipping first.
 *
 * WHOLE-TABLE, not filtered to the addresses on the page. Two reasons, and the second is
 * the one that matters: the sets are small (people are hundreds, dismissals are a
 * handful), and a filtered query would have to be handed the mentions — which means
 * PARSING the prose to build the query that decides how to parse the prose. The detector
 * would then exist in two places, which is the shape this module was split to avoid.
 */
export async function untrackedContext(): Promise<UntrackedContext> {
  const [people, ignored] = await Promise.all([
    prisma.person.findMany({ select: personDirectorySelect }),
    prisma.ignoredAddress.findMany({ select: { address: true } }),
  ]);
  return {
    tracked: new Set(people.flatMap(addressesOnFile)),
    dismissed: new Set(ignored.map((i) => i.address)),
    // Resolved HERE, in a `server-only` module, and carried to the browser as data —
    // which is what makes the pure detector's `defaultDomain` honest on both sides.
    defaultDomain: orgEmailDomain(),
  };
}
