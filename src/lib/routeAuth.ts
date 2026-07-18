import 'server-only';
import { auth, authConfigured } from '../auth';
import { secretsEqual } from './api';

// Fail-closed authorization for API route handlers. The proxy session gate is the
// OUTER layer; this is the per-route INNER layer, so a perimeter misconfiguration
// (e.g. AUTH_GOOGLE_* unset on a publicly-funneled deployment) cannot leave the
// mutation routes world-writable. Grants:
//   - a signed-in session (when auth is configured);
//   - a valid x-admin-token header (curl / admin tooling / integrations);
//   - everything outside production while auth is unconfigured (CI, tests, fresh
//     checkout — mirrors lib/session's stub identity so the E2E suite still runs).
/** A token counts only when ADMIN_TOKEN is actually configured — never a dev
 *  fallback: a session-less request with a bogus header must not slip through. */
function validAdminToken(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  return !!token && secretsEqual(req.headers.get('x-admin-token'), token);
}

export async function requireRouteAuth(req: Request): Promise<boolean> {
  if (authConfigured) {
    const session = await auth().catch(() => null);
    if (session?.user?.email) return true;
    return validAdminToken(req);
  }
  if (process.env.NODE_ENV !== 'production') return true;
  // Auth off IN PRODUCTION is the misconfiguration this guard exists for: deny
  // unless the caller can present a valid admin token.
  return validAdminToken(req);
}
