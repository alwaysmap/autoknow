'use client';

import React, { useState } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DateCell from '../../components/DateCell';
import DataTable from '../../components/DataTable';
import styles from '../ecosystem-summary/EcosystemSummaryClient.module.css';
import local from './page.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { healthKey, healthColor, healthOrder } from '../../lib/health';
import { resolvePerson } from '../../lib/people';
import { deriveProgramStatus } from '../../lib/lifecycle';
import type { SopBufferCategory } from '../../lib/sop';
import { t, type StringKey } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';

// SOP-outlook column vocabulary: canonical token → localized label + ink. Only 'late'
// is colored (warn) — it's the bad news; the rest stay quiet so the column doesn't
// read as a field of warnings.
const SOP_OUTLOOK_KEY: Record<SopBufferCategory, StringKey> = {
  late: 'sopOutlookLate',
  ontrack: 'sopOutlookOnTrack',
  nosop: 'sopOutlookNoSop',
  na: 'sopOutlookNa',
};
const SOP_OUTLOOK_COLOR: Record<SopBufferCategory, string> = {
  late: 'var(--warn)',
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
  ownerName: string | null;
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
  forecast: {
    remainingPhases: number;
    sim: {
      p50: number;
      p85: number;
      p95: number;
    };
  };
}

interface Person {
  id: number;
  name: string;
  email: string;
}

interface ProgramsClientProps {
  initialProjects: Project[];
  people: Person[];
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

export default function ProgramsClient({ initialProjects, people, initialMinRisk = 0, initialSort = null, initialActiveOnly = false, initialFilters, initialTableSort = null, initialQ = '' }: ProgramsClientProps) {
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
  const [searchQuery, setSearchQuery] = useState(initialQ);
  const [sort, setSort] = useState<TableSort | null>(initialTableSort);
  // Shareable URLs: filters, sort, and the search box round-trip through the query
  // string. The legacy risk-sort deep link keeps its ?sort=risk form until the user
  // picks a column sort of their own.
  useTableUrlSync(filters, sort, {
    q: searchQuery || null,
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

  // Base predicates only — everything categorical lives in the column filters.
  const filteredProjects = initialProjects.filter((proj) => {
    // Active only (not archived, not done) — deep-linked from the ecosystem stats
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!proj.name.toLowerCase().includes(q) && !proj.partner.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Risk sort (deep-linked): worst health first, then least progressed.
  if (initialSort === 'risk') {
    filteredProjects.sort(
      (a, b) => healthOrder(b.theNeedle) - healthOrder(a.theNeedle) || a.hillChartProgress - b.hillChartProgress,
    );
  }

  // Aggregations for dynamic scorecards
  const totalMatching = filteredProjects.length;
  const activeMatching = filteredProjects.filter(p => p.hillChartProgress < 100).length;
  
  // Total in-flight vs total overall projects
  const scorecardRatio = `${activeMatching} / ${totalMatching}`;

  // High/Critical risk count
  const highRiskCount = filteredProjects.filter((p) => {
    return healthOrder(p.theNeedle) >= 1;
  }).length;


  return (
    <div className={styles.clientWrapper}>
      {/* One compact search input; every categorical filter lives in its column
          header (funnel = secondary action; clicking the label sorts). */}
      <div className={local.searchRow}>
        <input
          id="searchField"
          type="search"
          placeholder={t(locale, 'searchByNamePartner')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={local.searchInput}
        />
        {Object.values(filters).some((v) => v && v.length > 0) && (
          <button
            type="button"
            className={local.clearAll}
            onClick={() => setFilters({})}
          >
            ✕ {t(locale, 'clearAllFilters')}
          </button>
        )}
      </div>

      {/* Scorecards hidden for now (2026-07-18): count/risk added little over the
          table itself, and the ecosystem page owns the real big numbers. The
          average-progress card is gone for good — a mean across unlike programs
          reads as precision without meaning. Set SHOW_SCORECARDS to bring the
          remaining two back. */}
      {SHOW_SCORECARDS && (
        <section className={styles.scorecards}>
          <div className={styles.card}>
            <h3>{t(locale, 'programsInFlightAllTime')}</h3>
            <div className={styles.metric}>{scorecardRatio}</div>
            <div className={styles.subtext}>{t(locale, 'activeVsTotal')}</div>
          </div>

          <div className={styles.card}>
            <h3>{t(locale, 'someRiskConcerned')}</h3>
            <div className={styles.metric}>{highRiskCount}</div>
            <div className={styles.subtext}>{t(locale, 'atElevatedRisk')}</div>
          </div>
        </section>
      )}

      {/* Main Database Table */}
      <section className={styles.tableSection}>
        <DataTable
          headers={[
            { key: 'name', label: t(locale, 'programName') },
            { key: 'partner.name', label: t(locale, 'partnerLabel'), filterable: true },
            {
              key: 'partner.region', label: t(locale, 'googleRegion'), filterable: true,
              filterValue: (row) => (row as Project).partner.region || t(locale, 'otherLabel'),
            },
            { key: 'ownerName', label: t(locale, 'programOwner'), filterable: true },
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
              key: 'status', label: t(locale, 'statusLabel'), filterable: true,
              filterValue: (row) => statusOf(row as Project),
              filterLabel: (v) => t(locale, statusKeyOf(v)),
            }
          ]}
          data={filteredProjects.map((p) => ({ ...p, status: statusOf(p) }))}
          filters={filters}
          onFiltersChange={setFilters}
          renderRow={(p: Project) => {
            const matched = p.ownerName ? resolvePerson(people, p.ownerName) : null;

            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/programs/${p.id}`} className={styles.tableLink}>
                    {p.name}
                  </Link>
                </td>
                <td>
                  <Link href={`/partners/${p.partner.id}`} className={styles.tableLink}>
                    {p.partner.name}
                  </Link>
                </td>
                <td>{p.partner.region || t(locale, 'otherLabel')}</td>
                <td>
                  {(() => {
                    if (matched) {
                      return (
                        <Link href={`/people/${matched.id}`} className={styles.ownerLink}>
                          {p.ownerName}
                        </Link>
                      );
                    }
                    return p.ownerName;
                  })()}
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
                    onClick={() => setFilters((f) => ({ ...f, status: [statusOf(p)] }))}
                    className={styles.badgeFilterBtn}
                    title={t(locale, 'filterColumn', { c: t(locale, 'statusLabel') })}
                  >
                    <span className={styles.typeText ?? ''} style={{ color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600 }}>
                      {t(locale, statusKeyOf(statusOf(p)))}
                    </span>
                  </button>
                </td>
              </tr>
            );
          }}
          defaultSortKey={initialTableSort?.key ?? (initialSort === 'risk' ? '' : 'name')}
          defaultSortOrder={initialTableSort?.dir ?? 'asc'}
          onSortChange={(key, dir) => setSort({ key, dir })}
          pageSize={10}
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>
    </div>
  );
}
