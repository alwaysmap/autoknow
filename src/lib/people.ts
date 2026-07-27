import { deriveEmail, normalizeHandle } from './auth';

// Two things about a person that several surfaces each used to answer for themselves:
// WHEN an affiliation applies (hasTakenEffect / coversDay — #124's half-open periods,
// compared at UTC-day granularity), and WHICH person a name or handle means
// (resolvePerson, below).
//
// Resolution came first. Previously this logic was copy-pasted in 4+ files, and each copy's email branch
// was dead (it compared a full email against an already-stripped handle), so every
// lookup fell through to a `name.includes(handle)` substring match — which linked
// handles like 'jo' to unrelated people such as 'Joanne'. Resolve on the unique
// email instead, with exact (non-substring) fallbacks only.

export interface PersonLike {
  id: number;
  name: string;
  email: string;
}

/**
 * Has an effective date ARRIVED as of `at`? The single answer IN JAVASCRIPT, so a
 * scheduled change cannot be judged "already applied" by one caller and "still pending"
 * by another. `coversDay` below is the period-shaped question built on it; route new
 * callers to one of the two rather than writing a third date comparison.
 *
 * A caller holding rows already asks here. A caller that still has to FETCH them asks
 * `./profiles`, where the same rule is a SQL predicate against E4's indexes — those two
 * are the only sanctioned spellings, and a third `endDate == null` is the bug.
 *
 * THE SAME-DAY BOUNDARY BELONGS TO THE FUTURE. Employment periods are half-open
 * (#124 §2, `start <= t < end`), so `t === start` falls INSIDE the new period:
 * a change effective TODAY has taken effect today. That is also the only reading
 * that matches what a user means by "effective 25 Jul" — on the 25th, it is done.
 *
 * COMPARED AT UTC-DAY GRANULARITY, never as raw instants. An employment change is
 * a CALENDAR fact — the boundary is a day, and the affiliation rows either side of
 * it are dates. Effective dates arrive here in two shapes: the dialog's
 * `<input type="date">` coerces to UTC midnight, while the seed hands over a full
 * ISO timestamp. Comparing instants would let one calendar day answer differently
 * depending on which shape it came in as. UTC rather than the machine's zone
 * because every date surface in this app is pinned to UTC (lib/dates.ts) — a
 * server in another zone must not shift the boundary by a day.
 */
export function hasTakenEffect(effective: Date | string, at: Date = new Date()): boolean {
  const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return utcDay(new Date(effective)) <= utcDay(at);
}

/**
 * Does an employment period contain `at` — i.e. is this the job held THEN? Half-open on
 * both ends by construction, since it is `hasTakenEffect` asked twice: the period has
 * started, and its end has not arrived. A period ending today therefore does NOT contain
 * today; its successor, starting today, does. `endDate: null` is an open period.
 *
 * THIS IS NOT `endDate == null`, and the difference is the whole of #127 E2a. That test
 * answers "is this period open-ended?", which coincides with "is it current?" only while
 * nothing is scheduled. Record a future-dated move and the two diverge: today's period
 * gains an endDate (so it looks like history) while the scheduled one is open (so it
 * looks current). On the seeded fixture that read as Alice Waters' role vanishing from
 * the identity line, the job she actually holds filed under History, and a job she starts
 * in November labelled "Present".
 *
 * TWO production callers, and both are the case this exists for — a surface that already
 * HOLDS the periods: `movePersonCompany` (app/actions/people), which holds the one it
 * just wrote, and `labelWithJobHeldThen` (lib/activity), which holds a whole career and
 * resolves 25 feed rows against it. The second is why re-querying is not an option here:
 * `profileAsOf` per row would be 25 round trips a page. /people/:id's identity line still
 * asks `profileAsOf`, because it has to FETCH — that is the whole division, and the lint
 * rule names both spellings so no third one gets written.
 */
export function coversDay(
  period: { startDate: Date | string; endDate: Date | string | null },
  at: Date = new Date(),
): boolean {
  if (!hasTakenEffect(period.startDate, at)) return false;
  return period.endDate == null || !hasTakenEffect(period.endDate, at);
}

/**
 * Avatar initials: FIRST name initial + LAST name initial — 'Dylan Thomas' -> 'DT',
 * 'Junichi Monma' -> 'JM', 'Anne-Marie Dubois' -> 'AD'. Taking the LAST word (not the
 * second) keeps the family name when a middle name is present, and splitting on
 * whitespace only keeps hyphenated surnames intact ('Mary Smith-Jones' -> 'MS').
 *
 * A single-token name — a mononym, or an unspaced CJK name like '本間淳一' — keeps its
 * first two characters. That is a deliberately simple rule rather than a guess at
 * every script's name order; when a name has spaces, first+last is the safe reading.
 */
export function initialsOf(name: string): string {
  const words = (name || '').trim().replace(/^@/, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  // Array.from, not [0]/slice: those index UTF-16 units and would halve an emoji or
  // an astral-plane character into a replacement glyph.
  const chars = (w: string) => Array.from(w);
  if (words.length === 1) return chars(words[0]).slice(0, 2).join('').toUpperCase();
  return (chars(words[0])[0] + chars(words[words.length - 1])[0]).toUpperCase();
}

/**
 * EVERY person a handle or email could mean, taken from the FIRST tier that matches
 * anything: exact email, then email local-part, then exact (case-insensitive) full
 * name. Empty when nothing matches. No substring matching by design.
 *
 * More than one comes back only when a tier is genuinely AMBIGUOUS — two addresses
 * sharing a local part at different domains ('alice@google.com', 'alice@bosch.com'
 * for the input 'alice'), or two people with the same name. `Person.email` is unique,
 * so the email tier can never be ambiguous.
 *
 * `resolvePerson` below is this with the ambiguity discarded, which is the right
 * trade for a live form: the pickers only offer real people, so a near-miss is worth
 * guessing at. A ONE-SHOT data migration is the opposite case — it cannot ask, its
 * guess is permanent, and a wrong owner is worse than no owner — so the backfill in
 * lib/ownerBackfill asks HERE and writes only when the answer is unique. One matcher,
 * two questions; a second, subtly-different matcher is what AGENTS lesson 7 forbids.
 */
export function resolvePersonCandidates<T extends PersonLike>(
  people: T[],
  handleOrEmail: string | null | undefined,
): T[] {
  if (!handleOrEmail) return [];
  const email = deriveEmail(handleOrEmail);
  const handle = normalizeHandle(handleOrEmail);
  if (!handle) return [];

  const byEmail = people.filter((p) => p.email?.toLowerCase() === email);
  if (byEmail.length > 0) return byEmail;

  const byLocalPart = people.filter((p) => p.email?.toLowerCase().split('@')[0] === handle);
  if (byLocalPart.length > 0) return byLocalPart;

  return people.filter((p) => p.name?.toLowerCase() === handle);
}

/**
 * Resolve a handle or email ('@jdoe', 'jdoe', 'jdoe@google.com') to a Person, or
 * null when there is no confident match. Order: exact email, then email local-part,
 * then exact (case-insensitive) full name. No substring matching by design.
 *
 * First candidate wins, which is what it has always done (`Array.find` over the same
 * three tiers) — see `resolvePersonCandidates` for when that is not good enough.
 */
export function resolvePerson<T extends PersonLike>(
  people: T[],
  handleOrEmail: string | null | undefined,
): T | null {
  return resolvePersonCandidates(people, handleOrEmail)[0] ?? null;
}

/**
 * The INVERSE of `resolvePerson`: every string that would resolve TO this person. Here,
 * beside it, because the two are one rule read in two directions and a second file would
 * let them drift (AGENTS lesson 7).
 *
 * `tests/personActivityScope.test.ts` pins ONE direction: every string this emits
 * resolves back to the same person. The reverse is NOT pinned and cannot be — add a
 * fourth tier to `resolvePersonCandidates` and leave this alone, and every existing alias
 * still round-trips while the new tier silently goes unqueried. Mirror by hand, here.
 *
 * It exists because the actor columns are FREE TEXT with no Person relation to join
 * through: `ProjectState.source`, `PhaseState.source` and `PartnerState.source` hold the
 * signed-in handle, `ContextUrl.addedBy` holds an address or a Drive display name (#176).
 * `resolvePerson` answers "whose row is this?" one row at a time, which a feed cannot
 * afford — it needs the set up front, for one OR of case-insensitive equals.
 *
 * The entries are `resolvePersonCandidates`' three tiers in order: full address, its
 * local part (twice — bare, and with the '@' the display form carries), then the full
 * name. Match them case-insensitively at the call site; the strings here are lowered.
 *
 * NOT a claim that every row it matches was written by this person, and not a claim that
 * every row they wrote is matched: an address they no longer hold matches nobody (#124
 * Class 4), and 'seed'/'API'-written rows name no human at all. Both are stated in the
 * UI copy rather than papered over.
 */
export function personAliases(person: PersonLike): string[] {
  const email = (person.email || '').trim().toLowerCase();
  // `normalizeHandle`, not a local `split('@')[0]`: this is the other end of the round
  // trip `resolvePersonCandidates` normalizes its INPUT with, and two spellings of one
  // rule is how the two directions start disagreeing.
  const local = normalizeHandle(person.email);
  const name = (person.name || '').trim().toLowerCase();
  const candidates = [email, local, local ? `@${local}` : '', name];
  return [...new Set(candidates.filter(Boolean))];
}
