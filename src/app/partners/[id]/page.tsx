import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';
import NeedleGauge from '../../../components/NeedleGauge';
import { formatNeedleValue } from '../../../lib/needle';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string }>;
}

export default async function PartnerDetailPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const partnerId = parseInt(params.id, 10);
  const activeOnly = searchParams.filter === 'active';

  if (isNaN(partnerId)) {
    return notFound();
  }

  // Fetch the current partner
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    include: {
      type: true,
      region: true,
      personAffiliations: {
        where: { endDate: null },
        include: { person: true }
      }
    }
  });

  if (!partner) {
    return notFound();
  }

  // Fetch latest partner state log
  const latestState = await prisma.partnerState.findFirst({
    where: { partnerId: partner.id },
    orderBy: { timestamp: 'desc' }
  });

  // Fetch all projects directly associated with this partner (with optional active-only filter)
  const projects = await prisma.project.findMany({
    where: {
      partnerId: partner.id,
      ...(activeOnly ? { isArchived: false } : {})
    },
    include: {
      phases: {
        include: {
          states: {
            orderBy: { timestamp: 'desc' },
            take: 1
          }
        }
      }
    }
  });

  // Fetch all OEM partners to group supplier projects by OEM
  const oems = await prisma.partner.findMany({
    where: { type: { name: 'OEM' } }
  });

  // Group projects by OEM (if this is a Supplier partner)
  const groupedProjects: Record<string, typeof projects> = {};

  if (partner.type?.name === 'Supplier') {
    projects.forEach(project => {
      // Find matching OEM name inside the project name
      const matchingOem = oems.find(oem => 
        project.name.toLowerCase().includes(oem.name.toLowerCase())
      );

      const groupKey = matchingOem ? matchingOem.name : 'General / Independent';
      if (!groupedProjects[groupKey]) {
        groupedProjects[groupKey] = [];
      }
      groupedProjects[groupKey].push(project);
    });
  } else {
    // If this is an OEM partner, group everything under their own name
    groupedProjects[partner.name] = projects;
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>{partner.name}</h1>
          <div className={styles.partnerType}>{partner.type?.name} Partner Profile</div>
        </div>
        <div style={{ minWidth: '180px' }}>
          <NeedleGauge
            value={latestState?.theNeedle || 'Low'}
            scope="partner"
            targetId={partner.id}
            notesLabel="Google relationship risk notes"
          />
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.projectsSection}>
          <h2>Related Projects</h2>
          
          {projects.length === 0 ? (
            <p className={styles.empty}>No related projects found for this partner.</p>
          ) : (
            <div className={styles.groups}>
              {Object.entries(groupedProjects).map(([groupName, groupList]) => (
                <div key={groupName} className={styles.group}>
                  <h3 className={styles.groupHeading}>{groupName}</h3>
                  <div className={styles.grid}>
                    {groupList.map(project => {
                      const activePhase = project.phases.find(p => p.states[0]?.status === 'Active WIP') || project.phases[0];
                      const activeState = activePhase?.states[0];

                      return (
                        <div key={project.id} className={styles.projectCard}>
                          <h4>
                            <Link href={`/projects/${project.id}`} className={styles.projectLink}>
                              {project.name}
                            </Link>
                          </h4>
                          <div className={styles.meta}>
                            <div>
                              <span className={styles.label}>Active Phase:</span>{' '}
                              <strong>{activePhase?.name || 'N/A'}</strong>
                            </div>
                            <div className={styles.needleRow}>
                              <span className={styles.label}>The Needle:</span>{' '}
                              {(() => {
                                const label = formatNeedleValue(activeState?.theNeedle);
                                return (
                                  <span className={`${styles.badge} ${styles[label.toLowerCase()]}`}>
                                    {label}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Sidebar for Metadata */}
        <aside className={styles.sidebar}>
          {partner.summary && (
            <div className={styles.sidebarCard}>
              <h3>Relationship Summary</h3>
              <p className={styles.summaryText}>{partner.summary}</p>
            </div>
          )}

          <div className={styles.sidebarCard}>
            <h3>Key Details</h3>
            <div className={styles.metaList}>
              {partner.region && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Google Region</span>
                  <span className={styles.metaVal}>{partner.region.name}</span>
                </div>
              )}
              {partner.phone && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Telephone</span>
                  <span className={styles.metaVal}>{partner.phone}</span>
                </div>
              )}
              {partner.website && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Website</span>
                  <span className={styles.metaVal}>
                    <a href={partner.website} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
                      Visit Website &rarr;
                    </a>
                  </span>
                </div>
              )}
              {partner.internalDetailsUrl && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Internal Documentation</span>
                  <span className={styles.metaVal}>
                    <a href={partner.internalDetailsUrl} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
                      Read more (Shared Drive) &rarr;
                    </a>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className={styles.sidebarCard}>
            <h3>Current Team</h3>
            {(() => {
              const googleTeam = (partner.googleTeam as any[]) || [];
              if (googleTeam.length === 0) {
                return <p className={styles.empty}>No Google team assigned.</p>;
              }
              return (
                <div className={styles.teamList}>
                  {googleTeam.map((member, i) => (
                    <div key={i} className={styles.teamItem}>
                      <strong>{member.email}</strong>
                      {member.role && <span className={styles.teamRole}>{member.role}</span>}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <div className={styles.sidebarCard}>
            <h3>Associated People</h3>
            {partner.personAffiliations.length === 0 ? (
              <p className={styles.empty}>No associated people found.</p>
            ) : (
              <div className={styles.peopleList}>
                {partner.personAffiliations.map((aff) => (
                  <div key={aff.id} className={styles.personItem}>
                    <Link href={`/people/${aff.personId}`} className={styles.personLink}>
                      {aff.person.name}
                    </Link>
                    {aff.role && <span className={styles.personRole}>{aff.role}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
