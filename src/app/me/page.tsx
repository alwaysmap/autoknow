import type { ComponentProps } from 'react';
import { prisma } from '../../lib/db';
import { deriveEmail, normalizeHandle } from '../../lib/auth';
import { getCurrentUser } from '../../lib/session';
import MeClient from './MeClient';

// The serialized shapes cross the RSC boundary (Dates → strings), so they no longer
// match the Prisma types — assert against MeClient's own prop contract instead of any.
type MeClientProps = ComponentProps<typeof MeClient>;

export const dynamic = 'force-dynamic';

interface SearchParams {
  user?: string;
}

export default async function MePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  // Default to the signed-in user; `?user=` is an explicit "view as" override
  // (this internal tool has no auth layer yet — see lib/auth.ts).
  const user = searchParams.user || (await getCurrentUser()).display;

  // Derive user email and clean handle from the single auth helper.
  const userClean = normalizeHandle(user);
  const userEmail = deriveEmail(user);

  // 1. Fetch Person biographical profile and career history
  const person = await prisma.person.findFirst({
    where: {
      OR: [
        { email: { equals: userEmail, mode: 'insensitive' } },
        { name: { contains: userClean, mode: 'insensitive' } }
      ]
    },
    include: {
      currentPartner: { include: { type: true, region: true } },
      affiliations: {
        include: {
          partner: { include: { type: true, region: true } }
        },
        orderBy: {
          startDate: 'desc'
        }
      }
    }
  });

  // 2. Fetch Projects owned by the user or where they have assigned action items
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { ownerName: { equals: user, mode: 'insensitive' } },
        { ownerName: { equals: userClean, mode: 'insensitive' } },
        { ownerName: { equals: userEmail, mode: 'insensitive' } },
        {
          phases: {
            some: {
              actionItems: {
                some: {
                  OR: [
                    { assignedTo: { equals: user, mode: 'insensitive' } },
                    { assignedToPersonId: person?.id || -1 }
                  ]
                }
              }
            }
          }
        }
      ]
    },
    include: {
      partner: { include: { type: true, region: true } },
      phases: {
        include: {
          states: {
            orderBy: { timestamp: 'desc' },
            take: 1
          },
          actionItems: {
            where: {
              OR: [
                { assignedTo: { equals: user, mode: 'insensitive' } },
                { assignedToPersonId: person?.id || -1 }
              ]
            }
          }
        }
      }
    }
  });

  // 3. Fetch all pending action items assigned to the user
  const actionItems = await prisma.actionItem.findMany({
    where: {
      status: 'Pending',
      OR: [
        { assignedTo: { equals: user, mode: 'insensitive' } },
        { assignedToPersonId: person?.id || -1 }
      ]
    },
    include: {
      phase: {
        include: {
          project: {
            include: {
              partner: { include: { type: true, region: true } }
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  // 4. Fetch Partners where user is employee, affiliated, or project TEL
  const partners = await prisma.partner.findMany({
    where: {
      OR: [
        { currentEmployees: { some: { id: person?.id || -1 } } },
        { personAffiliations: { some: { personId: person?.id || -1 } } },
        { projects: { some: { ownerName: { in: [user, userClean, userEmail] } } } }
      ]
    },
    include: {
      type: true,
      region: true,
      projects: {
        select: {
          id: true,
          isArchived: true
        }
      }
    }
  });

  // Serialize to handle object nested fields
  const serializedPerson = person ? {
    ...person,
    currentPartner: person.currentPartner ? {
      ...person.currentPartner,
      type: person.currentPartner.type?.name || 'Unknown',
      region: person.currentPartner.region?.name || 'Unknown'
    } : null,
    affiliations: person.affiliations.map(a => ({
      ...a,
      partner: {
        ...a.partner,
        type: a.partner.type?.name || 'Unknown',
        region: a.partner.region?.name || 'Unknown'
      }
    }))
  } : null;

  const serializedProjects = projects.map(proj => ({
    ...proj,
    partner: {
      ...proj.partner,
      type: proj.partner.type?.name || 'Unknown',
      region: proj.partner.region?.name || 'Unknown'
    }
  }));

  const serializedActionItems = actionItems.map(ai => ({
    ...ai,
    phase: {
      ...ai.phase,
      project: {
        ...ai.phase.project,
        partner: {
          ...ai.phase.project.partner,
          type: ai.phase.project.partner.type?.name || 'Unknown',
          region: ai.phase.project.partner.region?.name || 'Unknown'
        }
      }
    }
  }));

  const serializedPartners = partners.map(p => ({
    ...p,
    type: p.type?.name || 'Unknown',
    region: p.region?.name || 'Unknown'
  }));

  return (
    <MeClient
      currentUser={user}
      person={serializedPerson as MeClientProps['person']}
      projects={serializedProjects as MeClientProps['projects']}
      actionItems={serializedActionItems as MeClientProps['actionItems']}
      partners={serializedPartners as MeClientProps['partners']}
    />
  );
}
