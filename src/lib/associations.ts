// Heuristic partner association by name.
//
// In the schema a Project has exactly one `partnerId` — there is no relational link
// from a project to the *other* partners involved (e.g. the suppliers on an OEM's
// program). Until the model gains a many-to-many project<->partner relation, the
// only available signal is matching a partner's name as a substring of free text
// (project name, phase notes, action items). This is intentionally a heuristic and
// can over- or under-match; it was previously duplicated in the project- and
// partner-detail pages, so it lives here once, clearly labeled.

export interface NamedPartner {
  id: number;
  name: string;
}

/** All partners whose name appears (case-insensitively) as a substring of `text`. */
export function findPartnersInText<T extends NamedPartner>(
  partners: T[],
  text: string | null | undefined,
): T[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  return partners.filter((p) => p.name && haystack.includes(p.name.toLowerCase()));
}

/** The first partner whose name appears in `text`, or null. */
export function findPartnerInText<T extends NamedPartner>(
  partners: T[],
  text: string | null | undefined,
): T | null {
  return findPartnersInText(partners, text)[0] || null;
}
