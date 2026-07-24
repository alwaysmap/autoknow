'use client';

import React from 'react';
import Link from 'next/link';
import { t, Locale } from '../lib/i18n';
import { tNodes, joinNodes } from './tNodes';
import AnchorHeading from './AnchorHeading';
import DataTable from './DataTable';
import type { BusiestRow, BusiestProgramRef } from '../lib/chainLedger';
import styles from './BusiestResources.module.css';

// Ecosystem block: "Busiest people and partners" (docs/CRITICAL_CHAIN_VIEW_PLAN.md
// §4c/§4d) — the cross-portfolio decision surface. Each row ends with a computed
// "Consider:" line built from the row's own facts; a row with nothing to suggest
// says so and gets none.
//
// Renders through the shared DataTable (#125): this was the app's last hand-rolled
// `<table>`, so the §6 grammar had to be re-derived here and drifted. A record is one
// or TWO `<tr>`s — the optional "Consider:" line is a full-width second row — which
// `renderRow` supports because it returns a ReactNode, and which is why paging would
// count rows rather than records. It never pages: MAX_ROWS caps the set at the call
// site, so `paginate={false}` (see the prop's own doc for why that is declared here
// and not derived).
//
// What #140 may change: the CONTENT of these columns, not the frame.

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

  // Every entity mention links (design.md §2) — tNodes puts the links inside the
  // localized sentences.
  const progLink = (p: BusiestProgramRef) => <Link href={`/programs/${p.programId}`}>{p.programName}</Link>;
  const considerLine = (r: BusiestRow): React.ReactNode | null => {
    const rowLink = <Link href={href(r)}>{r.name}</Link>;
    if (r.kind === 'person' && r.movable.length > 0) {
      const programs = joinNodes(r.movable.map((p) =>
        tNodes(locale, 'clProgWithBuffer', { name: progLink(p), d: p.bufferDays ?? 0 })));
      const base = tNodes(locale, 'clConsiderPerson', { name: rowLink, programs });
      return r.constraintIn.length > 1
        ? <>{base} {tNodes(locale, 'clConsiderTiebreak', { program: progLink(r.constraintIn[0]) })}</>
        : base;
    }
    // The staffing ask only means something when one company is split across
    // SEVERAL programs — a single-program partner has nothing to rebalance.
    if (r.kind === 'partner' && r.gatesSingleSop && r.constraintIn.length + r.alsoActiveIn.length >= 2) {
      return tNodes(locale, 'clConsiderPartner', {
        n: r.constraintIn.length + r.alsoActiveIn.length,
        name: rowLink,
        program: progLink(r.constraintIn[0]),
      });
    }
    return null;
  };

  return (
    <section className={styles.wrapper} data-testid="busiest-resources">
      <AnchorHeading id="busiest-resources" linkLabel={t(locale, 'anchorLink')} className={styles.title}>
        {t(locale, 'clBusiest')}
      </AnchorHeading>
      <p className={styles.intro}>{t(locale, 'clBusiestIntro')}</p>
      <DataTable
        headers={[
          { key: 'name', label: t(locale, 'clWho') },
          // Sorting a cell that holds a LIST of programs would order rows by an
          // arbitrary member of that list; the rows already arrive ranked by exposure.
          { key: 'constraintIn', label: t(locale, 'clGatingSop'), sortable: false },
          { key: 'alsoActiveIn', label: t(locale, 'clAlsoActiveIn'), sortable: false },
          { key: 'exposure', label: t(locale, 'clBufferChange'), sortable: false },
        ]}
        data={visible}
        paginate={false}
        // Empty: keep the exposure order buildBusiestResources already applied.
        defaultSortKey=""
        renderRow={(r: BusiestRow) => {
            const consider = considerLine(r);
            return (
              <React.Fragment key={`${r.kind}${r.id}`}>
                <tr className={consider ? styles.hasConsider : undefined}>
                  <th scope="row"><Link href={href(r)}>{r.name}</Link></th>
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
        }}
      />
      <p className={styles.legend}>{t(locale, 'clBusiestLegend')}</p>
    </section>
  );
}
