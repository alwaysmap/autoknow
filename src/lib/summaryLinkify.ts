// Turn a real system NOUN in briefing prose into a link to its endpoint (#77). The
// model never writes the URL — a URL is DATA and the id is authoritative, so an LLM
// asked to emit `/people/5` will confidently emit `/people/7` (AGENTS lessons 3, 15).
// Instead the caller hands us the canonical entities in scope (people, partners,
// programs, phases — each with its href resolved server-side via entityHref.ts) and we
// wrap the mentions here. Pure and client-safe so it unit-tests without a DB and the
// renderer can share the Segment type.

export interface EntityLink {
  name: string; // canonical display name to find in the prose
  href: string; // its in-app route (from entityHref.ts)
  external: boolean; // in-app entity pages are always false; kept for the renderer's <a>
}

// A bullet's text, split into plain runs and linked runs. A run with `href` is a link;
// without one it is plain text. Absent segments ⇒ render the plain `text` (old briefs
// stored before this feature carry no segments — same append-only back-compat as the
// legacy-citation rewrite).
export interface Segment {
  text: string;
  href?: string;
  external?: boolean;
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
// A match is a whole-word hit only when both edges abut a non-letter/digit (or the
// string end). `\b` is not used: entity names carry parens and spaces ("Ford Explorer
// VHAL Integration (Bosch)"), and \b misbehaves at those edges and around Unicode.
const isBoundary = (ch: string | undefined): boolean => !isWordChar(ch);

/**
 * Wrap the FIRST mention of each entity in `text` as a link segment. Longest name
 * first (so "Ford Evos AAOS Bring-up" wins over "Ford"), whole-word, first-mention-only
 * per call, non-overlapping. Returns a single plain segment when nothing matches.
 *
 * Two safety rules, both erring toward NO link over a wrong one:
 *  - a name that resolves to two different hrefs is AMBIGUOUS and dropped (two people
 *    share a name) — better an unlinked noun than a link to the wrong person;
 *  - names shorter than two characters are ignored (an initial is not a target).
 */
export function linkify(text: string, links: EntityLink[]): Segment[] {
  if (!text) return [];

  const byName = new Map<string, EntityLink | null>(); // null marks an ambiguous name
  for (const l of links) {
    const key = l.name.trim().toLowerCase();
    if (key.length < 2) continue;
    if (!byName.has(key)) byName.set(key, l);
    else {
      const prev = byName.get(key);
      if (prev && prev.href !== l.href) byName.set(key, null);
    }
  }
  const candidates = [...byName.values()]
    .filter((l): l is EntityLink => l != null)
    .sort((a, b) => b.name.length - a.name.length);

  const lower = text.toLowerCase();
  const claimed: { start: number; end: number; link: EntityLink }[] = [];
  const overlaps = (s: number, e: number) => claimed.some((c) => s < c.end && e > c.start);

  for (const link of candidates) {
    const needle = link.name.toLowerCase();
    for (let from = 0; from <= lower.length; ) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      if (isBoundary(text[idx - 1]) && isBoundary(text[end]) && !overlaps(idx, end)) {
        claimed.push({ start: idx, end, link }); // first mention only — stop scanning this name
        break;
      }
      from = idx + 1;
    }
  }

  if (claimed.length === 0) return [{ text }];
  claimed.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const c of claimed) {
    if (c.start > cursor) segments.push({ text: text.slice(cursor, c.start) });
    segments.push({ text: text.slice(c.start, c.end), href: c.link.href, external: c.link.external });
    cursor = c.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
