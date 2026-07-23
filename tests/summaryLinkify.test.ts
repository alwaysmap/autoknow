/** @jest-environment node */
// #77: briefing prose links real nouns to their endpoints. The linkifier is pure — the
// model contributes a NAME, never a URL; the href always comes from the caller's
// registry (AGENTS lessons 3, 15). These tests pin the matching rules that keep a
// wrong or hallucinated link from ever appearing.
import { linkify, type EntityLink } from '../src/lib/summaryLinkify';

const links: EntityLink[] = [
  { name: 'Sarah Jenkins', href: '/people/5', external: false },
  { name: 'Qualcomm', href: '/partners/9', external: false },
  { name: 'Qualcomm Snapdragon Cockpit Support', href: '/programs/4', external: false },
  { name: 'Audio', href: '/programs/4#phase-16-detail', external: false },
];

// The linked runs of a linkify result, as [text, href] pairs.
const linkedPairs = (segs: ReturnType<typeof linkify>) =>
  segs.filter((s) => s.href).map((s) => [s.text, s.href] as const);

describe('linkify', () => {
  it('wraps a person and a partner in their endpoint links, preserving the rest as text', () => {
    const segs = linkify('Sarah Jenkins at Qualcomm owns the fix.', links);
    expect(linkedPairs(segs)).toEqual([
      ['Sarah Jenkins', '/people/5'],
      ['Qualcomm', '/partners/9'],
    ]);
    // The plain text between/around the links is preserved verbatim.
    expect(segs.map((s) => s.text).join('')).toBe('Sarah Jenkins at Qualcomm owns the fix.');
  });

  it('prefers the LONGEST name so the program wins over the partner substring', () => {
    const segs = linkify('The Qualcomm Snapdragon Cockpit Support program slipped.', links);
    expect(linkedPairs(segs)).toEqual([['Qualcomm Snapdragon Cockpit Support', '/programs/4']]);
    // "Qualcomm" inside the program name is NOT separately linked.
    expect(linkedPairs(segs).some(([, href]) => href === '/partners/9')).toBe(false);
  });

  it('links only the FIRST mention of an entity per line', () => {
    const segs = linkify('Qualcomm asked Qualcomm to escalate.', links);
    expect(linkedPairs(segs)).toEqual([['Qualcomm', '/partners/9']]);
  });

  it('matches whole words only — a substring inside another word is left alone', () => {
    // "audiophile" contains "audio" but must not link to the Audio phase.
    const segs = linkify('The audiophile review is irrelevant here.', links);
    expect(linkedPairs(segs)).toEqual([]);
  });

  it('preserves the original casing of the matched text', () => {
    const segs = linkify('qualcomm shipped the driver.', links);
    expect(linkedPairs(segs)).toEqual([['qualcomm', '/partners/9']]);
  });

  it('drops an AMBIGUOUS name that resolves to two different hrefs (no wrong link)', () => {
    const ambiguous: EntityLink[] = [
      { name: 'Chris Lee', href: '/people/1', external: false },
      { name: 'Chris Lee', href: '/people/2', external: false },
    ];
    const segs = linkify('Chris Lee will drive it.', ambiguous);
    expect(linkedPairs(segs)).toEqual([]);
    expect(segs).toEqual([{ text: 'Chris Lee will drive it.' }]);
  });

  it('returns a single plain segment when nothing matches', () => {
    expect(linkify('Nothing to see here.', links)).toEqual([{ text: 'Nothing to see here.' }]);
  });

  it('is a no-op on empty text', () => {
    expect(linkify('', links)).toEqual([]);
  });
});
