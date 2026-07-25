import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';
import RelationshipScale from '../../../components/RelationshipScale';
import PartnerAdminControls from '../../../components/PartnerEditor';
import SummaryPanel from '../../../components/SummaryPanel';
import ActivityFeed from '../../../components/ActivityFeed';
import QuickIngest from '../../../components/QuickIngest';
import PartnerProgramRows from '../../../components/PartnerProgramRows';
import { getPartnerPrograms } from '../../../lib/partnerPrograms';
import { getActivity } from '../../../lib/activity';
import { getSummary } from '../../../lib/summaries';
import { geminiConfigured } from '../../../lib/gemini';
import { deriveScore } from '../../../lib/relationship';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import AnchorHeading from '../../../components/AnchorHeading';
import KebabMenu from '../../../components/KebabMenu';
import { NewPersonButton } from '../../../components/PersonEditor';
import PersonCell from '../../../components/PersonCell';

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

// Inline contact facts — labels are a last resort: each value self-labels (a
// hostname reads as the website), separated by middots.
// Only the docs link needs words. Classification facts (type, region) live in
// the header identity line as links into the filtered partner list.
function FactsInline({
  facts,
}: {
  facts: { key: string; node: React.ReactNode }[];
}) {
  if (facts.length === 0) return null;
  return (
    <div className={styles.factsInline}>
      {facts.map((f) => (
        <span key={f.key} className={styles.fact}>{f.node}</span>
      ))}
    </div>
  );
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
  const [recentStates, types, regions, employeeCount, allPartners] = await Promise.all([
    // Two newest — the header card shows the prior score alongside the current one.
    prisma.partnerState.findMany({
      where: { partnerId: partner.id },
      orderBy: { timestamp: 'desc' },
      take: 2,
    }),
    prisma.partnerType.findMany({ orderBy: { name: 'asc' } }),
    prisma.region.findMany({ orderBy: { name: 'asc' } }),
    prisma.person.count({ where: { currentPartnerId: partner.id } }),
    // Organizations for the "New person" picker — pre-selected to THIS partner.
    prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const latestState = recentStates[0] ?? null;
  const priorState = recentStates[1] ?? null;

  // Programs this partner OWNS plus programs they're INVOLVED in via phase links.
  const allPrograms = await getPartnerPrograms(partner.id);
  const programs = activeOnly ? allPrograms.filter((p) => !p.isArchived) : allPrograms;
  const ownedCount = allPrograms.filter((p) => p.relationship === 'owner').length;

  // Unified activity for this partner and its programs.
  const activity = await getActivity({ kind: 'partner', id: partner.id });
  const summary = await getSummary('partner', partner.id);

  const googleTeam = (partner.googleTeam as TeamMember[] | null) || [];

  // No phone here: phone numbers belong to PEOPLE, not companies (the People
  // block is where you find someone to call).
  const contactFacts: { key: string; node: React.ReactNode }[] = [];
  if (partner.website) {
    contactFacts.push({
      key: 'website',
      node: (
        <a href={partner.website} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
          {hostOf(partner.website)}
        </a>
      ),
    });
  }
  if (partner.internalDetailsUrl) {
    contactFacts.push({
      key: 'docs',
      node: (
        <a href={partner.internalDetailsUrl} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
          {t(locale, 'internalDocumentation')} →
        </a>
      ),
    });
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1>{partner.name}</h1>
          <PartnerAdminControls
            partner={{
              id: partner.id,
              name: partner.name,
              typeId: partner.typeId,
              regionId: partner.regionId,
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
        {/* Classification is navigation (design.md §2/§6): type and region jump to
            the partner list pre-filtered to that slice. */}
        <div className={styles.partnerType}>
          <Link
            href={`/partners?type=${encodeURIComponent(partner.type?.name ?? '')}`}
            className={styles.identLink}
          >
            {t(locale, 'partnerProfileSuffix', { t: partner.type?.name ?? '' })}
          </Link>
          {partner.region && (
            <>
              <span className={styles.identSep}>·</span>
              <Link
                href={`/partners?region=${encodeURIComponent(partner.region.name)}`}
                className={styles.identLink}
              >
                {partner.region.name}
              </Link>
            </>
          )}
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
            {/* The create affordance rides INSIDE the heading via `actions` (§8c: a
                sibling would land past the graticule) — a ⋯ menu linking to the
                shared /programs/new flow, pre-selecting THIS partner. Mirrors the
                programs list header (src/app/programs/page.tsx). */}
            <AnchorHeading
              id="programs"
              linkLabel={t(locale, 'anchorLink')}
              actions={
                <KebabMenu ariaLabel={t(locale, 'moreActions')}>
                  <Link href={`/programs/new?partnerId=${partner.id}`} data-testid="new-program">
                    {t(locale, 'createProject')}
                  </Link>
                </KebabMenu>
              }
            >
              {t(locale, 'navPrograms')}
            </AnchorHeading>
            <PartnerProgramRows programs={programs} locale={locale} />
          </section>

          <section className={styles.projectsSection}>
            <AnchorHeading id="activity" linkLabel={t(locale, 'anchorLink')}>
              {t(locale, 'navActivity')}
            </AnchorHeading>
            {/* Activity is filtered by ActivityFeed's own SearchField (over the
                activity items), not a scoped entity search — #41; consistent with
                design.md §2b "one search surface, and it is the page you land on". */}
            {/* scoped paste-a-link: this page IS the anchor (plan §5.2) */}
            <div style={{ margin: '0 0 0.75rem' }}>
              <QuickIngest anchorKind="partner" anchorId={partner.id} path={`/partners/${partner.id}`} />
            </div>
            <ActivityFeed items={activity} deletable revalidate={`/partners/${partner.id}`} />
          </section>
        </div>

        {/* The persistent rail: health → narrative → facts, then people. Sticky so key
            metadata stays in view while the briefing scrolls. */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarCard}>
            {/* health · updated · Update — one horizontal cluster (§7), no label:
                the face is the relationship signal and its hover spells it out */}
            <RelationshipScale
              partnerId={partner.id}
              score={latestState ? deriveScore(latestState) : null}
              previousScore={priorState ? deriveScore(priorState) : null}
              updatedAt={latestState?.timestamp?.toISOString() ?? null}
            />
            {partner.summary && <p className={styles.summaryText}>{partner.summary}</p>}
            <FactsInline facts={contactFacts} />
          </div>

          <div className={styles.sidebarCard}>
            {/* Create-from-context: the ⋯ opens the shared New-person dialog with THIS
                partner pre-selected — the People-card analog of the Programs section's
                "Create Program" (both live on this partner's page). */}
            <div className={styles.cardHeader}>
              <h3>{t(locale, 'peopleLabel')}</h3>
              <NewPersonButton partners={allPartners} defaultPartnerId={partner.id} />
            </div>
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
                    <PersonCell person={{ id: aff.personId, name: aff.person.name }}
                      className={styles.personLink} />
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
