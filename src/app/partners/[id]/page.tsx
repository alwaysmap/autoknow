import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';
import NeedleGauge from '../../../components/NeedleGauge';
import ActivityFeed from '../../../components/ActivityFeed';
import UnifiedSearch from '../../../components/UnifiedSearch';
import PartnerPrograms from '../../../components/PartnerPrograms';
import { getPartnerPrograms } from '../../../lib/partnerPrograms';
import { getActivity } from '../../../lib/activity';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string }>;
}

interface TeamMember {
  email: string;
  role?: string;
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

  // Fetch the two latest partner state logs (current + previous for the ghost marker)
  const partnerStates = await prisma.partnerState.findMany({
    where: { partnerId: partner.id },
    orderBy: { timestamp: 'desc' },
    take: 2,
  });
  const latestState = partnerStates[0];
  const previousState = partnerStates[1];

  // Programs this partner OWNS plus programs they're INVOLVED in via phase links.
  const allPrograms = await getPartnerPrograms(partner.id);
  const programs = activeOnly ? allPrograms.filter((p) => !p.isArchived) : allPrograms;

  // Unified activity for this partner and its programs.
  const activity = await getActivity({ kind: 'partner', id: partner.id });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>{partner.name}</h1>
          <div className={styles.partnerType}>{partner.type?.name} Partner Profile</div>
        </div>
        <div style={{ minWidth: '200px' }}>
          <NeedleGauge
            progress={latestState?.hillChartProgress ?? 0}
            health={latestState?.theNeedle ?? 'On Track'}
            previousProgress={previousState?.hillChartProgress ?? null}
            previousHealth={previousState?.theNeedle ?? null}
            updatedAt={latestState?.timestamp?.toISOString() ?? null}
            targetId={partner.id}
            scope="partner"
          />
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.projectsSection}>
          <h2>Programs</h2>
          <PartnerPrograms programs={programs} />
        </section>

        <section className={styles.projectsSection}>
          <h2>Search</h2>
          <UnifiedSearch
            scope={{ kind: 'partner', id: partner.id }}
            placeholder="Search this partner — programs, people, context…"
          />
        </section>

        <section className={styles.projectsSection}>
          <h2>Activity</h2>
          <ActivityFeed items={activity} deletable revalidate={`/partners/${partner.id}`} />
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
              const googleTeam = (partner.googleTeam as TeamMember[] | null) || [];
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
