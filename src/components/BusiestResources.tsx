'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { t, Locale } from '../lib/i18n';
import { tNodes, joinNodes } from './tNodes';
import AnchorHeading from './AnchorHeading';
import DataTable from './DataTable';
import PersonCell from './PersonCell';
import { partnerHref } from '../lib/entityHref';
import type { BusiestRow, BusiestProgramRef } from '../lib/chainLedger';
import styles from './BusiestResources.module.css';

// Ecosystem block: "Busiest people and partners" (docs/CRITICAL_CHAIN_VIEW_PLAN.md
// §4c/§4d) — the cross-portfolio decision surface. Each row ends with a computed
// "Consider:" line built from the row's own facts; a row with nothing to suggest
// says so and gets none.
//
// A ROW EARNS ITS SPACE BY HAVING SOMETHING TO SAY (2026-08-03, user report): the
// table shipped with most rows reading "no change — nothing to do here", which costs a
// reader attention and returns none (§1's data-ink argument). The rows worth the space
// are the ones carrying a recommendation OR actually losing buffer; the rest COLLAPSE
// behind a count rather than being deleted, because "gating an SOP with nobody to
// rebalance" is a real state and silently dropping it would hide the constraint nobody
// can fix. `earnsSpace` is derived from `considerFor` — the same nodes the rows render —
// so the filter and the "Consider:" line can never disagree about which rows have one.
//
// Renders through the shared DataTable (#125). A record is one or TWO rows — the
// optional "Consider:" line is a full-width second one — which `renderRow` supports
// because it returns a ReactNode, and which is why paging here would count rows rather
// than records. It never pages anyway: MAX_ROWS caps the set at this call site, which
// is what `paginate={false}` is for.

interface BusiestResourcesProps {
  locale: Locale;
  rows: BusiestRow[];
}

const MAX_ROWS = 8;

/**
 * A busiest-resource row is a partner OR a person, so its identity cell is the one place
 * in this table where the person rule applies (#153): a person goes through PersonCell —
 * which owns the name, the route, and the plain-text fallback — and a partner keeps its
 * own link. One helper so the `<th>` and the "consider" sentence below it can never
 * disagree about how the same resource is written.
 */
const RowLink = ({ row }: { row: BusiestRow }) =>
  row.kind === 'partner'
    ? <Link href={partnerHref(row.id)}>{row.name}</Link>
    : <PersonCell person={{ id: row.id, name: row.name }} />;
const sopYear = (p: BusiestProgramRef) => (p.sopDate ? `’${p.sopDate.slice(2, 4)}` : '');

/** React needs a string; nothing else here does — `considerFor` is keyed by the row
 *  OBJECT, which cannot be spelled wrong. */
const rowKey = (r: BusiestRow) => `${r.kind}${r.id}`;

/** Losing buffer on any program it gates. The second half of `earnsSpace`: a row with no
 *  recommendation still earns the space when the SOP it gates is actively slipping — that
 *  is the constraint nobody can rebalance, which is the most important row here, not the
 *  least. A row gating an SOP that is NOT slipping has nothing to act on today. */
const losingBuffer = (r: BusiestRow) => r.constraintIn.some((p) => (p.fourWeekDeltaDays ?? 0) < 0);

export default function BusiestResources({ locale, rows }: BusiestResourcesProps) {
  const [showQuiet, setShowQuiet] = useState(false);

  // Everything this section will CONSIDER showing: gating an SOP somewhere, or split
  // across several programs at once, capped and already ranked by exposure. Which of
  // these earn the space is `earnsSpace` below — the cap runs first, so the disclosure
  // only ever covers rows that were going to render anyway.
  const candidates = rows
    .filter((r) => r.constraintIn.length > 0 || r.constraintIn.length + r.alsoActiveIn.length >= 2)
    .slice(0, MAX_ROWS);

  // Every entity mention links (design.md §2) — tNodes puts the links inside the
  // localized sentences.
  const progLink = (p: BusiestProgramRef) => <Link href={`/programs/${p.programId}`}>{p.programName}</Link>;
  const considerLine = (r: BusiestRow): React.ReactNode | null => {
    const rowLink = <RowLink row={r} />;
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

  // Computed ONCE per row and read by both the filter and the renderer — `considerLine`
  // builds ReactNodes, and a second call site deciding "does this row have one?" by a
  // parallel predicate is the same-control-twice trap (AGENTS lesson 7) with a silent
  // failure mode: the two would drift and rows would collapse while still rendering
  // advice.
  const considerFor = new Map(candidates.map((r) => [r, considerLine(r)] as const));
  const earnsSpace = (r: BusiestRow) => considerFor.get(r) != null || losingBuffer(r);
  const actionable = candidates.filter(earnsSpace);
  const quiet = candidates.filter((r) => !earnsSpace(r));

  // Nothing to act on anywhere is not a finding worth a heading (§7: a heading that
  // restates what the content obviously is gets deleted) — and a section reading
  // "12 people are busy and none of it matters" is the exact cost this change removes.
  // The component already returned null on an empty set; this widens the same contract.
  if (actionable.length === 0) return null;

  const shown = showQuiet ? [...actionable, ...quiet] : actionable;

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
        data={shown}
        paginate={false}
        // Empty: keep the exposure order buildBusiestResources already applied.
        defaultSortKey=""
        renderRow={(r: BusiestRow) => {
          const consider = considerFor.get(r);
          return (
            <React.Fragment key={rowKey(r)}>
              <tr className={consider ? styles.hasConsider : undefined}>
                <th scope="row"><RowLink row={r} /></th>
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
      {quiet.length > 0 && (
        // Collapsed, not deleted: the rows are still reachable, they just stop spending
        // the reader's attention. A plain <button> — the panel/menu grammar
        // (`AnchoredPopover`) is for something that opens OVER the page, and this reveals
        // rows in place.
        <button
          type="button"
          className={styles.quietToggle}
          aria-expanded={showQuiet}
          data-testid="busiest-quiet-toggle"
          onClick={() => setShowQuiet((v) => !v)}
        >
          {t(locale, showQuiet ? 'clBusiestQuietHide' : 'clBusiestQuietShow', { n: quiet.length })}
        </button>
      )}
      <p className={styles.legend}>{t(locale, 'clBusiestLegend')}</p>
    </section>
  );
}
