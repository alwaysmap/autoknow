import { prisma } from './db';

// Partner list data for /partners. Plain module functions on the shared prisma
// singleton (the rest of the codebase's convention) — not a constructor-injected
// class, which was the lone outlier here.

export interface ProjectSummary {
  id: number;
  name: string;
  isArchived: boolean;
  ownerName: string | null;
}

export interface EmployeeSummary {
  id: number;
  name: string;
  email: string;
}

export interface AffiliationSummary {
  person: {
    id: number;
    name: string;
    email: string;
  };
}

export interface PartnerWithRelations {
  id: number;
  name: string;
  type: string;
  region: string;
  projects: ProjectSummary[];
  currentEmployees: EmployeeSummary[];
  personAffiliations: AffiliationSummary[];
}

/** All partners with projects, current employees, and affiliations. */
export async function getAllPartners(): Promise<PartnerWithRelations[]> {
  const rows = await prisma.partner.findMany({
    include: {
      type: { select: { name: true } },
      region: { select: { name: true } },
      projects: { select: { id: true, name: true, isArchived: true, ownerName: true } },
      currentEmployees: { select: { id: true, name: true, email: true } },
      personAffiliations: {
        select: { person: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });
  // Map to the string-typed UI contract — an explicit projection, not an `as unknown`.
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type?.name ?? '',
    region: r.region?.name ?? '',
    projects: r.projects,
    currentEmployees: r.currentEmployees,
    personAffiliations: r.personAffiliations,
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
