'use client';

import React, { useState } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DateCell from '../../components/DateCell';
import DataTable, { type Header } from '../../components/DataTable';
import ClassBox from '../../components/ClassBox';
import AnchorHeading from '../../components/AnchorHeading';
import ProgramTimeline from '../../components/ProgramTimeline';
import PersonCell, { personRefFunnel, type PersonRef } from '../../components/PersonCell';
import { applyTableFilter } from '../../lib/tableFilter';
import { buildTimelineMarks } from '../../lib/programTimeline';
import styles from '../ecosystem-summary/EcosystemSummaryClient.module.css';
import local from './page.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { healthKey, healthColor, healthOrder } from '../../lib/health';
import { deriveProgramStatus } from '../../lib/lifecycle';
import type { SopBufferCategory } from '../../lib/sop';
import { t, type StringKey } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';

// SOP-outlook column vocabulary: canonical token → localized label + ink. Only the bad
// classes are colored; the rest stay quiet so the column doesn't read as a field of
// warnings. The ink follows severity, the LABEL carries the distinction: 'late' and
// 'atrisk' share --warn (the same fold `lib/sop.sopForecastTone` makes), while 'blown'
// takes --bad, because a date already missed is not the same news as one forecast to be.
const SOP_OUTLOOK_KEY: Record<SopBufferCategory, StringKey> = {
  blown: 'sopOutlookBlown',
  late: 'sopOutlookLate',
  atrisk: 'sopOutlookAtRisk',
  ontrack: 'sopOutlookOnTrack',
  nosop: 'sopOutlookNoSop',
  na: 'sopOutlookNa',
};
const SOP_OUTLOOK_COLOR: Record<SopBufferCategory, string> = {
  blown: 'var(--bad)',
  late: 'var(--warn)',
  atrisk: 'var(--warn)',
  ontrack: 'var(--muted)',
  nosop: 'var(--muted)',
  na: 'var(--muted)',
};

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  lifecycle: string;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  sopOutlook: SopBufferCategory;
  /** The owner as an ENTITY, resolved server-side through `Project.ownerPersonId`
   *  (#127 E7). Was the stored `ownerName` email, re-matched against a directory
   *  shipped alongside — which lost any owner who had changed address (#124 Class 4). */
  owner: PersonRef | null;
  /** Remaining critical-chain days — the timeline's forecast input, the same figure the
   *  page's sopOutlook column was derived from (lib/programTimeline.TimelineProgram). */
  chainRemainingDays: number;
  volumeFirstYear: number;
  partner: {
    id: number;
    name: string;
    type: string;
    region: string | null;
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

interface ProgramsClientProps {
  initialProjects: Project[];
  /** The server's per-request "now" — the timeline's forecast anchor, taken once so SSR
   *  and hydration agree (the ecosystem page's rule). */
  now: number;
  /** Program id → earliest phase-start ms, from `getProgramStartMs` — as entries,
   *  because a `Map` does not cross the RSC serialization boundary. */
  startEntries: [number, number][];
  regions?: string[];
  partnerTypes?: string[];
  /** Deep-link support (legacy ?minRisk / ?filter=active). */
  initialMinRisk?: number;
  initialSort?: 'risk' | null;
  initialActiveOnly?: boolean;
  /** Canonical shareable state (per-column params + sort/dir + q). */
  initialFilters?: Record<string, string[]>;
  initialTableSort?: TableSort | null;
  initialQ?: string;
}

const SHOW_SCORECARDS = false;

export default function ProgramsClient({ initialProjects, now, startEntries, initialMinRisk = 0, initialSort = null, initialActiveOnly = false, initialFilters, initialTableSort = null, initialQ = '' }: ProgramsClientProps) {
  const locale = useLocale();
  // Column filters live in the table headers (design.md: table filtering pattern).
  // The ?minRisk deep-link becomes a Health-column preselection.
  const [filters, setFilters] = useState<Record<string, string[]>>(() => ({
    // deep-linked (?filter=active) → the visible Status funnel, not a hidden predicate
    ...(initialActiveOnly ? { status: ['Active'] } : {}),
    ...(initialMinRisk >= 2
      ? { theNeedle: ['Concerned'] }
      : initialMinRisk === 1
        ? { theNeedle: ['Some Risk', 'Concerned'] }
        : {}),
    ...(initialFilters ?? {}),
  }));
  const [text, setText] = useState(initialQ);
  const [sort, setSort] = useState<TableSort | null>(initialTableSort);
  // Shareable URLs: filters, sort, and the filter box round-trip through the query
  // string. The legacy risk-sort deep link keeps its ?sort=risk form until the user
  // picks a column sort of their own.
  useTableUrlSync(filters, sort, {
    q: text || null,
    ...(initialSort === 'risk' && !sort ? { sort: 'risk' } : {}),
  });





  // Status = the lifecycle boundary's derivation (lib/lifecycle): explicit
  // active/complete/cancelled facts + archived visibility, one precedence order.
  const statusOf = deriveProgramStatus;
  const statusKeyOf = (v: string) =>
    v === 'Archived' ? ('archived' as const)
    : v === 'Cancelled' ? ('statusCancelled' as const)
    : v === 'Done' ? ('statusDone' as const)
    : ('statusActive' as const);

  // The free-text box is now DataTable's own key-column (program name) filter, so no
  // host-side text predicate remains — categorical slicing lives in the column funnels.
  // (This narrows the box to program name only; a partner name is reached via the
  // Partner funnel or its clickable cell — #86.)
  const projects = [...initialProjects];

  // Risk sort (deep-linked): worst health first, then least progressed.
  if (initialSort === 'risk') {
    projects.sort(
      (a, b) => healthOrder(b.theNeedle) - healthOrder(a.theNeedle) || a.hillChartProgress - b.hillChartProgress,
    );
  }

  // The table's rows with the derived Status column attached once — the ONE array both
  // DataTable and the timeline's filter pass below read, and the ONE site that calls
  // statusOf: the status funnel and the cell both read `row.status` from here.
  const rows: (Project & { status: string })[] = projects.map((p) => ({ ...p, status: statusOf(p) }));

  // The column set, extracted from the JSX so the timeline can apply the SAME funnels
  // DataTable renders — one predicate, two consumers (autoknow-ws1; lib/tableFilter).
  const headers: Header[] = [
    { key: 'name', label: t(locale, 'programName') },
    { key: 'partner.name', label: t(locale, 'partnerLabel'), filterable: true },
    {
      key: 'partner.region', label: t(locale, 'googleRegion'), filterable: true,
      filterValue: (row) => (row as Project).partner.region || t(locale, 'otherLabel'),
    },
    {
      // Keyed on the owner's id via the FK, not on the stored email (#127 E7).
      key: 'owner', label: t(locale, 'programOwner'), filterable: true,
      ...personRefFunnel(initialProjects, (p) => p.owner),
    },
    { key: 'sopDate', label: t(locale, 'targetSopHeader') },
    {
      key: 'sopOutlook', label: t(locale, 'sopOutlookHeader'), filterable: true,
      filterValue: (row) => (row as Project).sopOutlook,
      filterLabel: (v) => t(locale, SOP_OUTLOOK_KEY[v as SopBufferCategory]),
    },
    {
      key: 'theNeedle', label: t(locale, 'healthLabel'), filterable: true,
      // Canonicalize legacy values so "Low"/"On Track" collapse to one option.
      filterValue: (row) => formatNeedleValue((row as Project).theNeedle),
      filterLabel: (v) => t(locale, healthKey(v)),
    },
    { key: 'hillChartProgress', label: t(locale, 'progressLabel') },
    {
      // No filterValue: the default row['status'] lookup reads the token the `rows`
      // mapping attached, so the derivation stays single-sited there.
      key: 'status', label: t(locale, 'statusLabel'), filterable: true,
      filterLabel: (v) => t(locale, statusKeyOf(v)),
    },
  ];

  // The chart plots exactly the rows the table is showing: same rows, same columns, same
  // predicate, so the two surfaces cannot disagree under any filter combination — the
  // point of extracting lib/tableFilter. Pagination deliberately does NOT narrow it: a
  // page is a viewport over the filtered set, not a filter.
  const visible = applyTableFilter(rows, headers, filters, text);
  const timelineLayout = buildTimelineMarks(visible, new Map(startEntries), now);

  // Aggregations for dynamic scorecards
  const totalMatching = projects.length;
  const activeMatching = projects.filter(p => p.hillChartProgress < 100).length;
  
  // Total in-flight vs total overall projects
  const scorecardRatio = `${activeMatching} / ${totalMatching}`;

  // High/Critical risk count
  const highRiskCount = projects.filter((p) => {
    return healthOrder(p.theNeedle) >= 1;
  }).length;


  return (
    <div className={styles.clientWrapper}>
      {/* The one free-text filter (program name) and the "× Clear filters" reset are
          DataTable's own now (#86); every categorical filter lives in its column
          header (funnel = secondary action; clicking the label sorts). */}

      {/* Scorecards hidden for now (2026-07-18): count/risk added little over the
          table itself, and the ecosystem page owns the real big numbers. The
          average-progress card is gone for good — a mean across unlike programs
          reads as precision without meaning. Set SHOW_SCORECARDS to bring the
          remaining two back. */}
      {SHOW_SCORECARDS && (
        <section className={styles.scorecards}>
          <div className={styles.card}>
            <h3 data-eyebrow>{t(locale, 'programsInFlightAllTime')}</h3>
            <div className={styles.metric}>{scorecardRatio}</div>
            <div className={styles.subtext}>{t(locale, 'activeVsTotal')}</div>
          </div>

          <div className={styles.card}>
            <h3 data-eyebrow>{t(locale, 'someRiskConcerned')}</h3>
            <div className={styles.metric}>{highRiskCount}</div>
            <div className={styles.subtext}>{t(locale, 'atElevatedRisk')}</div>
          </div>
        </section>
      )}

      {/* The portfolio whisker chart, tracking the table (#159's second surface). Above
          the table so the reading order is the summary, then the records it summarizes. */}
      <section>
        <AnchorHeading id="timeline">{t(locale, 'programsTimelineTitle')}</AnchorHeading>
        <p className={local.sectionSub}>{t(locale, 'programsTimelineSub')}</p>
        <ProgramTimeline layout={timelineLayout} />
      </section>

      {/* Main Database Table */}
      <section className={styles.tableSection}>
        <DataTable
          headers={headers}
          data={rows}
          filters={filters}
          onFiltersChange={setFilters}
          textFilter={text}
          onTextFilterChange={setText}
          textFilterPlaceholder={t(locale, 'filterProgramsPlaceholder')}
          renderRow={(p: Project & { status: string }) => {
            return (
              <tr key={p.id}>
                <th scope="row">
                  <Link href={`/programs/${p.id}`} className={styles.tableLink}>
                    {p.name}
                  </Link>
                </th>
                <td>
                  <Link href={`/partners/${p.partner.id}`} className={styles.tableLink}>
                    {p.partner.name}
                  </Link>
                </td>
                <td>
                  {/* Region is a CLASS the program shares with others: the box is
                      the signal, and clicking it filters this column — never
                      navigates (design.md §6, issue #30). Matches the Partners table. */}
                  <button
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, 'partner.region': [p.partner.region || t(locale, 'otherLabel')] }))}
                    className={local.classFilterBtn}
                    title={t(locale, 'filterColumn', { c: t(locale, 'googleRegion') })}
                  >
                    <ClassBox className={local.classInk}>
                      {p.partner.region || t(locale, 'otherLabel')}
                    </ClassBox>
                  </button>
                </td>
                <td>
                  {/* An owner reads by NAME (#153) — the stored LDAP email is a storage
                      format. Resolved on the server through the FK (#127 E7). */}
                  <PersonCell person={p.owner} />
                </td>
                <td><DateCell value={p.sopDate} fallback={t(locale, 'tbd')} /></td>
                <td>
                  {p.sopOutlook === 'na' ? (
                    <span style={{ color: 'var(--muted)' }}>{t(locale, 'sopOutlookNa')}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setFilters((f) => ({ ...f, sopOutlook: [p.sopOutlook] }))}
                      className={styles.badgeFilterBtn}
                      title={t(locale, 'filterColumn', { c: t(locale, 'sopOutlookHeader') })}
                    >
                      <span className={styles.badge} style={{ color: SOP_OUTLOOK_COLOR[p.sopOutlook] }}>
                        {t(locale, SOP_OUTLOOK_KEY[p.sopOutlook])}
                      </span>
                    </button>
                  )}
                </td>
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
                  <button
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, status: [p.status] }))}
                    className={styles.badgeFilterBtn}
                    title={t(locale, 'filterColumn', { c: t(locale, 'statusLabel') })}
                  >
                    <span className={styles.typeText ?? ''} style={{ color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600 }}>
                      {t(locale, statusKeyOf(p.status))}
                    </span>
                  </button>
                </td>
              </tr>
            );
          }}
          defaultSortKey={initialTableSort?.key ?? (initialSort === 'risk' ? '' : 'name')}
          defaultSortOrder={initialTableSort?.dir ?? 'asc'}
          onSortChange={(key, dir) => setSort({ key, dir })}
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>
    </div>
  );
}
