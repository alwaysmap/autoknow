import {
  canonicalizeUrl,
  inferSource,
  isForbiddenHost,
  looksLikeAuthWall,
  normalizeText,
  htmlToText,
} from '../src/lib/sources';

// Source inference + fetch-safety (docs/INGEST_FRESHNESS_PLAN.md §2, §4): mode is a
// fact about the medium; canonical URLs keep dedupe and hashing stable; the guards
// keep the server from fetching itself or digesting login pages.

describe('canonicalizeUrl', () => {
  test('strips tracking params, fragments, and trailing slashes; sorts the rest', () => {
    expect(
      canonicalizeUrl('https://Example.com/a/b/?utm_source=x&b=2&a=1#frag'),
    ).toBe('https://example.com/a/b?a=1&b=2');
  });

  test('rejects non-http(s) and junk', () => {
    expect(canonicalizeUrl('ftp://x/y')).toBeNull();
    expect(canonicalizeUrl('not a url')).toBeNull();
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('inferSource', () => {
  test('Drive docs are watched with a fileId ref', () => {
    const s = inferSource('https://docs.google.com/document/d/abc123XYZ_-abc123XYZ/edit?usp=sharing');
    expect(s).toEqual({ kind: 'drive', mode: 'watched', sourceRef: 'drive:abc123XYZ_-abc123XYZ' });
  });

  test('chat messages are snapshots keyed by thread URL', () => {
    const s = inferSource('https://chat.google.com/room/AAAA/thread/msg1');
    expect(s.kind).toBe('chat');
    expect(s.mode).toBe('snapshot');
    expect(s.sourceRef).toContain('chat.google.com');
  });

  test('trackers are watched (freeze is emergent from status, not a class)', () => {
    expect(inferSource('https://github.com/org/repo/issues/42').kind).toBe('tracker');
    expect(inferSource('https://github.com/org/repo/pull/7').mode).toBe('watched');
    expect(inferSource('https://android-review.googlesource.com/c/platform/+/123').kind).toBe('tracker');
    expect(inferSource('https://issuetracker.google.com/issues/999').kind).toBe('tracker');
  });

  test('generic web is watched; raw text is a snapshot with no ref', () => {
    expect(inferSource('https://example.com/press-release').mode).toBe('watched');
    expect(inferSource(null)).toEqual({ kind: 'text', mode: 'snapshot', sourceRef: null });
  });
});

describe('isForbiddenHost (SSRF guard)', () => {
  test('blocks loopback, RFC-1918, link-local/metadata, and local names', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', 'foo.local', 'db.internal', '::1']) {
      expect(isForbiddenHost(h)).toBe(true);
    }
  });

  test('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', '172.15.0.1', 'docs.google.com']) {
      expect(isForbiddenHost(h)).toBe(false);
    }
  });
});

describe('looksLikeAuthWall', () => {
  test('flags short sign-in pages and SSO hosts', () => {
    expect(looksLikeAuthWall('https://accounts.google.com/signin', 'anything')).toBe(true);
    expect(
      looksLikeAuthWall('https://x.com/doc', 'Sign in to continue. Enter your password. type="password"'),
    ).toBe(true);
  });

  test('does not flag real articles that merely mention login', () => {
    const article = `${'Automotive cockpit software analysis. '.repeat(200)} Users must sign in to the vehicle app.`;
    expect(looksLikeAuthWall('https://news.example.com/article', article)).toBe(false);
  });
});

describe('text normalization', () => {
  test('normalizeText collapses noise so cosmetic edits do not read as change', () => {
    expect(normalizeText('a  b\t c\r\n\r\n\r\n\r\nd')).toBe('a b c\n\nd');
  });

  test('htmlToText strips scripts/tags and decodes entities', () => {
    const html = '<html><script>evil()</script><body><h1>Title</h1><p>A &amp; B</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Title');
    expect(text).toContain('A & B');
    expect(text).not.toContain('evil');
  });
});
