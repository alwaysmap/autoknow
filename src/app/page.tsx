import Link from 'next/link';
import UnifiedSearch from '../components/UnifiedSearch';
import LatestTeasers from '../components/LatestTeasers';
import AnchorHeading from '../components/AnchorHeading';
import { getActivity } from '../lib/activity';
import { getLocale } from '../lib/locale';
import { t } from '../lib/i18n';
import { tNodes } from '../components/tNodes';
import styles from './page.module.css';

// The landing page (2026-07-20, user call). ONE job: get you to the thing you
// came for. A big search box is the primary affordance; under it, the five most
// recent updates — ingested documents and human-written notes alike — as teasers,
// so an idle visit still shows what moved. The ecosystem dashboard, which used to
// live here, now has its own URL at /ecosystem.

export const dynamic = 'force-dynamic';

/** Enough to fill the strip; the number the user asked for. */
const TEASER_COUNT = 5;

export default async function Landing(props: { searchParams: Promise<{ q?: string; lang?: string }> }) {
  const { q, lang } = await props.searchParams;
  const locale = await getLocale(lang);
  const latest = await getActivity({ kind: 'ecosystem' }, TEASER_COUNT);

  return (
    <div className={styles.container}>
      <main className={styles.hero}>
        <h1 className={styles.headline}>{t(locale, 'landingHeadline')}</h1>
        <p className={styles.lede}>{t(locale, 'landingLede')}</p>
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
        <AnchorHeading id="latest-updates" linkLabel={t(locale, 'anchorLink')}>
          {t(locale, 'landingLatest')}
        </AnchorHeading>
        <LatestTeasers items={latest} locale={locale} />
      </section>
    </div>
  );
}
