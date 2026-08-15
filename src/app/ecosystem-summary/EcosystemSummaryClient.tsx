'use client';

import DateCell from '../../components/DateCell';
import { useState } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import styles from './EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../../lib/needle';
import SopOutlookCell from '../../components/SopOutlookCell';
import type { LiveConstraint } from '../../lib/dashboardData';
import type { InitiativeListRow } from '../../lib/initiativeQueries';
import InitiativesTable from '../../components/InitiativesTable';
import KebabMenu from '../../components/KebabMenu';
import { healthKey, healthColor, healthOrder } from '../../lib/health';
import PersonCell, { personRefFunnel, type PersonRef } from '../../components/PersonCell';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import AnchorHeading from '../../components/AnchorHeading';
import InfoPopover from '../../components/InfoPopover';
import PageShell from '../../components/PageShell';
import { programHref } from '../../lib/entityHref';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  /** The owner as an ENTITY, resolved server-side from `Project.ownerPersonId`
   *  (#127 E7) — this was the stored `ownerName` email, re-matched here. */
  owner: PersonRef | null;
  volumeFirstYear: number;
  /** Remaining days along the REAL critical chain — the on-track signal vs SOP. */
  chainRemainingDays: number;
  partner: {
    id: number;
    name: string;
  };
  phases: {
    id: number;
    name: string;
    states: {
      status: string;
      theNeedle: string | null;
      hillChartProgress: number | null;
    }[];
  }[];
}

interface EcosystemSummaryClientProps {
  liveConstraints: LiveConstraint[];
  /** Active initiatives via getInitiativesList — the same rows /initiatives shows. */
  initiatives: InitiativeListRow[];
  /** Funnel selections restored from the query string (design.md §2). */
  initialFilters?: Record<string, string[]>;
  initialTableSort?: TableSort | null;
  /** Snapshotted server-side so SSR and hydration agree (see the page). */
  now: number;
  initialProjects: Project[];
}

export default function EcosystemSummaryClient({
  initialProjects,
  liveConstraints,
  initiatives,
  now,
  initialFilters,
  initialTableSort = null
}: EcosystemSummaryClientProps) {
  const locale = useLocale();
  // Filtering is the shared table grammar (#95): Health and Owner are in-header funnels,
  // and the state round-trips through the URL like every other listing.
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const [sort, setSort] = useState<TableSort | null>(initialTableSort);
  useTableUrlSync(filters, sort);

  // The leaders banner counts the WHOLE portfolio, not the filtered view. It used to
  // track the bespoke panel, because that panel filtered before render; DataTable now
  // filters internally and does not report its result, so the count could only follow
  // the funnels if the component reached back in. A portfolio-level alert that changes
  // as you narrow a table was arguably the wrong reading anyway — but this IS a
  // behaviour change, so it is stated rather than hidden behind a filtered-looking name.
  const criticalCount = initialProjects.filter(p => healthOrder(p.theNeedle) >= 1).length;

  return (
    <PageShell title={t(locale, 'ecosystemSummary')}>
      <div className={styles.clientWrapper}>

      {/* Visual Stuck / Critical Blockers Alerts */}
      {criticalCount > 0 && (
        <div className={styles.blockerAlert}>
          <strong>{t(locale, 'attentionLeaders')}</strong> {t(locale, 'flaggedPrograms', { n: criticalCount })}
        </div>
      )}
      {/* Ecosystem flow constraints diagnosis */}
      <section className={styles.constraintDiagnosis}>
        {/* A real section peer of #lifecycle-launches and #initiatives, so it takes
            the same AnchorHeading grammar (deep link + graticule) rather than the
            bare h3-with-sub it used to hand-roll — the page had three heading
            systems and this was the odd one out. */}
        <div className={styles.diagnosisHeader}>
          <AnchorHeading
            id="constraint-diagnosis"
            actions={
              /* Where the numbers come from, read once rather than hedged into every
                 row (§7/§7b). The panel's job is to EXPLAIN, so it owes the reader the
                 basis of what it explains — but a per-sentence disclaimer would drown
                 the sentences. */
              <InfoPopover label={t(locale, 'aboutSection', { s: t(locale, 'flowConstraintDiagnosis') })}>
                <p>{t(locale, 'flowConstraintMethod')}</p>
              </InfoPopover>
            }
          >
            {t(locale, 'flowConstraintDiagnosis')}
          </AnchorHeading>
          <span className={styles.diagnosisSub}>{t(locale, 'flowConstraintSub')}</span>
        </div>
        {liveConstraints.length === 0 ? (
          <p className={styles.diagnosisEmpty}>{t(locale, 'noLiveConstraints')}</p>
        ) : (
          <DataTable
            headers={[
              { key: 'phaseName', label: t(locale, 'phaseLabel') },
              // None of these sort. Gating and status both derive from the same count, so
              // two controls would do one job; Why is a sentence, not a measure; and the
              // rows already arrive worst-first (severity, then gating count). `status`
              // names no field on LiveConstraint — an identity-only key, see
              // `FilterColumn.key`.
              { key: 'programs', label: t(locale, 'clGatingSop'), sortable: false },
              // #148's headline: WHY this phase is the constraint, not just where it is.
              { key: 'why', label: t(locale, 'cdWhyHeader'), sortable: false },
              // …and SINCE WHEN. `DateCell` because this column is read DOWN — which of
              // these has been stuck longest — rather than one stamp against now (§6).
              { key: 'since', label: t(locale, 'cdSinceHeader'), sortType: 'date' },
              { key: 'status', label: t(locale, 'statusLabel'), sortable: false },
            ]}
            data={liveConstraints}
            paginate={false}
            // Empty: keep the worst-first order dashboardData already applied.
            defaultSortKey=""
            renderRow={(c: LiveConstraint) => {
              // Gating more than one live SOP is what makes a phase *primary*; a phase
              // gating one is still genuinely on a chain, just not the leverage point.
              const isPrimary = c.programs.length > 1;
              const { insight } = c.worst;
              return (
                <tr key={c.phaseName} className={isPrimary ? styles.constraintHighlight : undefined}>
                  <th scope="row">{c.phaseName}</th>
                  <td>
                    {isPrimary
                      ? t(locale, 'gatingNPrograms', { n: c.programs.length })
                      : t(locale, 'gatingOneProgram')}
                    <div className={styles.constraintPrograms}>
                      {c.programs.map((prog, i) => (
                        <span key={prog.id}>
                          {i > 0 && ', '}
                          <Link href={programHref(prog.id)}>{prog.name}</Link>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {/* The diagnosis, from lib/chainInsights — the ledger's own Situation
                        packets, which until now rendered on exactly one screen. The phase
                        link goes to the CARD in the program the diagnosis is about, so
                        "why" is one click from the evidence. */}
                    <Link href={insight.href} className={styles.diagnosisWhy}>
                      {t(locale, insight.symptom.key, insight.symptom.values)}
                    </Link>
                    {/* Provenance, not a measure (§6 counts measures, and a basis is not
                        one): whether the number above was read off two real dates or
                        computed against a duration somebody typed in. Never the ✦ mark —
                        that flags authorship of PROSE, and reaching for it here would be
                        laundering a derived number as an opinion (§8). */}
                    <div className={styles.diagnosisBasis}>
                      {t(locale, insight.symptom.basis === 'measured' ? 'cdBasisMeasured' : 'cdBasisEstimated')}
                      {c.diagnoses.length > 1 && (
                        <> · {t(locale, 'cdWorstOf', { n: c.diagnoses.length })}</>
                      )}
                    </div>
                  </td>
                  {/* Blank when genuinely unknown — a phase that has not started has no
                      date to state, and a first-seen timestamp would be invented. */}
                  <td><DateCell value={insight.since} /></td>
                  <td>
                    <span className={isPrimary ? styles.badgeDanger : styles.badgeWarn}>
                      {t(locale, isPrimary ? 'primaryConstraint' : 'onCriticalChain')}
                    </span>
                  </td>
                </tr>
              );
            }}
          />
        )}
      </section>

      {/* Active Implementation Pipelines */}
      <section className={styles.tableSection}>
        <AnchorHeading id="lifecycle-launches">
          {t(locale, 'programLifecycleLaunches')}
        </AnchorHeading>
        <DataTable
          headers={[
            { key: 'partner.name', label: t(locale, 'partnerLabel') },
            { key: 'name', label: t(locale, 'programLabel') },
            {
              // Keyed on the owner's id via the FK, not on the stored email (#127 E7).
              key: 'owner', label: t(locale, 'ownerLabel'), filterable: true,
              ...personRefFunnel(initialProjects, (p) => p.owner),
            },
            { key: 'sopDate', label: t(locale, 'sopDate') },
            { key: 'volumeFirstYear', label: t(locale, 'volume12m') },
            {
              key: 'theNeedle', label: t(locale, 'healthLabel'), filterable: true,
              // Canonicalize legacy values so "Low"/"On Track" collapse to one option —
              // same treatment as /programs, which this now matches.
              filterValue: (row) => formatNeedleValue((row as Project).theNeedle),
              filterLabel: (v) => t(locale, healthKey(v)),
            },
            { key: 'hillChartProgress', label: t(locale, 'hillChartHeader') },
            { key: 'chainRemainingDays', label: t(locale, 'sopOutlookHeader') }
          ]}
          data={initialProjects}
          filters={filters}
          onFiltersChange={setFilters}
          onSortChange={(key, dir) => setSort({ key, dir })}
          renderRow={(p: Project) => {
            const isEarlyStage = p.hillChartProgress <= 50;
            return (
              <tr key={p.id} className={isEarlyStage ? styles.earlyRow : ''}>
                <th scope="row">
                  <Link href={`/partners/${p.partner.id}`}>
                    {p.partner.name}
                  </Link>
                </th>
                <td>
                  <strong>
                    <Link href={`/programs/${p.id}`} className={styles.link}>
                      {p.name}
                    </Link>
                  </strong>
                  {isEarlyStage && <span className={styles.earlyBadge}>{t(locale, 'earlyStage')}</span>}
                </td>
                <td>
                  {/* By name, not by the stored LDAP email (#153). The person comes from
                      the FK (#127 E7), so no directory match can miss them. */}
                  <PersonCell person={p.owner} fallback={t(locale, 'unassigned')} />
                </td>
                <td><DateCell value={p.sopDate} fallback={t(locale, 'tbd')} /></td>
                <td>{t(locale, 'unitsCount', { n: p.volumeFirstYear.toLocaleString(locale) })}</td>
                <td>
                  {(() => {
                    const label = formatNeedleValue(p.theNeedle);
                    return (
                      <button
                        type="button"
                        onClick={() => setFilters((f) => ({ ...f, theNeedle: [label] }))}
                        className={styles.badgeFilterBtn}
                        title={t(locale, 'filterHealthTitle', { h: t(locale, healthKey(label)) })}
                      >
                        <span className={styles.badge} style={{ color: healthColor(label) }}>
                          {t(locale, healthKey(label))}
                        </span>
                      </button>
                    );
                  })()}
                </td>
                <td>
                  <div className={styles.progressCell}>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressBar}
                        style={{ width: `${p.hillChartProgress}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td>
                  <SopOutlookCell
                    chainRemainingDays={p.chainRemainingDays}
                    sopDate={p.sopDate}
                    hillChartProgress={p.hillChartProgress}
                    now={now}
                    locale={locale}
                  />
                </td>
              </tr>
            );
          }}
          defaultSortKey="name"
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>

      {/* Initiatives (autoknow-hcz.12): the cross-partner goals the launches table above
          deliberately excludes. The rows arrive through getInitiativesList — the SAME
          loader /initiatives and /ecosystem's section render — and the table is the
          shared InitiativesTable, so this section equals /initiatives cell for cell by
          construction (the summary-count ADR). Zero initiatives is a real state and the
          table's empty message says so; the section never hides. */}
      <section className={styles.tableSection}>
        <AnchorHeading
          id="initiatives"
          actions={
            <KebabMenu ariaLabel={t(locale, 'moreActions')}>
              <Link href="/initiatives">{t(locale, 'navInitiatives')}</Link>
            </KebabMenu>
          }
        >
          {t(locale, 'navInitiatives')}
        </AnchorHeading>
        <InitiativesTable rows={initiatives} locale={locale} />
      </section>

      </div>
    </PageShell>
  );
}
