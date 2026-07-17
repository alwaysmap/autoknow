import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';
import RelationshipScale from '../../../components/RelationshipScale';
import PartnerAdminControls from '../../../components/PartnerEditor';
import SummaryPanel from '../../../components/SummaryPanel';
import ActivityFeed from '../../../components/ActivityFeed';
import UnifiedSearch from '../../../components/UnifiedSearch';
import QuickIngest from '../../../components/QuickIngest';
import PartnerPrograms from '../../../components/PartnerPrograms';
import { getPartnerPrograms } from '../../../lib/partnerPrograms';
import { getActivity } from '../../../lib/activity';
import { getSummary } from '../../../lib/summaries';
import { geminiConfigured } from '../../../lib/gemini';
import { deriveScore } from '../../../lib/relationship';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';

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
  const locale = await getLocale();

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

  // The two latest relationship states (current + previous for the ghost ring),
  // plus what the edit/delete affordances need to be honest about.
  const [partnerStates, types, regions, employeeCount] = await Promise.all([
    prisma.partnerState.findMany({
      where: { partnerId: partner.id },
      orderBy: { timestamp: 'desc' },
      take: 2,
    }),
    prisma.partnerType.findMany({ orderBy: { name: 'asc' } }),
    prisma.region.findMany({ orderBy: { name: 'asc' } }),
    prisma.person.count({ where: { currentPartnerId: partner.id } }),
  ]);
  const latestState = partnerStates[0];
  const previousState = partnerStates[1];

  // Programs this partner OWNS plus programs they're INVOLVED in via phase links.
  const allPrograms = await getPartnerPrograms(partner.id);
  const programs = activeOnly ? allPrograms.filter((p) => !p.isArchived) : allPrograms;
  const ownedCount = allPrograms.filter((p) => p.relationship === 'owner').length;

  // Unified activity for this partner and its programs.
  const activity = await getActivity({ kind: 'partner', id: partner.id });
  const summary = await getSummary('partner', partner.id);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1>{partner.name}</h1>
            <PartnerAdminControls
              partner={{
                id: partner.id,
                name: partner.name,
                typeId: partner.typeId,
                regionId: partner.regionId,
                phone: partner.phone,
                website: partner.website,
                internalDetailsUrl: partner.internalDetailsUrl,
                summary: partner.summary,
              }}
              types={types}
              regions={regions}
              programCount={ownedCount}
              employeeCount={employeeCount}
            />
          </div>
          <div className={styles.partnerType}>{t(locale, 'partnerProfileSuffix', { t: partner.type?.name ?? '' })}</div>
        </div>
        {/* relationship health: a 7-point scale, not a needle — see lib/relationship */}
        <RelationshipScale
          partnerId={partner.id}
          score={latestState ? deriveScore(latestState) : null}
          previousScore={previousState ? deriveScore(previousState) : null}
          updatedAt={latestState?.timestamp?.toISOString() ?? null}
        />
      </header>

      <main className={styles.main}>
        {/* Programs are the main event; the summary and the feed read in their light. */}
        <div className={styles.colMain}>
          <section className={styles.projectsSection}>
            <h2>{t(locale, 'navPrograms')}</h2>
            <PartnerPrograms programs={programs} locale={locale} />
          </section>

          <section className={styles.projectsSection}>
            <SummaryPanel scope="partner" targetId={partner.id} path={`/partners/${partner.id}`}
              summary={summary} configured={geminiConfigured} />
          </section>

          <section className={styles.projectsSection}>
            <h2>{t(locale, 'navActivity')}</h2>
            <div style={{ margin: '4px 0 14px' }}>
              <UnifiedSearch
                scope={{ kind: 'partner', id: partner.id }}
                placeholder={t(locale, 'searchThisPartner')}
                showTypeChips={false}
              />
            </div>
            {/* scoped paste-a-link: this page IS the anchor (plan §5.2) */}
            <div style={{ margin: '0 0 12px' }}>
              <QuickIngest anchorKind="partner" anchorId={partner.id} path={`/partners/${partner.id}`} />
            </div>
            <ActivityFeed items={activity} deletable revalidate={`/partners/${partner.id}`} />
          </section>
        </div>

        {/* Side column: partner metadata only — reference material, not the event */}
        <aside className={styles.sidebar}>
          {partner.summary && (
            <div className={styles.sidebarCard}>
              <h3>{t(locale, 'relationshipSummary')}</h3>
              <p className={styles.summaryText}>{partner.summary}</p>
            </div>
          )}

          <div className={styles.sidebarCard}>
            <h3>{t(locale, 'keyDetails')}</h3>
            <div className={styles.metaList}>
              {partner.region && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>{t(locale, 'googleRegion')}</span>
                  <span className={styles.metaVal}>{partner.region.name}</span>
                </div>
              )}
              {partner.phone && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>{t(locale, 'telephone')}</span>
                  <span className={styles.metaVal}>{partner.phone}</span>
                </div>
              )}
              {partner.website && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>{t(locale, 'website')}</span>
                  <span className={styles.metaVal}>
                    <a href={partner.website} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
                      {t(locale, 'visitWebsite')}
                    </a>
                  </span>
                </div>
              )}
              {partner.internalDetailsUrl && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>{t(locale, 'internalDocumentation')}</span>
                  <span className={styles.metaVal}>
                    <a href={partner.internalDetailsUrl} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
                      {t(locale, 'readMoreSharedDrive')}
                    </a>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className={styles.sidebarCard}>
            <h3>{t(locale, 'currentTeam')}</h3>
            {(() => {
              const googleTeam = (partner.googleTeam as TeamMember[] | null) || [];
              if (googleTeam.length === 0) {
                return <p className={styles.empty}>{t(locale, 'noGoogleTeam')}</p>;
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
            <h3>{t(locale, 'associatedPeople')}</h3>
            {partner.personAffiliations.length === 0 ? (
              <p className={styles.empty}>{t(locale, 'noAssociatedPeople')}</p>
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
