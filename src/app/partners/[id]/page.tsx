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
import PartnerProgramRows from '../../../components/PartnerProgramRows';
import { getPartnerPrograms } from '../../../lib/partnerPrograms';
import { getActivity } from '../../../lib/activity';
import { getSummary } from '../../../lib/summaries';
import { geminiConfigured } from '../../../lib/gemini';
import { deriveScore } from '../../../lib/relationship';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';

export const dynamic = 'force-dynamic';

// The partner page is a briefing: a reading column (AI briefing first, programs as
// condensed disclosure rows, activity last) beside a persistent sticky rail of key
// metadata — relationship health, facts, people. Chosen over full-card and tabbed
// variants (2026-07); the rail stays in view while the column scrolls.

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string }>;
}

interface TeamMember {
  email: string;
  role?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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

  // Latest relationship state, plus what the edit/delete affordances need to be
  // honest about.
  const [latestState, types, regions, employeeCount] = await Promise.all([
    prisma.partnerState.findFirst({
      where: { partnerId: partner.id },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.partnerType.findMany({ orderBy: { name: 'asc' } }),
    prisma.region.findMany({ orderBy: { name: 'asc' } }),
    prisma.person.count({ where: { currentPartnerId: partner.id } }),
  ]);

  // Programs this partner OWNS plus programs they're INVOLVED in via phase links.
  const allPrograms = await getPartnerPrograms(partner.id);
  const programs = activeOnly ? allPrograms.filter((p) => !p.isArchived) : allPrograms;
  const ownedCount = allPrograms.filter((p) => p.relationship === 'owner').length;

  // Unified activity for this partner and its programs.
  const activity = await getActivity({ kind: 'partner', id: partner.id });
  const summary = await getSummary('partner', partner.id);

  const googleTeam = (partner.googleTeam as TeamMember[] | null) || [];

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
      </header>

      <main className={styles.main}>
        {/* The briefing column: AI summary leads, programs condense to rows, activity closes. */}
        <div className={styles.colMain}>
          <section className={styles.projectsSection}>
            <SummaryPanel scope="partner" targetId={partner.id} path={`/partners/${partner.id}`}
              summary={summary} configured={geminiConfigured} />
          </section>

          <section className={styles.projectsSection}>
            <h2>{t(locale, 'navPrograms')}</h2>
            <PartnerProgramRows programs={programs} locale={locale} />
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

        {/* The persistent rail: health → narrative → facts, then people. Sticky so key
            metadata stays in view while the briefing scrolls. */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarCard}>
            <div className={styles.metaList}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>{t(locale, 'relationshipLabel')}</span>
                <span className={styles.metaVal}>
                  <RelationshipScale
                    partnerId={partner.id}
                    score={latestState ? deriveScore(latestState) : null}
                    updatedAt={latestState?.timestamp?.toISOString() ?? null}
                  />
                </span>
              </div>
              {partner.summary && <p className={styles.summaryText}>{partner.summary}</p>}
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
                      {hostOf(partner.website)}
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
            <h3>{t(locale, 'peopleLabel')}</h3>
            {googleTeam.length === 0 && partner.personAffiliations.length === 0 ? (
              <p className={styles.empty}>{t(locale, 'noAssociatedPeople')}</p>
            ) : (
              <div className={styles.peopleList}>
                {googleTeam.map((member, i) => (
                  <div key={`g-${i}`} className={styles.teamItem}>
                    <strong>{member.email}</strong>
                    {member.role && <span className={styles.teamRole}>{member.role}</span>}
                  </div>
                ))}
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
