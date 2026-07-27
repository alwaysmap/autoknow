import 'server-only';
import { prisma } from './db';

// What stops a partner being deleted — counted ONCE, for the confirmation dialog and for
// the server action that enforces it. A dialog is a PRE-FLIGHT of the guard, so it may not
// count for itself; the whole story of what happened when it did is ADR
// docs/adr/2026-07-27-a-confirmation-dialog-states-the-guards-own-count.md.
//
// THE FK IS AUTHORITATIVE HERE, AND ONLY HERE. "Which company is this person at?" is
// answered by the affiliation covering the day, and no DISPLAY path may read the cache
// (ADR currentpartnerid-is-a-cache-affiliations-are-the-truth, enforced by
// `no-restricted-syntax`). This is not a display. The question is "what would this DELETE
// break", and what it would break is the required `Person.currentPartnerId` FK: ask as-of
// and the delete goes through for a person whose reference still points here, and Postgres
// refuses the transaction with a constraint violation the user cannot act on. Referential
// integrity is answered by the reference — which is why that ADR keeps deletion guards as
// the cache's one sanctioned reader.
//
// So the partner page still shows `roster.current.length` as the employee FIGURE above the
// people table, and that number may legitimately differ from `employeeCount` here. They
// answer different questions, and only one of them is about deleting.

declare const blockersBrand: unique symbol;

export interface PartnerDeleteBlockers {
  /** Programs owned through `Project.partnerId` — the FK the delete would orphan. */
  readonly programCount: number;
  /** People whose `currentPartnerId` still points here. Not "who works here" — see above. */
  readonly employeeCount: number;
  /** True iff `deletePartner` will refuse. Derived once, so no caller re-derives it. */
  readonly blocked: boolean;
  /**
   * A phantom brand: it has no runtime value, and nothing outside this module can produce
   * one. `<PartnerAdminControls blockers={{ programCount: x, employeeCount: y }} />` with
   * numbers counted at the call site therefore does not TYPE-CHECK, so the divergence this
   * module exists to close cannot be re-authored on the next surface that needs it. The
   * rule is in the compiler rather than in this comment on purpose (AGENTS lesson 2).
   */
  readonly [blockersBrand]: true;
}

/** The two counts, before they are branded — what `partnerDeleteRefusal` needs. */
type BlockerCounts = Pick<PartnerDeleteBlockers, 'programCount' | 'employeeCount'>;

/**
 * The refusal `deletePartner` would produce, or null if nothing blocks it.
 *
 * Written for a user and carrying the em-dash `guarded` reads as "this message is meant to
 * be shown" (`lib/actionResult`). Programs come first because reassigning a program is the
 * bigger job; the dialog lists every blocker at once, so nothing is hidden by the order.
 *
 * These sentences are the SUBMIT-time fallback — the dialog refuses before the form exists,
 * in `partnerHasPrograms` / `partnerHasPeople` (`lib/i18n`, four locales). Say the same
 * thing as those keys; they are pinned separately (`tests/partnerDeleteBlockers.test.ts`
 * asserts these strings whole, `tests/partners.spec.ts` reads the rendered ones), so a
 * translation that drifts from this English is caught rather than silently shipped.
 */
export function partnerDeleteRefusal(counts: BlockerCounts): string | null {
  if (counts.programCount > 0) {
    return `Partner still owns ${counts.programCount} program(s) — reassign or delete them first`;
  }
  if (counts.employeeCount > 0) {
    return `Partner is still the employer on ${counts.employeeCount} person record(s) — reassign them first`;
  }
  return null;
}

/** Count what would block deleting `partnerId`. The ONE place either half is counted. */
export async function getPartnerDeleteBlockers(partnerId: number): Promise<PartnerDeleteBlockers> {
  const [programCount, employeeCount] = await Promise.all([
    prisma.project.count({ where: { partnerId } }),
    // eslint-disable-next-line no-restricted-syntax -- FK integrity, not display; see the header
    prisma.person.count({ where: { currentPartnerId: partnerId } }),
  ]);
  const counts = { programCount, employeeCount };
  // The one assertion in the file: the brand is a type-level marker with no runtime value,
  // so no literal can carry it.
  return { ...counts, blocked: partnerDeleteRefusal(counts) !== null } as PartnerDeleteBlockers;
}
