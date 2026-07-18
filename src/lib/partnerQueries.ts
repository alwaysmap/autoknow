import { PrismaClient } from '@prisma/client';

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
  projects: ProjectSummary[];
  currentEmployees: EmployeeSummary[];
  personAffiliations: AffiliationSummary[];
}

export class PartnerQueries {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Fetches all partners along with projects, current employees, and affiliations.
   */
  async getAllPartners(): Promise<PartnerWithRelations[]> {
    const rows = await this.prisma.partner.findMany({
      include: {
        type: { select: { name: true } },
        projects: {
          select: {
            id: true,
            name: true,
            isArchived: true,
            ownerName: true,
          }
        },
        currentEmployees: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
        personAffiliations: {
          include: {
            person: {
              select: {
                id: true,
                name: true,
                email: true,
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
    // Flatten the type relation to its name — the UI's contract is a string.
    return rows.map((r) => ({ ...r, type: r.type?.name ?? '' })) as unknown as PartnerWithRelations[];
  }

  /**
   * Returns the count of non-archived projects (active programs) for a partner.
   */
  getActivePrograms(partner: { projects: { isArchived: boolean }[] }): number {
    return partner.projects.filter(p => !p.isArchived).length;
  }

  /**
   * Returns the count of total projects (lifetime programs) for a partner.
   */
  getLifetimePrograms(partner: { projects: unknown[] }): number {
    return partner.projects.length;
  }
}
