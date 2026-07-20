'use client';

import React from 'react';
import Link from 'next/link';
import { t, Locale } from '../lib/i18n';
import type { BusiestRow, BusiestProgramRef } from '../lib/chainLedger';
import styles from './BusiestResources.module.css';

// Ecosystem block: "Busiest people and partners" (docs/CRITICAL_CHAIN_VIEW_PLAN.md
// §4c/§4d) — the cross-portfolio decision surface. Each row ends with a computed
// "Consider:" line built from the row's own facts; a row with nothing to suggest
// says so and gets none.

interface BusiestResourcesProps {
  locale: Locale;
  rows: BusiestRow[];
}

const MAX_ROWS = 8;

const href = (row: BusiestRow) => (row.kind === 'partner' ? `/partners/${row.id}` : `/people/${row.id}`);
const sopYear = (p: BusiestProgramRef) => (p.sopDate ? `’${p.sopDate.slice(2, 4)}` : '');

export default function BusiestResources({ locale, rows }: BusiestResourcesProps) {
  // Only rows leadership can act on: gating an SOP somewhere, or split across
  // several programs at once.
  const visible = rows
    .filter((r) => r.constraintIn.length > 0 || r.constraintIn.length + r.alsoActiveIn.length >= 2)
    .slice(0, MAX_ROWS);
  if (visible.length === 0) return null;

  const considerLine = (r: BusiestRow): string | null => {
    if (r.kind === 'person' && r.movable.length > 0) {
      const programs = r.movable
        .map((p) => t(locale, 'clProgWithBuffer', { name: p.programName, d: p.bufferDays ?? 0 }))
        .join(', ');
      const base = t(locale, 'clConsiderPerson', { name: r.name, programs });
      return r.constraintIn.length > 1
        ? `${base} ${t(locale, 'clConsiderTiebreak', { program: r.constraintIn[0].programName })}`
        : base;
    }
    // The staffing ask only means something when one company is split across
    // SEVERAL programs — a single-program partner has nothing to rebalance.
    if (r.kind === 'partner' && r.gatesSingleSop && r.constraintIn.length + r.alsoActiveIn.length >= 2) {
      return t(locale, 'clConsiderPartner', {
        n: r.constraintIn.length + r.alsoActiveIn.length,
        name: r.name,
        program: r.constraintIn[0].programName,
      });
    }
    return null;
  };

  return (
    <section className={styles.wrapper} data-testid="busiest-resources">
      <h2 className={styles.title}>{t(locale, 'clBusiest')}</h2>
      <p className={styles.intro}>{t(locale, 'clBusiestIntro')}</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t(locale, 'clWho')}</th>
            <th>{t(locale, 'clGatingSop')}</th>
            <th>{t(locale, 'clAlsoActiveIn')}</th>
            <th>{t(locale, 'clBufferChange')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const consider = considerLine(r);
            return (
              <React.Fragment key={`${r.kind}${r.id}`}>
                <tr className={consider ? styles.hasConsider : undefined}>
                  <td><Link href={href(r)}>{r.name}</Link></td>
                  <td>
                    {r.constraintIn.length === 0
                      ? <span className={styles.muted}>—</span>
                      : r.constraintIn.map((p, i) => (
                        <span key={p.programId}>
                          {i > 0 && ', '}
                          <Link href={`/programs/${p.programId}`}>{p.programName}</Link>
                        </span>
                      ))}
                  </td>
                  <td>
                    {r.alsoActiveIn.length === 0
                      ? <span className={styles.muted}>—</span>
                      : (
                        <>
                          {r.alsoActiveIn.slice(0, 2).map((p, i) => (
                            <span key={p.programId}>
                              {i > 0 && ', '}
                              <Link href={`/programs/${p.programId}`}>{p.programName}</Link>
                            </span>
                          ))}
                          {r.alsoActiveIn.length > 2 && (
                            <span className={styles.muted}> · {t(locale, 'clNMore', { n: r.alsoActiveIn.length - 2 })}</span>
                          )}
                        </>
                      )}
                  </td>
                  <td className={styles.num}>
                    {r.constraintIn.length === 0
                      ? <span className={styles.muted}>{t(locale, 'clNoChangeCell')}</span>
                      : r.constraintIn.map((p) => (
                        <div key={p.programId}>
                          {(p.fourWeekDeltaDays ?? 0) < 0
                            ? <span className={styles.loss}>{t(locale, 'clLostDays', { name: p.programName, d: -(p.fourWeekDeltaDays ?? 0) })}</span>
                            : <span className={styles.muted}>{p.programName}: {t(locale, 'clNoChangeCell')}</span>}
                          {p.volumeFirstYear > 0 && (
                            <span className={styles.muted}>
                              {' · '}
                              {t(locale, 'clUnitsIn', { units: p.volumeFirstYear.toLocaleString(locale), year: sopYear(p) })}
                              {p.products.length > 0 ? ` · ${p.products.join(', ')}` : ''}
                            </span>
                          )}
                        </div>
                      ))}
                  </td>
                </tr>
                {consider && (
                  <tr className={styles.consider}>
                    <td colSpan={4}>{consider}</td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <p className={styles.legend}>{t(locale, 'clBusiestLegend')}</p>
    </section>
  );
}
