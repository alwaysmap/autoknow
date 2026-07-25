import Link from 'next/link';
import UnifiedSearch from '../components/UnifiedSearch';
import LatestTeasers from '../components/LatestTeasers';
import AnchorHeading from '../components/AnchorHeading';
import EcosystemStatStrip from '../components/EcosystemStatStrip';
import { getActivity } from '../lib/activity';
import { getEcosystemDashboardData, getPartnerRelationshipScores } from '../lib/dashboardData';
import { getLocale } from '../lib/locale';
import { t } from '../lib/i18n';
import { tNodes } from '../components/tNodes';
import styles from './page.module.css';

// The landing page (2026-07-20, user call). ONE job: get you to the thing you
// came for. A big search box is the primary affordance; under it, the five most
// recent updates — ingested documents and human-written notes alike — as teasers,
// so an idle visit still shows what moved.
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
  const [latest, { serializedProjects }, relationshipScores] = await Promise.all([
    getActivity({ kind: 'ecosystem' }, TEASER_COUNT),
    getEcosystemDashboardData(),
    getPartnerRelationshipScores(),
  ]);

  // Snapshot "now" server-side so SSR and hydration agree — same rule as /ecosystem.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className={styles.container}>
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

      <EcosystemStatStrip programs={serializedProjects} relationshipScores={relationshipScores} now={now} />

      <section className={styles.latest}>
        <AnchorHeading id="latest-updates" linkLabel={t(locale, 'anchorLink')}>
          {t(locale, 'landingLatest')}
        </AnchorHeading>
        <LatestTeasers items={latest} locale={locale} />
      </section>
    </div>
  );
}
