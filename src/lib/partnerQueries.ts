import { prisma } from './db';
import { rostersByPartnerAsOf, type RosterMember } from './profiles';
import type { PersonRef } from '../components/PersonCell';

// Partner list data for /partners. Plain module functions on the shared prisma
// singleton (the rest of the codebase's convention) — not a constructor-injected
// class, which was the lone outlier here.

export interface ProjectSummary {
  id: number;
  name: string;
  isArchived: boolean;
  /** The Googler who owns this program, through `Project.ownerPersonId` (#127 E7).
   *  This was the stored `ownerName` string, which the client then re-matched against
   *  the people directory — so an owner who had changed address stopped counting as the
   *  owner of their own program (#124 Class 4). The FK is resolved once, here. */
  owner: PersonRef | null;
}

export interface PartnerListRow {
  id: number;
  name: string;
  type: string;
  region: string;
  projects: ProjectSummary[];
  /** Who is at this partner TODAY — the as-of roster (#127 E5), the same answer
   *  /partners/:id lists. */
  team: RosterMember[];
}

/**
 * All partners with their projects and today's roster.
 *
 * The roster replaces a UNION of two wrong sets: `currentEmployees` (the
 * `currentPartnerId` back-relation, so the cache) and `personAffiliations` (every
 * affiliation the partner had EVER had). Adding a stale set to an unfiltered one is not
 * a hedge, it is both errors at once — the team cell listed leavers permanently.
 *
 * This file survived the first two sweeps of #127 E5 because a back-relation has its own
 * name and no grep for "currentPartner" ever returned it — which is the transferable
 * part, and is why it has a note:
 * docs/knowledge/a-prisma-back-relation-hides-the-field-you-are-grepping-for.md
 */
export async function getAllPartners(): Promise<PartnerListRow[]> {
  const [rows, rosters] = await Promise.all([
    prisma.partner.findMany({
      include: {
        type: { select: { name: true } },
        region: { select: { name: true } },
        projects: {
          select: {
            id: true, name: true, isArchived: true,
            ownerPerson: { select: { id: true, name: true } }, // by REFERENCE (#127 E7)
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    // One query for every partner's roster, not one per row.
    rostersByPartnerAsOf(),
  ]);
  // Map to the UI contract — an explicit projection, not an `as unknown`.
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type?.name ?? '',
    region: r.region?.name ?? '',
    projects: r.projects.map((p) => ({
      id: p.id,
      name: p.name,
      isArchived: p.isArchived,
      owner: p.ownerPerson,
    })),
    team: rosters.get(r.id) ?? [],
  }));
}

/** Count of non-archived projects (active programs) for a partner. */
export function getActivePrograms(partner: { projects: { isArchived: boolean }[] }): number {
  return partner.projects.filter((p) => !p.isArchived).length;
}

/** Count of total projects (lifetime programs) for a partner. */
export function getLifetimePrograms(partner: { projects: unknown[] }): number {
  return partner.projects.length;
}
