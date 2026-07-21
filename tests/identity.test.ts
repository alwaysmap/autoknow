/** @jest-environment node */
// lib/auth is the single source of truth for "who is the current user" (its own
// header says so), and every surface that names you — the nav, /me, program
// ownership, activity attribution — reads through it. It had no tests.
import { deriveEmail, normalizeHandle, stubUser, userFromHandle } from '../src/lib/auth';

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

    it('expands a bare handle to the org default domain', () => {
      expect(userFromHandle('alice').email).toBe('alice@google.com');
      expect(userFromHandle('@alice').email).toBe('alice@google.com');
    });
  });

  // `display` deliberately drops the domain, so it is NOT a round-trippable
  // identity: deriving an email back out of it re-applies the org default and
  // silently rewrites the address. /me used to do exactly that and resolved a
  // dylan@alwaysmap.com login to a dylan@google.com person — a DIFFERENT row.
  // Anything resolving the signed-in user must use `.email`, never `.display`.
  it('display is lossy — deriveEmail(display) is not the login address', () => {
    const me = userFromHandle('dylan@alwaysmap.com');
    expect(me.display).toBe('@dylan');
    expect(deriveEmail(me.display)).toBe('dylan@google.com');
    expect(deriveEmail(me.display)).not.toBe(me.email);
    // Whereas the email survives a round trip unchanged.
    expect(deriveEmail(me.email)).toBe(me.email);
  });

  it('normalizeHandle strips @ and domain', () => {
    expect(normalizeHandle('@Foo@bar.com')).toBe('foo');
    expect(normalizeHandle('  Bar  ')).toBe('bar');
    expect(normalizeHandle(null)).toBe('');
    expect(normalizeHandle(undefined)).toBe('');
  });

  it('stubUser is a complete identity — every field accounted for', () => {
    const stub = stubUser();
    expect(stub).toEqual({
      handle: 'dylan',
      display: '@dylan',
      email: 'dylan@google.com',
      name: 'Dylan',
      // Null, not absent: there is no identity provider behind the stub to supply a
      // photo, so the avatar falls back to initials (ADR 0006).
      image: null,
    });
  });
});
