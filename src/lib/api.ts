import { NextResponse } from 'next/server';

// Shared helpers for route handlers. Previously every catch block returned
// `error.message` to the client, which leaks DB/internal details; and each used
// `catch (error: any)`. Funnel errors through here so the client gets a generic
// message while the real error is logged server-side.

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function serverError(err: unknown, context: string) {
  console.error(`${context}:`, err);
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}

/**
 * Whether destructive admin/dev operations (seed, wipe) are permitted here.
 * If ADMIN_TOKEN is set, callers must present it via the `x-admin-token` header.
 * If it is not set, the operations are allowed only outside production so that a
 * deployed instance can never be wiped by an unauthenticated request.
 */
export function adminOperationsAllowed(req?: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (token) return req?.headers.get('x-admin-token') === token;
  return process.env.NODE_ENV !== 'production';
}
