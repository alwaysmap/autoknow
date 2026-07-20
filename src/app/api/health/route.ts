import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// Public liveness/readiness probe — uptime checkers and deploy smoke tests can't
// sign in, so this route is exempt from the session gate (src/proxy.ts) and must
// never include secrets. `sha` identifies the running build (GIT_SHA is baked in
// by CI as a Docker build arg; 'dev' locally); `db` proves Postgres is reachable.
export const dynamic = 'force-dynamic';

export async function GET() {
  let db = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  const ok = db === 'ok';
  return NextResponse.json(
    { ok, sha: process.env.GIT_SHA || 'dev', db },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
