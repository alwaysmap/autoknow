'use client';

import Link from 'next/link';
import PageShell from '../../components/PageShell';
import KebabMenu from '../../components/KebabMenu';
import InitiativesTable from '../../components/InitiativesTable';
import type { InitiativeListRow } from '../../lib/initiativeQueries';
import { t, type Locale } from '../../lib/i18n';
import styles from './page.module.css';

// The /initiatives listing (gh-286 part d): the shared InitiativesTable — the same
// rendering /ecosystem-summary's #initiatives section hosts, so the two surfaces
// cannot drift apart column by column (see the component's header).

export default function InitiativesClient({ rows, locale }: { rows: InitiativeListRow[]; locale: Locale }) {
  return (
    <PageShell
      title={t(locale, 'navInitiatives')}
      subtitle={t(locale, 'initiativesExplainer')}
      actions={
        <>
          <Link className={styles.newLink} href="/initiatives/new">
            {t(locale, 'createInitiativeButton')}
          </Link>
          {/* The CTA stays, and the kebab rides beside it for the house grammar —
              every list header carries one (owner call 2026-08-08). */}
          <KebabMenu ariaLabel={t(locale, 'moreActions')}>
            <Link href="/initiatives/new">{t(locale, 'createInitiativeButton')}</Link>
          </KebabMenu>
        </>
      }
    >
      <InitiativesTable rows={rows} locale={locale} />
    </PageShell>
  );
}
