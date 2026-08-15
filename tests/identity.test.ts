/** @jest-environment node */
// lib/auth is the single source of truth for "who is the current user" (its own
// header says so), and every surface that names you — the nav, /me, program
// ownership, activity attribution — reads through it. It had no tests.
import {
  DEFAULT_EMAIL_DOMAIN,
  deriveEmail,
  normalizeHandle,
  orgEmailDomain,
  stubUser,
  userFromHandle,
} from '../src/lib/auth';

// The org domain is CONFIGURATION (`AUTH_ALLOWED_DOMAIN`), so every assertion about it
// sets it here rather than inheriting whatever this checkout's .env holds. It used to be
// a literal in the module and a literal in these tests, which is the shape where both
// sides agree and neither is checked (gh-255).
const withDomain = <T,>(domain: string | undefined, run: () => T): T => {
  const before = process.env.AUTH_ALLOWED_DOMAIN;
  if (domain === undefined) delete process.env.AUTH_ALLOWED_DOMAIN;
  else process.env.AUTH_ALLOWED_DOMAIN = domain;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.AUTH_ALLOWED_DOMAIN;
    else process.env.AUTH_ALLOWED_DOMAIN = before;
  }
};

describe('identity helpers', () => {
  describe('userFromHandle', () => {
    // THE property the /me bug turned on. A real Workspace login is whatever the
    // provider returns; the app's org default domain must never be forced onto it.
    it('preserves a real login address verbatim, domain included', () => {
      const me = userFromHandle('dylan@alwaysmap.com');
      expect(me.email).toBe('dylan@alwaysmap.com');
      expect(me.handle).toBe('dylan');
    });

    it('is case- and whitespace-insensitive', () => {
      expect(userFromHandle('  Dylan@AlwaysMap.com ').email).toBe('dylan@alwaysmap.com');
    });

    it('takes the provider display name when there is one', () => {
      expect(userFromHandle('dylan@alwaysmap.com', 'Dylan Thomas').name).toBe('Dylan Thomas');
    });

    it('falls back to a name built from the handle when the provider gives none', () => {
      expect(userFromHandle('dylan@alwaysmap.com').name).toBe('Dylan');
      expect(userFromHandle('dylan@alwaysmap.com', '   ').name).toBe('Dylan');
      expect(userFromHandle('dylan.thomas@alwaysmap.com').name).toBe('Dylan Thomas');
      expect(userFromHandle('jo-anne_smith@x.com').name).toBe('Jo Anne Smith');
    });

    it("expands a bare handle to the DEPLOYMENT's own domain", () => {
      withDomain('alwaysmap.com', () => {
        expect(userFromHandle('alice').email).toBe('alice@alwaysmap.com');
        expect(userFromHandle('@alice').email).toBe('alice@alwaysmap.com');
      });
    });

    it('falls back to the dev domain only when nothing has told us the tenant', () => {
      withDomain(undefined, () => {
        expect(orgEmailDomain()).toBe(DEFAULT_EMAIL_DOMAIN);
        expect(userFromHandle('alice').email).toBe(`alice@${DEFAULT_EMAIL_DOMAIN}`);
      });
      // An empty string is "configured to nothing", which is the unconfigured case —
      // Terraform passes the variable through whether or not it has a value.
      withDomain('', () => expect(orgEmailDomain()).toBe(DEFAULT_EMAIL_DOMAIN));
      withDomain('  alwaysmap.com  ', () => expect(orgEmailDomain()).toBe('alwaysmap.com'));
    });
  });

  // `display` deliberately drops the domain, so it is NOT a round-trippable
  // identity: deriving an email back out of it re-applies the org default and
  // silently rewrites the address. /me used to do exactly that and resolved a
  // dylan@alwaysmap.com login to a dylan@<other domain> person — a DIFFERENT row.
  // Anything resolving the signed-in user must use `.email`, never `.display`.
  it('display is lossy — deriveEmail(display) is not the login address', () => {
    // Shown against a domain that is NOT the org's, because the loss is the point: the
    // handle expands at whatever domain we are configured for, which for a guest or a
    // legacy address is not the one they actually log in with. Fixing the tenant literal
    // (gh-255) narrows this hazard; it does not remove it.
    const me = userFromHandle('dylan@contractor.example');
    expect(me.display).toBe('@dylan');
    withDomain('alwaysmap.com', () => {
      expect(deriveEmail(me.display)).toBe('dylan@alwaysmap.com');
      expect(deriveEmail(me.display)).not.toBe(me.email);
      // Whereas the email survives a round trip unchanged.
      expect(deriveEmail(me.email)).toBe(me.email);
    });
  });

  it('normalizeHandle strips @ and domain', () => {
    expect(normalizeHandle('@Foo@bar.com')).toBe('foo');
    expect(normalizeHandle('  Bar  ')).toBe('bar');
    expect(normalizeHandle(null)).toBe('');
    expect(normalizeHandle(undefined)).toBe('');
  });

  it('stubUser is a complete identity — every field accounted for', () => {
    // The stub is the UNCONFIGURED identity, so it is asserted with no domain set: a
    // deployment that has an AUTH_ALLOWED_DOMAIN also has real sign-in and never reaches
    // here. Pinned explicitly so this does not become a test of the developer's .env.
    const stub = withDomain(undefined, stubUser);
    expect(stub).toEqual({
      handle: 'dylan',
      display: '@dylan',
      email: `dylan@${DEFAULT_EMAIL_DOMAIN}`,
      name: 'Dylan',
      // Null, not absent: there is no identity provider behind the stub to supply a
      // photo, so the avatar falls back to initials (ADR proxy-third-party-images-keep-csp-self).
      image: null,
    });
  });
});
