'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import DateCell from '../../components/DateCell';
import DataTable from '../../components/DataTable';
import HillChartControl from '../../components/HillChartControl';
import styles from '../ecosystem-summary/EcosystemSummaryClient.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { HEALTHS, HEALTH_KEY, healthKey, healthColor, healthOrder } from '../../lib/health';
import { resolvePerson } from '../../lib/people';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
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
  /** Deep-link support (e.g. the ecosystem High-risk list's "More →"). */
  initialMinRisk?: number;
  initialSort?: 'risk' | null;
  initialActiveOnly?: boolean;
}

const SHOW_SCORECARDS = false;

export default function ProgramsClient({ initialProjects, people, regions = [], partnerTypes = [], initialMinRisk = 0, initialSort = null, initialActiveOnly = false }: ProgramsClientProps) {
  const locale = useLocale();
  // Column filters live in the table headers (design.md: table filtering pattern).
  // The ?minRisk deep-link becomes a Health-column preselection.
  const [filters, setFilters] = useState<Record<string, string[]>>(
    initialMinRisk >= 2
      ? { theNeedle: ['Concerned'] }
      : initialMinRisk === 1
        ? { theNeedle: ['Some Risk', 'Concerned'] }
        : {},
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeOnly] = useState(initialActiveOnly); // deep-linked (?filter=active)





  // Base predicates only — everything categorical lives in the column filters.
  const filteredProjects = initialProjects.filter((proj) => {
    // Active only (not archived, not done) — deep-linked from the ecosystem stats
    if (activeOnly && (proj.isArchived || proj.hillChartProgress >= 100)) return false;
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
      <div className={styles.searchRow}>
        <input
          id="searchField"
          type="search"
          placeholder={t(locale, 'searchByNamePartner')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={styles.searchInput}
        />
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
              key: 'theNeedle', label: t(locale, 'healthLabel'), filterable: true,
              // Canonicalize legacy values so "Low"/"On Track" collapse to one option.
              filterValue: (row) => formatNeedleValue((row as Project).theNeedle),
              filterLabel: (v) => t(locale, healthKey(v)),
            },
            { key: 'hillChartProgress', label: t(locale, 'progressLabel') }
          ]}
          data={filteredProjects}
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
              </tr>
            );
          }}
          defaultSortKey={initialSort === 'risk' ? '' : 'name'}
          pageSize={10}
          emptyStateMessage={t(locale, 'noProgramsMatchFilters')}
        />
      </section>
    </div>
  );
}
