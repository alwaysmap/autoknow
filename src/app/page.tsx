import Link from 'next/link';
import UnifiedSearch from '../components/UnifiedSearch';
import LatestTeasers from '../components/LatestTeasers';
import AnchorHeading from '../components/AnchorHeading';
import EcosystemStatStrip from '../components/EcosystemStatStrip';
import { getActivity } from '../lib/activity';
import { getEcosystemDashboardData, getPartnerRelationshipScores } from '../lib/dashboardData';
import { getOpenEscalationsCount } from '../lib/escalationQueries';
import { countActiveInitiatives } from '../lib/initiativeQueries';
import { getLocale } from '../lib/locale';
import { t } from '../lib/i18n';
import { tNodes } from '../components/tNodes';
import styles from './page.module.css';

// The landing page (2026-07-20, user call). ONE job: get you to the thing you came
// for. In order: the leadership strip (2026-07-25, user call), then a big search box
// — the primary affordance, which is a different claim from being the first block —
// then the five most recent updates as teasers, ingested documents and human-written
// notes alike, so an idle visit still shows what moved.
//
// The leadership strip calls the SAME loader /ecosystem does (see EcosystemStatStrip
// for why). That puts the critical-chain pass on this page's critical path — an
// accepted cost, recorded here so it is not a surprise.

export const dynamic = 'force-dynamic';

/** Enough to fill the strip; the number the user asked for. */
const TEASER_COUNT = 5;

export default async function Landing(props: { searchParams: Promise<{ q?: string; lang?: string }> }) {
  const { q, lang } = await props.searchParams;
  const locale = await getLocale(lang);
  const [latest, { serializedProjects }, relationshipScores, openEscalationCount, activeInitiativeCount] = await Promise.all([
    getActivity({ kind: 'ecosystem' }, TEASER_COUNT),
    getEcosystemDashboardData(),
    getPartnerRelationshipScores(),
    getOpenEscalationsCount(),
    countActiveInitiatives(),
  ]);

  // Snapshot "now" server-side so SSR and hydration agree — same rule as /ecosystem.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className={styles.container}>
      {/* Outside <main>, which labels the hero. The strip must stay short enough that
          the autofocused input keeps its place above the fold — otherwise the browser
          scrolls straight past the strip on load (design.md §2b). */}
      <EcosystemStatStrip
        programs={serializedProjects}
        relationshipScores={relationshipScores}
        now={now}
        openEscalationCount={openEscalationCount}
        activeInitiativeCount={activeInitiativeCount}
      />

      <main className={styles.hero}>
        <UnifiedSearch
          initialQuery={q ?? ''}
          autoFocus
          hero
          placeholder={t(locale, 'searchEverythingPlaceholder')}
        />
        {/* The search box answers a question you can phrase. These are for when
            you'd rather just look. */}
        <p className={styles.browse}>
          {tNodes(locale, 'landingBrowse', {
            ecosystem: <Link key="e" href="/ecosystem">{t(locale, 'navEcosystem')}</Link>,
            programs: <Link key="pr" href="/programs">{t(locale, 'navPrograms')}</Link>,
            partners: <Link key="pa" href="/partners">{t(locale, 'navPartners')}</Link>,
            people: <Link key="pe" href="/people">{t(locale, 'peopleLabel')}</Link>,
          })}
        </p>
      </main>

      <section className={styles.latest}>
        <AnchorHeading id="latest-updates">
          {t(locale, 'landingLatest')}
        </AnchorHeading>
        <LatestTeasers items={latest} locale={locale} />
      </section>
    </div>
  );
}
