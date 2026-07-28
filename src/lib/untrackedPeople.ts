import { normalizeAddress } from './auth';
import type { Segment as LinkSegment } from './summaryLinkify';

// The INVERSE of `linkify` (#126 / #127 E15): that pass wraps mentions of entities we
// KNOW; this one finds mentions of humans we do NOT, so a reader can track them in
// place instead of leaving the page and retyping what they were just reading.
//
// Pure and client-safe, exactly like its sibling and for the same reasons: it unit-tests
// without a database, and it EXTENDS `linkify`'s Segment so one renderer handles both
// passes. The knowing happens
// OUTSIDE — the caller passes the addresses that are already tracked and the ones that
// have been dismissed — because "is this a person we have" is a database question and
// this file must not become one.
//
// DETECTION IS ADDRESSES AND @HANDLES ONLY, decided 2026-07-24 (#126 decision 1) and
// worth restating because the omission looks like a gap: bare names are NOT matched.
// This domain is full of capitalised multi-word nouns — Ford Explorer, Digital Key,
// Rich Media, Launch Readiness — that a capitalised-bigram matcher cannot tell from
// Dieter Meyer. An affordance people learn to ignore is worse than none.

/**
 * A run of prose, EXTENDING `linkify`'s segment rather than redeclaring it — the two
 * passes run over the same text and a renderer handles one shape, so a second
 * declaration would be two spellings of one thing that must agree (AGENTS lesson 7).
 */
export interface Segment extends LinkSegment {
  /** The canonical address of an untracked mention — the affordance's subject. Set
   *  ONLY on segments this module claims; `linkify` cannot produce one, which the
   *  `extends` above makes true by construction rather than by convention. */
  untracked?: string;
}

/**
 * An address in prose. Deliberately stricter than RFC 5322 and deliberately not a
 * "clever" pattern: it must not claim a trailing sentence period, a markdown bracket,
 * or the `)` of a parenthetical. The local part allows the punctuation real corporate
 * addresses use (`alice.waters`, `a_w+auto`), and the domain must end in a letter,
 * which is what stops `alice@bosch.com.` from swallowing the full stop.
 */
const ADDRESS = /[\p{L}\p{N}][\p{L}\p{N}._%+-]*@[\p{L}\p{N}][\p{L}\p{N}.-]*\.[\p{L}]{2,}/gu;

/**
 * A bare `@handle` — how this org writes a colleague in a note. Requires a leading
 * boundary so an ADDRESS's own `@` cannot re-match as a handle, and rejects a trailing
 * `.` for the same reason as above. Two characters minimum: an initial is not a person
 * (`linkify`'s rule, and the same reasoning).
 */
const HANDLE = /(^|[^\p{L}\p{N}._%+-@])@([\p{L}\p{N}][\p{L}\p{N}._-]{1,})/gu;

/** What a caller must tell this module — the two things it cannot know itself. */
export interface UntrackedContext {
  /**
   * Every address that already names a Person, INCLUDING addresses they have left
   * (#127 E8's `PersonAffiliation.email`). Historical addresses are the whole safety
   * argument: a mention of `alice@bosch.com` for a tracked Alice who has since moved
   * must NOT offer to create a second Alice — that is `copyPerson`'s damage with a
   * friendly button, at ingestion scale (#126, "Hard dependency on #124"). The caller
   * builds this with `personDirectorySelect` so it cannot fetch a narrower set.
   */
  tracked: Set<string>;
  /** Addresses a human has marked "not a person" — lists, bots, `noreply@` (#126
   *  decision 2). Suppressed everywhere, permanently, on one click. */
  dismissed: Set<string>;
  /** The org's default domain, for turning a bare `@handle` into an address. Handed in
   *  rather than imported so this module stays free of env-derived config. */
  defaultDomain: string;
}

/** Where a match sits in the text, and the address it means. */
interface Claim {
  start: number;
  end: number;
  address: string;
}

/**
 * Find the mentions of humans nobody has tracked, and split `text` around them.
 *
 * FIRST MENTION ONLY, per address and per call — forty mentions of one address in a
 * digest is one affordance, not forty (#126) — and non-overlapping, so a `@handle`
 * inside an address never double-claims. `existing` lets a caller run this AFTER
 * `linkify` and keep both results: a run already claimed as a link is left alone,
 * which is what makes this a second PASS rather than a second DETECTOR. The briefing
 * path (SummaryPanel) composes them exactly that way; the Markdown path has no links to
 * preserve and passes raw text.
 *
 * Returns the input as a single plain segment when nothing matches, exactly like
 * `linkify`, so a renderer handles one shape.
 */
export function annotateUntracked(
  text: string,
  ctx: UntrackedContext,
  existing?: Segment[],
): Segment[] {
  // `existing` WINS when present, and `text` is then ignored — a caller running after
  // `linkify` already holds the split prose and has no reason to re-supply it, so it
  // passes `''`. Guarding on `text` alone would drop those segments on the floor.
  const plain = existing && existing.length > 0 ? existing : text ? [{ text }] : [];
  if (plain.length === 0) return [];

  // Only PLAIN runs are scanned. A run `linkify` already claimed names a known entity,
  // and offering to "track" a person the prose already links to is the contradiction
  // this check exists to prevent.
  return plain.flatMap((segment) =>
    segment.href ? [segment] : splitOne(segment.text, ctx),
  );
}

function splitOne(text: string, ctx: UntrackedContext): Segment[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();
  const overlaps = (s: number, e: number) => claims.some((c) => s < c.end && e > c.start);

  const claim = (start: number, end: number, address: string) => {
    const canonical = normalizeAddress(address);
    if (!canonical) return;
    // The three reasons NOT to offer: we already have them (under any address they have
    // ever held), a human said this is not a person, or this address is already claimed
    // earlier in the same text.
    if (ctx.tracked.has(canonical) || ctx.dismissed.has(canonical)) return;
    if (seen.has(canonical) || overlaps(start, end)) return;
    seen.add(canonical);
    claims.push({ start, end, address: canonical });
  };

  for (const m of text.matchAll(ADDRESS)) {
    if (m.index === undefined) continue;
    claim(m.index, m.index + m[0].length, m[0]);
  }
  for (const m of text.matchAll(HANDLE)) {
    if (m.index === undefined) continue;
    // Group 1 is the boundary character the pattern had to consume; the handle itself
    // starts after it.
    const start = m.index + m[1].length;
    claim(start, start + m[2].length + 1, `${m[2]}@${ctx.defaultDomain}`);
  }

  if (claims.length === 0) return [{ text }];
  claims.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const c of claims) {
    if (c.start > cursor) segments.push({ text: text.slice(cursor, c.start) });
    segments.push({ text: text.slice(c.start, c.end), untracked: c.address });
    cursor = c.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/**
 * The company a new Person should default to, inferred from the address domain
 * (#126 decision 3) — `bosch.com` → the partner whose name matches. A GUESS, stated as
 * a prefill the user can change, never a silent write: the dialog shows it selected and
 * the human confirms by saving.
 *
 * Matched on the domain's first label against the partner's name with non-letters
 * stripped, both case-folded — `volvocars.example` → "Volvo Cars". Deliberately not a
 * fuzzy score: a wrong company confidently pre-selected is worse than an empty picker,
 * so anything short of an exact fold is no answer at all.
 */
export function inferPartnerFromAddress(
  address: string,
  partners: { id: number; name: string }[],
): number | null {
  const domain = normalizeAddress(address).split('@')[1] ?? '';
  const label = domain.split('.')[0];
  if (!label) return null;
  const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const key = fold(label);
  if (!key) return null;
  const hits = partners.filter((p) => fold(p.name) === key);
  // Exactly one, or none: two partners folding to one key is ambiguous, and `linkify`'s
  // rule applies — better no answer than the wrong one.
  return hits.length === 1 ? hits[0].id : null;
}
