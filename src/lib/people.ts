import { deriveEmail, normalizeAddress, normalizeHandle } from './auth';

// Two things about a person that several surfaces each used to answer for themselves:
// WHEN an affiliation applies (hasTakenEffect / coversDay — #124's half-open periods,
// compared at UTC-day granularity), and WHICH person a name or handle means
// (resolvePerson, below).
//
// Resolution came first. Previously this logic was copy-pasted in 4+ files, and each copy's email branch
// was dead (it compared a full email against an already-stripped handle), so every
// lookup fell through to a `name.includes(handle)` substring match — which linked
// handles like 'jo' to unrelated people such as 'Joanne'. Resolve on the ADDRESS
// instead, with exact (non-substring) fallbacks only.

export interface PersonLike {
  id: number;
  name: string;
  /** The CURRENT canonical address. NOT `@unique` since #127 E9 — uniqueness became a
   *  statement about instants and moved to the affiliation timeline. */
  email: string;
  /**
   * Every employment period's address (#127 E8) — the addresses this human has ALSO
   * held, so a mention written before they moved still finds them (#124 Class 4).
   * `email` is null on a period whose address was never recorded, and those are simply
   * skipped; an affiliation row that happens to repeat the current address is harmless.
   *
   * REQUIRED, not optional, and that is the whole enforcement (AGENTS lesson 2). A
   * directory built without it resolves current addresses only — i.e. it silently keeps
   * the defect this field exists to fix — and an optional field would let a new call
   * site do that while staying green. Everything that resolves a person now fetches
   * with `personDirectorySelect` below, and the compiler is what says so.
   */
  affiliations: { email: string | null }[];
}

/**
 * The Prisma `select` for any directory handed to `resolvePersonCandidates`. It lives
 * beside the matcher rather than at the ~9 call sites so the columns fetched and the
 * columns matched on cannot drift apart — the failure mode being silent (a person just
 * stops resolving), not loud.
 *
 * Plain data, no Prisma import, so this module stays importable by the client
 * components that call `resolvePerson` (ProgramsClient, PersonCell, ProjectMetaHeader).
 */
export const personDirectorySelect = {
  id: true,
  name: true,
  email: true,
  affiliations: { select: { email: true } },
} as const;

/** The UTC calendar day `d` falls in, as an instant at its own midnight. The one
 *  definition of "which day is this", shared by the two functions that need it. */
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

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
  return utcDay(new Date(effective)) <= utcDay(at);
}

/**
 * The first instant of the day AFTER `at`, in UTC — the exclusive upper bound of `at`'s
 * own calendar day.
 *
 * It exists so a SQL predicate can be day-granular WITHOUT truncating the column, which
 * is what `lib/profiles`' `asOfWhere` needs: `utcDay(x) <= utcDay(at)` is exactly
 * `x < startOfNextUtcDay(at)`, and the second spelling leaves the column bare on the left of the
 * comparison so the index still applies. Exported from HERE, beside `hasTakenEffect`,
 * because both are the same claim about where a calendar day ends and a second
 * definition next to the query would be the third spelling this module exists to
 * prevent (autoknow-yid).
 */
export function startOfNextUtcDay(at: Date): Date {
  return new Date(utcDay(at) + 24 * 60 * 60 * 1000);
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
 * Every production caller is the case this exists for — a surface that already HOLDS
 * the periods: `recordPersonChange` and `movePersonTo` (lib/profiles), which hold the
 * period just written, and `labelWithJobHeldThen` (lib/activity), which holds a whole
 * career and resolves 25 feed rows against it. The last is why re-querying is not an
 * option here:
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
 * An employment period as one readable label — "Bosch · Platform Engineer". The
 * spelling every held-then surface shares (the activity feed's row subtitles, the
 * Programs table's Affiliation sort key), kept beside `coversDay` because the surfaces
 * that resolve a period with one label it with the other — and a separator or
 * empty-role rule spelled per surface is one that drifts (AGENTS lesson 7).
 */
export function jobLabel(period: { role: string | null; partner: { name: string } }): string {
  return [period.partner.name, period.role].filter(Boolean).join(' · ');
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

/** The shape every "which addresses does this human answer to" question needs: the
 *  current address plus the periods'. Looser than `PersonLike` on purpose — `lib/search`
 *  composes index text from a row selected for that and nothing else. */
export interface AddressesOnFile {
  email: string;
  affiliations: { email: string | null }[];
}

/** Every address recorded against a person's employment periods, canonicalized, with
 *  unrecorded periods dropped. Order is not meaningful; only membership is. Periods
 *  repeating the current address are left in — both callers are indifferent: `matchTier`
 *  has already answered for that address before it looks here, and `personAliases`
 *  de-dupes. */
function recordedAddresses(person: AddressesOnFile): string[] {
  return person.affiliations.map((a) => normalizeAddress(a.email)).filter((a) => a !== '');
}

/**
 * EVERY address this human answers to — the current one first, then every address
 * recorded against a period they have held (#127 E8), canonical and de-duplicated.
 *
 * The one composer of that set. `personAliases` builds the feed's actor strings from it,
 * `lib/search` embeds and lexes it, and a third derivation would be a person who resolves
 * on one surface and not another — invisible, which is what AGENTS lesson 7 is about.
 * Order is meaningful only in that the current address leads: `matchTier` ranks by the
 * same "whoever holds it now" rule one level up.
 */
export function addressesOnFile(person: AddressesOnFile): string[] {
  return [...new Set([normalizeAddress(person.email), ...recordedAddresses(person)])]
    .filter((a) => a !== '');
}

/**
 * One tier, over every address each person has ever held, CURRENT HOLDERS FIRST.
 *
 * The split is not cosmetic — it is what keeps `resolvePerson` (first match wins)
 * deterministic now that a tier can match on more than one person's addresses. Before
 * #127 E8 the email tier could not be ambiguous at all, because `Person.email` was then
 * `@unique`; an address pool that includes former addresses removes that guarantee — and
 * E9's replacement does not restore it, because it forbids two people holding one
 * address at ONE MOMENT and a handover is not that — and
 * without an order the winner would be whatever order `findMany` happened to return.
 * "The person who holds this address TODAY" is the only defensible tie-break: an
 * address someone left in 2022 names them less strongly than it names whoever answers
 * it now.
 */
function matchTier<T extends PersonLike>(people: T[], matches: (address: string) => boolean): T[] {
  const holdsNow: T[] = [];
  const heldOnce: T[] = [];
  for (const person of people) {
    // `current`, not `now` — half this module is date logic (`at`, `hasTakenEffect`),
    // and a `now` here would read as a timestamp until you reached its use.
    const current = normalizeAddress(person.email);
    if (current !== '' && matches(current)) holdsNow.push(person);
    else if (recordedAddresses(person).some(matches)) heldOnce.push(person);
  }
  return [...holdsNow, ...heldOnce];
}

/**
 * EVERY person a handle or email could mean, taken from the FIRST tier that matches
 * anything: exact email, then email local-part, then exact (case-insensitive) full
 * name. Empty when nothing matches. No substring matching by design.
 *
 * THE FIRST TWO TIERS SEARCH HISTORICAL ADDRESSES (#127 E8, spec #124 §2). An address
 * belongs to a JOB, so the moment someone changes company every artifact that quotes
 * the old one — an action item's `assignedTo`, a Drive file's `addedBy`; a program's
 * `ownerName` until #127 E7 put that one behind an FK — stops naming a human at all.
 * That is #124 Class 4, and it is not a display bug: the row simply strands. Matching `PersonAffiliation.email` as well as
 * `Person.email` is the fix, and it is why the directory must be fetched with
 * `personDirectorySelect` and not a hand-written `{ id, name, email }`.
 *
 * RESOLUTION TAKES NO DATE, deliberately. What is temporal is a person's PROFILE —
 * which company, which title, which address — and `lib/profiles`' as-of resolvers own
 * that question. WHO the string names is not temporal: it is the same human before and
 * after the move, and the link this resolves to (`/people/:id`) is right on every day.
 * Passing a date here would only matter if one address named two different humans AT
 * ONE INSTANT, and #127 E9's exclusion constraint makes that unwritable. Two humans in
 * two SEPARATE periods — a handover — stays perfectly legal and stays ambiguous to this
 * function; it comes back as two candidates, current holder first, below. Nothing here
 * changed at E9: the constraint removed the case that a date would have to arbitrate,
 * not the case that needs ordering.
 *
 * More than one comes back only when a tier is genuinely AMBIGUOUS — two addresses
 * sharing a local part at different domains ('alice@google.com', 'alice@bosch.com'
 * for the input 'alice'), two people with the same name, or (new with E8) one address
 * held by two people at different times. Within a tier, whoever holds the address NOW
 * sorts ahead of whoever merely held it once; see `matchTier`.
 *
 * Every address on both sides of the comparison goes through `normalizeAddress`, which
 * is the one place the stored form is defined.
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

  const byEmail = matchTier(people, (address) => address === email);
  if (byEmail.length > 0) return byEmail;

  // `normalizeHandle`, not `split('@')[0]` (autoknow-hlx). This tier and `personAliases`
  // below are the two DIRECTIONS of one round trip — that function builds the local-part
  // alias, this one matches it — so a second spelling here would be a rule that can drift
  // on one side only, and the drift is silent: a person simply stops resolving.
  const byLocalPart = matchTier(people, (address) => normalizeHandle(address) === handle);
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
 * The entries are `resolvePersonCandidates`' three tiers in order, for EVERY address the
 * person has held (#127 E8): full address, its local part (twice — bare, and with the
 * '@' the display form carries), then the full name once. Match them case-insensitively
 * at the call site; the strings here are lowered.
 *
 * NOT a claim that every row it matches was written by this person, and not a claim that
 * every row they wrote is matched: a period whose address was never recorded contributes
 * nothing (there is nothing to contribute), and 'seed'/'API'-written rows name no human
 * at all. Both are stated in the UI copy rather than papered over. What is no longer a
 * gap: an address they have LEFT but which IS recorded on its period — that used to
 * match nobody, and was #124 Class 4 on the actor side.
 *
 * That widening WIDENS THE APPROXIMATION TOO, and it is worth being clear-eyed about:
 * the local-part entries are a guess in both directions, so a former address whose local
 * part is somebody else's current handle now pulls their rows in. The alternative —
 * emitting held addresses but not their local parts — would round-trip fine and leave
 * the inverse permanently narrower than the forward matcher, which is the asymmetry this
 * function exists to prevent. #127 E9's unique-at-an-instant constraint shrank the
 * collision space but did not close it — it forbids one address naming two people at one
 * MOMENT, and says nothing about a local part shared across two domains, which is where
 * most of this approximation lives. The honest answer is still that this is a filter,
 * not a proof.
 */
export function personAliases(person: PersonLike): string[] {
  const addresses = addressesOnFile(person);
  // Not `normalizeAddress`: a name is not an address, and that helper exists for the
  // one-column-in-two-places problem. Same two operations, different reason.
  const name = (person.name || '').trim().toLowerCase();
  const candidates = addresses.flatMap((address) => {
    // `normalizeHandle`, not a local `split('@')[0]`: this is the other end of the round
    // trip `resolvePersonCandidates` normalizes its INPUT with, and two spellings of one
    // rule is how the two directions start disagreeing.
    const local = normalizeHandle(address);
    return [address, local, local ? `@${local}` : ''];
  });
  return [...new Set([...candidates, name].filter(Boolean))];
}
