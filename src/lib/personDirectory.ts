import 'server-only';
import { prisma } from './db';
import { normalizeHandle } from './auth';
import { personDirectorySelect, resolvePerson, type PersonLike } from './people';

// Server half of `resolvePerson` (issue #153), for the two surfaces that store a person
// as a BARE STRING with no Person relation to join through:
//
//   • ContextUrl.addedBy  — lib/driveSync writes an email, a display name, or the
//     literal 'drive-share' when a file arrived by being shared with the service account.
//   • ProgramTemplate.createdBy — whoever saved the template.
//
// Neither can be a foreign key without a migration and a backfill (and 'drive-share' is
// not a person at all), so the join happens at read time: fetch only the Person rows the
// strings on this page could possibly match, then let the SHARED in-memory resolver
// decide. One resolver, one set of rules — the SQL below is deliberately a SUPERSET of
// what `resolvePerson` accepts, never a second, subtly different matcher:
//
//   resolvePerson tries exact email, then email local-part, then exact full name;
//   `email STARTS WITH '<handle>@'` covers the first two, `name = <raw>` the third.
//
// SINCE #127 E8 the first two tiers also search addresses a person HELD but has left
// (`PersonAffiliation.email`), so the narrowing WHERE has to reach those too — the same
// prefix, one relation over. Miss this arm and the superset stops being one: the row
// never comes back, so the in-memory resolver never gets the chance to match it and a
// pre-move Drive file silently keeps naming nobody.
//
// A page with no person strings issues no query at all.

/** Person rows that could match any of `keys`, for `resolvePerson` to narrow. */
export async function getPersonDirectory(
  keys: (string | null | undefined)[],
): Promise<PersonLike[]> {
  const wanted = [...new Set(keys.filter((k): k is string => !!k && !!k.trim()))];
  if (wanted.length === 0) return [];
  const handles = [...new Set(wanted.map(normalizeHandle).filter(Boolean))];
  return prisma.person.findMany({
    where: {
      OR: [
        ...handles.map((h) => ({ email: { startsWith: `${h}@`, mode: 'insensitive' as const } })),
        ...handles.map((h) => ({
          affiliations: {
            some: { email: { startsWith: `${h}@`, mode: 'insensitive' as const } },
          },
        })),
        ...wanted.map((w) => ({ name: { equals: w, mode: 'insensitive' as const } })),
      ],
    },
    select: personDirectorySelect,
  });
}

/**
 * `keys` → the person each one names, or null. The map is keyed by the ORIGINAL string,
 * so a caller hands the row's stored value straight back and gets the person or the
 * plain-text branch — no second normalization at the call site.
 */
export async function resolvePeople(
  keys: (string | null | undefined)[],
): Promise<Record<string, { id: number; name: string }>> {
  const directory = await getPersonDirectory(keys);
  const out: Record<string, { id: number; name: string }> = {};
  for (const key of keys) {
    if (!key || out[key]) continue;
    const match = resolvePerson(directory, key);
    if (match) out[key] = { id: match.id, name: match.name };
  }
  return out;
}
