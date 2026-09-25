// Who may sign in. Two inputs, deliberately separate:
//
//  - `AUTH_ALLOWED_DOMAIN` is the TENANT: the Workspace this deployment serves. It is
//    also what a bare `@handle` expands to, what names the Workspace groups, and what
//    the Chat sender check compares against (lib/auth `orgEmailDomain`). There is one.
//  - `AUTH_ADDITIONAL_SIGNIN_DOMAINS` (comma-separated) lets people from OTHER Google
//    Workspace domains sign in and read, without becoming the tenant. Adding a domain
//    here changes who gets past the login page and nothing else.
//
// Folding the second into the first would have rewritten every derived address to the
// wrong domain (gh-255 is the precedent), which is why this is its own variable.

/** Lower-cased, trimmed, de-duplicated; empty entries dropped. */
export function parseDomainList(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean))];
}

/** Every domain allowed to sign in, from the environment. Empty = no restriction. */
export function signInDomains(
  tenantRaw: string | undefined = process.env.AUTH_ALLOWED_DOMAIN,
  extraRaw: string | undefined = process.env.AUTH_ADDITIONAL_SIGNIN_DOMAINS,
): string[] {
  const tenant = tenantRaw?.trim().toLowerCase();
  const extra = parseDomainList(extraRaw);
  // No tenant means an unrestricted deployment (local dev with a gmail login). An
  // additional list alone must not silently become the whole gate, so it only ever
  // WIDENS a restricted deployment.
  if (!tenant) return [];
  return [...new Set([tenant, ...extra])];
}

/**
 * The sign-in decision for a Google profile. The Workspace hosted-domain (`hd`) claim is
 * the reliable signal; the email suffix is the fallback. `hd` wins when present, so a
 * profile claiming one domain in `hd` cannot pass on another domain's email suffix.
 */
export function mayUseDomain(
  profile: { hd?: unknown; email?: unknown } | undefined,
  domains: string[],
): boolean {
  if (domains.length === 0) return true;
  const hd = typeof profile?.hd === 'string' ? profile.hd.toLowerCase() : '';
  if (hd) return domains.includes(hd);
  const email = typeof profile?.email === 'string' ? profile.email.toLowerCase() : '';
  const at = email.lastIndexOf('@');
  return at > 0 && domains.includes(email.slice(at + 1));
}
