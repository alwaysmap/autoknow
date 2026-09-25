/** @jest-environment node */
// Who gets past the login page. The tenant (AUTH_ALLOWED_DOMAIN) always may; an
// additional sign-in domain widens the gate without becoming the tenant. Domains are
// built here from placeholders, never the real tenant, so nothing in this file agrees
// with the code by sharing a literal (tests/tenantDomainNeverLiteral.test.ts).
import { parseDomainList, signInDomains, mayUseDomain } from '../src/lib/signInGate';

const TENANT = 'tenant.example';
const GUEST = 'guest.example';

describe('parseDomainList', () => {
  it('trims, lower-cases, drops empties and duplicates', () => {
    expect(parseDomainList(' Guest.Example, ,guest.example,other.example ')).toEqual([GUEST, 'other.example']);
  });

  it('is empty for an unset variable', () => {
    expect(parseDomainList(undefined)).toEqual([]);
  });
});

describe('signInDomains', () => {
  it('is the tenant alone when no additional domains are set', () => {
    expect(signInDomains(TENANT, undefined)).toEqual([TENANT]);
  });

  it('adds the additional domains to the tenant', () => {
    expect(
      signInDomains(TENANT, GUEST),
    ).toEqual([TENANT, GUEST]);
  });

  it('never lets an additional list become the whole gate of an unrestricted deployment', () => {
    // No tenant = no restriction; an extra list must not quietly lock out everyone else.
    expect(signInDomains(undefined, GUEST)).toEqual([]);
  });
});

describe('mayUseDomain', () => {
  const domains = [TENANT, GUEST];

  it('admits the tenant and an additional domain by their hosted-domain claim', () => {
    expect(mayUseDomain({ hd: TENANT, email: `a@${TENANT}` }, domains)).toBe(true);
    expect(mayUseDomain({ hd: GUEST, email: `b@${GUEST}` }, domains)).toBe(true);
  });

  it('refuses a Workspace domain on neither list', () => {
    expect(mayUseDomain({ hd: 'stranger.example', email: 'c@stranger.example' }, domains)).toBe(false);
  });

  it('refuses a consumer account (no hd) whose address is on neither list', () => {
    expect(mayUseDomain({ email: 'someone@gmail.com' }, domains)).toBe(false);
  });

  it('falls back to the email suffix only when there is no hd claim', () => {
    expect(mayUseDomain({ email: `d@${GUEST}` }, domains)).toBe(true);
  });

  it('lets hd decide: an allowed email suffix does not rescue a disallowed hd', () => {
    expect(mayUseDomain({ hd: 'stranger.example', email: `e@${TENANT}` }, domains)).toBe(false);
  });

  it('does not match a domain that merely ends with an allowed one', () => {
    expect(mayUseDomain({ email: `f@evil${GUEST}` }, domains)).toBe(false);
    expect(mayUseDomain({ email: `f@sub.${GUEST}` }, domains)).toBe(false);
  });

  it('compares case-insensitively', () => {
    expect(mayUseDomain({ hd: GUEST.toUpperCase() }, domains)).toBe(true);
  });

  it('admits anyone when the deployment is unrestricted', () => {
    expect(mayUseDomain({ email: 'someone@gmail.com' }, [])).toBe(true);
  });
});
