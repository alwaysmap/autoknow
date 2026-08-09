'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import ClassBox from '../../../components/ClassBox';
import { addPartners } from '../../actions/initiatives';
import type { ActionResult } from '../../../lib/actionResult';
import type { AddablePartnerRow } from '../../../lib/initiativeQueries';
import {
  PRODUCT_NAME_KEY,
  productShortLabel,
  type PartnerProductKey,
} from '../../../lib/partnerProducts';
import { partnerHref } from '../../../lib/entityHref';
import { t, type Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// Bulk add via filters (gh-286 part f): the partners NOT yet active members, on the
// shared DataTable with the partner-list grammar — name key column, type/region
// funnels — plus the derived Products funnel (lib/partnerProducts). The filter bar
// hosts the batch form: "Add N filtered partners" submits every VISIBLE row's id to
// the same `addPartners` action the per-row Add posts one id to; the action
// re-validates ids and skips existing members at the boundary (AGENTS lesson 3), so
// a stale row set degrades to a refusal or a no-op, never a double add.

// A row's funnel tokens per column, defined ONCE so the headers' filterValue/
// filterValues and the `visible` memo below can never disagree on a sentinel.
/** Products: the product keys, or 'none' so product-less partners stay
 *  addressable from the funnel rather than only by unselecting. */
const productTokens = (p: AddablePartnerRow): string[] =>
  p.products.length > 0 ? p.products : ['none'];
const typeToken = (p: AddablePartnerRow): string => p.typeName || '—';
const regionToken = (p: AddablePartnerRow): string => p.regionName || '—';

export default function AddPartnersTable({
  initiativeId,
  partners,
  locale,
}: {
  initiativeId: number;
  partners: AddablePartnerRow[];
  locale: Locale;
}) {
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [text, setText] = useState('');
  // The batch's optional target-month override. It lives in the filter bar, so the
  // bar's one "× Clear filters" resets it with the funnels (extrasActive below).
  const [month, setMonth] = useState('');
  const [state, formAction] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => addPartners(formData),
    {},
  );

  // The rows the table currently shows — the batch. Mirrors DataTable's own filter
  // semantics on the same controlled inputs (OR within a column, AND across columns,
  // case-insensitive substring on the key column), because the batch form needs the
  // ids and DataTable only renders rows; if those semantics ever change, this
  // predicate changes with them.
  const visible = useMemo(() => {
    const q = text.trim().toLowerCase();
    const selected = (key: string) => filters[key] ?? [];
    const pass = (key: string, values: string[]) =>
      selected(key).length === 0 || values.some((v) => selected(key).includes(v));
    return partners.filter(
      (p) =>
        pass('typeName', [typeToken(p)]) &&
        pass('regionName', [regionToken(p)]) &&
        pass('products', productTokens(p)) &&
        (!q || p.name.toLowerCase().includes(q)),
    );
  }, [partners, filters, text]);

  return (
    <>
      <DataTable
        headers={[
          { key: 'name', label: t(locale, 'partnerName'), width: '14rem' },
          { key: 'typeName', label: t(locale, 'partnerType'), filterable: true, filterValue: (row) => typeToken(row as AddablePartnerRow) },
          { key: 'regionName', label: t(locale, 'regionLabel'), filterable: true, filterValue: (row) => regionToken(row as AddablePartnerRow) },
          {
            key: 'products',
            label: t(locale, 'productsColumn'),
            filterable: true,
            // Canonical, locale-stable keys as tokens; the display name is
            // filterLabel-only (design.md §6 / lesson 3).
            filterValues: (row) => productTokens(row as AddablePartnerRow),
            filterLabel: (v) => (v === 'none' ? t(locale, 'none') : productShortLabel(locale, v as PartnerProductKey)),
            // The key holds an array — sorting would stringify it; sort the tokens.
            sortValue: (row) => productTokens(row as AddablePartnerRow).join(','),
          },
          { key: 'add', label: '', sortable: false },
        ]}
        data={partners}
        renderRow={(p) => (
          <tr key={p.id}>
            <th scope="row">
              <Link href={partnerHref(p.id)} className={styles.tableLink}>{p.name}</Link>
            </th>
            <td>
              {p.typeName ? (
                <button
                  onClick={() => setFilters({ ...filters, typeName: [p.typeName] })}
                  className={styles.classFilterBtn}
                  title={t(locale, 'filterByType', { t: p.typeName })}
                >
                  <ClassBox className={styles.classInk}>{p.typeName}</ClassBox>
                </button>
              ) : (
                <span className={styles.mutedCell}>—</span>
              )}
            </td>
            <td>
              <button
                onClick={() => setFilters({ ...filters, regionName: [p.regionName] })}
                className={styles.classFilterBtn}
                title={t(locale, 'filterColumn', { c: t(locale, 'regionLabel') })}
              >
                <ClassBox className={styles.classInk}>{p.regionName}</ClassBox>
              </button>
            </td>
            <td>
              {p.products.length > 0 ? (
                <span className={styles.productList}>
                  {p.products.map((k) => (
                    <button
                      key={k}
                      onClick={() => setFilters({ ...filters, products: [k] })}
                      className={styles.classFilterBtn}
                      title={t(locale, PRODUCT_NAME_KEY[k])}
                    >
                      <ClassBox className={styles.classInk}>{productShortLabel(locale, k)}</ClassBox>
                    </button>
                  ))}
                </span>
              ) : (
                <span className={styles.mutedCell}>—</span>
              )}
            </td>
            <td>
              {/* One id through the same action; the batch month rides along so the
                  bar's override means "adds from this table", not "only the button". */}
              <form action={formAction} className={styles.rowAddForm}>
                <input type="hidden" name="initiativeId" value={initiativeId} />
                <input type="hidden" name="partnerIds" value={p.id} />
                {month && <input type="hidden" name="targetMonth" value={month} />}
                <button
                  type="submit"
                  className={styles.rowAddBtn}
                  aria-label={t(locale, 'addPartnerRowAria', { p: p.name })}
                >
                  {t(locale, 'addPartnerRowAction')}
                </button>
              </form>
            </td>
          </tr>
        )}
        defaultSortKey="name"
        defaultSortOrder="asc"
        filters={filters}
        onFiltersChange={setFilters}
        textFilter={text}
        onTextFilterChange={setText}
        textFilterPlaceholder={t(locale, 'filterPartnersPlaceholder')}
        filterBarExtras={
          <form action={formAction} className={styles.bulkAddForm}>
            <input type="hidden" name="initiativeId" value={initiativeId} />
            <input type="hidden" name="partnerIds" value={visible.map((p) => p.id).join(',')} />
            <input
              type="month"
              name="targetMonth"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label={t(locale, 'initiativeTargetMonthLabel')}
              title={t(locale, 'initiativeTargetMonthLabel')}
            />
            <button type="submit" className={styles.addBtn} disabled={visible.length === 0}>
              {t(locale, 'bulkAddFilteredPartners', { n: visible.length })}
            </button>
          </form>
        }
        extrasActive={month !== ''}
        onClearExtras={() => setMonth('')}
        emptyStateMessage={t(locale, 'noPartnersMatchFilters')}
      />
      {state.error && <p role="alert" className={styles.formError}>{state.error}</p>}
    </>
  );
}
