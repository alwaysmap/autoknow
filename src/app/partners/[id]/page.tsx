import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import { partnerRosterAsOf, type PartnerRoster } from '../../../lib/profiles';
import { getPartnerDeleteBlockers } from '../../../lib/partnerDeletion';
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
import { getNeedleHistory } from '../../../lib/history';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import AnchorHeading from '../../../components/AnchorHeading';
import KebabMenu from '../../../components/KebabMenu';
import { NewPersonButton } from '../../../components/PersonEditor';
import PersonCell from '../../../components/PersonCell';
import PartnerPeopleTable, { type PartnerPersonRow } from './PartnerPeopleTable';
import { resolvePeople } from '../../../lib/personDirectory';

export const dynamic = 'force-dynamic';

// The partner page is a briefing: a reading column (AI briefing first, programs as
// condensed disclosure rows, then people, activity last) beside a persistent sticky rail
// of key metadata — relationship health and contact facts. Chosen over full-card and
// tabbed variants (2026-07); the rail stays in view while the column scrolls.
//
// PEOPLE MOVED OUT OF THE RAIL in #127 E12. They were a hand-rolled list of names in a
// 16.875rem sticky column, which is the one shape that cannot say WHEN — and "when" is
// the whole of #124: the same list has to carry who works here, who used to (with the
// date they left) and who is transferring in (with the date they arrive), each filterable.
// That is a table, design.md §6 forbids re-implementing one, and the shared DataTable does
// not read in a rail. The rail keeps the facts that are one line long.

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

/**
 * The three buckets flattened into one list for the table, each row tagged with the bucket
 * the RESOLVER put it in — the component classifies nothing.
 *
 * Bucket order is inert (the table sorts by name), so it follows `PartnerRoster`'s own
 * declaration order rather than inviting a reader to hunt for a significance it has not
 * got. Dates cross the Server→Client boundary as ISO strings: `DateCell` wants one anyway,
 * and a `Date` would arrive at the client as a string regardless.
 */
function toRosterRows(roster: PartnerRoster): PartnerPersonRow[] {
  return (['current', 'past', 'incoming'] as const).flatMap((status) =>
    roster[status].map((aff) => ({
      id: aff.id,
      personId: aff.personId,
      name: aff.person.name,
      role: aff.role,
      status,
      startDate: aff.startDate.toISOString(),
      endDate: aff.endDate?.toISOString() ?? null,
    })),
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
    include: { type: true, region: true },
  });

  if (!partner) {
    return notFound();
  }

  // Latest relationship state, plus what the edit/delete affordances need to be
  // honest about.
  // `roster` carries all three of #124 §4's buckets AS OF THIS REQUEST — the page is
  // `force-dynamic`, so "now" is the instant the page renders, and the resolver's default
  // `at` is that instant. Everything that DISPLAYS people derives from this one call: the
  // headline employee figure is `current.length` and the table's default view is that same
  // bucket, so the page cannot print "12 people" above a list of 11 (#127 E5, E12).
  const [roster, deleteBlockers, recentStates, relHistory, types, regions, allPartners] = await Promise.all([
    partnerRosterAsOf(partner.id),
    // The one number on this page that is NOT a display and so does not come from the
    // roster: what a DELETE would break, counted by the module the server action refuses
    // with. It may differ from the figure above — the roster answers "who works here", this
    // answers "what would this delete break" (`autoknow-aa7`, and `lib/partnerDeletion`).
    getPartnerDeleteBlockers(partner.id),
    // Two newest — the header card shows the prior score alongside the current one.
    prisma.partnerState.findMany({
      where: { partnerId: partner.id },
      orderBy: { timestamp: 'desc' },
      take: 2,
    }),
    // The full log behind the health popover. The fragment that opens it never
    // reaches the server, so the history has to be here on every render — the
    // popover is resolved client-side (#111).
    getNeedleHistory('partner', partner.id),
    prisma.partnerType.findMany({ orderBy: { name: 'asc' } }),
    prisma.region.findMany({ orderBy: { name: 'asc' } }),
    // Organizations for the "New person" picker — pre-selected to THIS partner.
    prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const latestState = recentStates[0] ?? null;
  const priorState = recentStates[1] ?? null;

  // Programs this partner OWNS plus programs they're INVOLVED in via phase links.
  const allPrograms = await getPartnerPrograms(partner.id);
  const programs = activeOnly ? allPrograms.filter((p) => !p.isArchived) : allPrograms;

  // Unified activity for this partner and its programs.
  const activity = await getActivity({ kind: 'partner', id: partner.id });
  const summary = await getSummary('partner', partner.id);

  const googleTeam = (partner.googleTeam as TeamMember[] | null) || [];
  // `googleTeam` is a JSON blob of bare email strings — no Person relation to join
  // through — so the join happens at read time, through the shared server resolver
  // (#153). Keyed by the stored string, so the render hands its own value straight back.
  const teamPeople = await resolvePeople(googleTeam.map((m) => m.email));

  const rosterRows = toRosterRows(roster);

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
            blockers={deleteBlockers}
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
            {/* The create affordance rides INSIDE the heading (§8c), the same shape the
                Programs section above uses — `NewPersonButton` IS a KebabMenu, so it
                drops in unchanged from the rail card it used to sit in. */}
            <AnchorHeading
              id="people"
              linkLabel={t(locale, 'anchorLink')}
              actions={<NewPersonButton partners={allPartners} defaultPartnerId={partner.id} />}
            >
              {t(locale, 'peopleLabel')}
            </AnchorHeading>
            <PartnerPeopleTable rows={rosterRows} locale={locale} />
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

        {/* The persistent rail: health → narrative → facts, then the `googleTeam` blob
            (people proper moved to the reading column in #127 E12 — see the header).
            Sticky so key metadata stays in view while the briefing scrolls. */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarCard}>
            {/* health · updated · Update — one horizontal cluster (§7), no label:
                the face is the relationship signal and its hover spells it out */}
            <RelationshipScale
              partnerId={partner.id}
              score={latestState ? deriveScore(latestState) : null}
              previousScore={priorState ? deriveScore(priorState) : null}
              updatedAt={latestState?.timestamp?.toISOString() ?? null}
              history={relHistory?.changes ?? []}
            />
            {partner.summary && <p className={styles.summaryText}>{partner.summary}</p>}
            <FactsInline facts={contactFacts} />
          </div>

          {/* What is left of the old People card: the `googleTeam` JSON blob, which is a
              parallel people store with NO DATES and keyed on an email, so it can never be
              bucketed and cannot join the table (#124 §7, last bullet). Naming it for what
              it is, in its own card, is the honest interim state until #127 E13 migrates
              it to real Person rows and deletes the mechanism — folding it into the table
              under a made-up status would be inventing the fact the column asserts.
              Absent entirely when the blob is empty; the People table below the programs
              owns the empty state for people who have periods. */}
          {googleTeam.length > 0 && (
            <div className={styles.sidebarCard}>
              <h3>{t(locale, 'googleTeamLabel')}</h3>
              <div className={styles.peopleList}>
                {/* Names through PersonCell (#153) — `.personItem` in the module carries
                    why the Google team's own twin class went away. */}
                {googleTeam.map((member, i) => (
                  <div key={`g-${i}`} className={styles.personItem}>
                    <PersonCell person={teamPeople[member.email]} value={member.email}
                      className={styles.personLink} />
                    {member.role && <span className={styles.personRole}>{member.role}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
