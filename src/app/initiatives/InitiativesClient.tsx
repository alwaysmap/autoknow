'use client';

import Link from 'next/link';
import PageShell from '../../components/PageShell';
import KebabMenu from '../../components/KebabMenu';
import DataTable from '../../components/DataTable';
import DateCell from '../../components/DateCell';
import InitiativeDistribution from '../../components/InitiativeDistribution';
import { initiativeHref } from '../../lib/entityHref';
import type { InitiativeListRow } from '../../lib/initiativeQueries';
import { t, type Locale } from '../../lib/i18n';
import styles from './page.module.css';

// The /initiatives listing (gh-286 part d): the shared DataTable per design.md §6.
// A CLIENT component because DataTable takes `renderRow` (same reason as every other
// host). Deliberately funnel-less for now: initiatives are counted in single digits and
// funnels on a short table are a call-site judgement (#125), not a default.

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
      <DataTable
        headers={[
          { key: 'name', label: t(locale, 'initiativeLabel'), sortable: true },
          { key: 'memberCount', label: t(locale, 'initiativeColPartners'), sortable: true },
          { key: 'progress', label: t(locale, 'initiativeColProgress') },
          { key: 'targetDate', label: t(locale, 'initiativeTargetLabel'), sortable: true, sortType: 'date' },
        ]}
        data={rows}
        defaultSortKey="name"
        defaultSortOrder="asc"
        paginate={false}
        emptyStateMessage={t(locale, 'initiativesEmpty')}
        renderRow={(r: InitiativeListRow) => (
          <tr key={r.id}>
            <td>
              <Link href={initiativeHref(r.id)}>{r.name}</Link>
            </td>
            <td>{r.memberCount}</td>
            {/* Zeros-omitted status distribution — the shared rendering, so this cell and
                the /ecosystem section cannot disagree (InitiativeDistribution). */}
            <td><InitiativeDistribution rollup={r.rollup} locale={locale} /></td>
            <td><DateCell value={r.targetDate} /></td>
          </tr>
        )}
      />
    </PageShell>
  );
}
