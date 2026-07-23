'use client';

import { useState, useMemo } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import ClassBox from '../../components/ClassBox';
import { NewPartnerButton } from '../../components/PartnerEditor';
import KebabMenu from '../../components/KebabMenu';
import PageShell from '../../components/PageShell';
import { RelationshipCell } from '../../components/RelationshipScale';
import { parseScore, clampScore, REL_KEY } from '../../lib/relationship';
import { deriveEmail, normalizeHandle } from '../../lib/auth';
import { resolvePerson } from '../../lib/people';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import styles from './page.module.css';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  ownerName: string | null;
}

interface Person {
  id: number;
  name: string;
  email: string;
}

interface Affiliation {
  person: Person;
}

interface Partner {
  id: number;
  name: string;
  type: string;
  region: string;
  projects: Project[];
  currentEmployees: Person[];
  personAffiliations: Affiliation[];
}

interface Option {
  id: number;
  name: string;
}

interface PartnersClientProps {
  partners: Partner[];
  currentUser: string;
  people: Person[];
  /** partnerId → latest score + oldest→newest history (see lib/relationship). */
  relationship: Record<number, { score: number | null; history: number[] }>;
  types: Option[];
  regions: Option[];
  /** Deep-linked column-filter preselection (?type= / ?region=), design.md §6. */
  initialFilters?: Record<string, string[]>;
  initialSort?: TableSort | null;
  initialMine?: boolean;
  /** Deep-linked key-column (partner name) filter text (?q=). */
  initialQ?: string;
}

export default function PartnersClient({ partners, currentUser, people, relationship, types, regions, initialFilters, initialSort, initialMine = false, initialQ = '' }: PartnersClientProps) {
  const locale = useLocale();
  // Column filters are controlled here so type/region cell clicks can set them.
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const [myPartnersOnly, setMyPartnersOnly] = useState<boolean>(initialMine);
  const [text, setText] = useState(initialQ);
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);
  // every filter/sort choice is shareable — the URL mirrors the view (filters, sort,
  // the ownership toggle, and the key-column filter text)
  useTableUrlSync(filters, sort, { mine: myPartnersOnly ? '1' : null, q: text || null });

  // Derive the current user's canonical email/handle once for filtering.
  const userEmail = useMemo(() => deriveEmail(currentUser), [currentUser]);
  const userHandle = useMemo(() => normalizeHandle(currentUser), [currentUser]);

  // Whether a project owner / employee / affiliate string refers to the current user.
  // Base predicate only; type/region live in the per-column funnel filters. The
  // ownership test lives inside the memo so it closes over only the stable primitives
  // (userEmail/userHandle) — matches on canonical email or bare handle, never a name
  // substring (which previously made "My partners" include people whose name merely
  // contained the handle).
  const filteredPartners = useMemo(() => {
    const isCurrentUser = (value: string | null | undefined) =>
      !!value && (deriveEmail(value) === userEmail || normalizeHandle(value) === userHandle);
    const isMyPartner = (partner: Partner) =>
      partner.projects.some((p) => isCurrentUser(p.ownerName)) ||
      partner.currentEmployees.some((e) => isCurrentUser(e.email)) ||
      partner.personAffiliations.some((pa) => isCurrentUser(pa.person.email));
    return partners.filter((partner) => !myPartnersOnly || isMyPartner(partner));
  }, [partners, myPartnersOnly, userEmail, userHandle]);

  // Map partners to displayable data structure
  const displayData = useMemo(() => {
    return filteredPartners.map((partner) => {
      const activePrograms = partner.projects.filter((p) => !p.isArchived).length;
      const lifetimePrograms = partner.projects.length;

      // Extract unique TELs
      const tels = Array.from(
        new Set(partner.projects.map((p) => p.ownerName).filter(Boolean))
      ) as string[];

      // Extract unique team member emails
      const team = Array.from(
        new Set([
          ...partner.currentEmployees.map((e) => e.email),
          ...partner.personAffiliations.map((pa) => pa.person.email),
        ])
      ).filter(Boolean) as string[];

      return {
        id: partner.id,
        name: partner.name,
        type: partner.type,
        region: partner.region,
        // Numeric for sorting; 0 = never rated, sorts below every real score.
        relationship: relationship[partner.id]?.score ?? 0,
        activePrograms,
        lifetimePrograms,
        tels,
        team,
      };
    });
  }, [filteredPartners, relationship]);

  return (
    <PageShell
      title={t(locale, 'partnersLabel')}
      maxWidth="62.5rem"
      actions={
        <KebabMenu ariaLabel={t(locale, 'moreActions')}>
          <NewPartnerButton types={types} regions={regions} />
        </KebabMenu>
      }
    >
        {/* Partners table list. The key-column filter box, the "My partners" scope
            toggle, and the one "× Clear filters" reset all live in DataTable's own
            filter bar now (#86) — the toggle rides in via filterBarExtras. */}
        <section className={styles.tableSection}>
          <DataTable
            headers={[
              { key: 'name', label: t(locale, 'partnerName') },
              { key: 'type', label: t(locale, 'partnerType'), filterable: true, filterValue: (row) => (row as { type: string }).type || '—' },
              { key: 'region', label: t(locale, 'regionLabel'), filterable: true, filterValue: (row) => (row as { region: string }).region || '—' },
              {
                key: 'relationship',
                label: t(locale, 'relationshipLabel'),
                filterable: true,
                // Canonical, locale-stable token — the score digit, or 'unrated'. The
                // display label is filterLabel-only, so a shared ?relationship=2 URL
                // names the same class in every locale (design.md §2 / lesson 3). Digits
                // sort before 'unrated', so the funnel lists Critical→Exemplary, then
                // Not rated — and the ecosystem relationship-mix tiles deep-link here
                // with the same tokens.
                filterValue: (row) => {
                  const score = (row as { relationship: number }).relationship;
                  return score === 0 ? 'unrated' : String(score);
                },
                filterLabel: (v) => (v === 'unrated' ? t(locale, 'relNotRated') : t(locale, REL_KEY[clampScore(Number(v))])),
              },
              { key: 'activePrograms', label: t(locale, 'activePrograms') },
              { key: 'lifetimePrograms', label: t(locale, 'lifetimePrograms') },
              { key: 'tels', label: t(locale, 'telsHeader') },
              { key: 'team', label: t(locale, 'teamLabel') },
            ]}
            data={displayData}
            renderRow={(p) => (
              <tr key={p.id}>
                <th scope="row">
                  <Link href={`/partners/${p.id}`} className={styles.tableLink}>
                    {p.name}
                  </Link>
                </th>
                <td>
                  {p.type ? (
                    <button
                      onClick={() => setFilters({ ...filters, type: [p.type] })}
                      className={styles.typeFilterBtn}
                      title={t(locale, 'filterByType', { t: p.type })}
                    >
                      <ClassBox className={styles.classInk}>{p.type}</ClassBox>
                    </button>
                  ) : (
                    <span className={styles.typeText}>—</span>
                  )}
                </td>
                <td>
                  {p.region ? (
                    <button
                      onClick={() => setFilters({ ...filters, region: [p.region] })}
                      className={styles.typeFilterBtn}
                      title={t(locale, 'filterColumn', { c: t(locale, 'regionLabel') })}
                    >
                      <ClassBox className={styles.classInk}>{p.region}</ClassBox>
                    </button>
                  ) : (
                    <span className={styles.typeText}>—</span>
                  )}
                </td>
                <td>
                  {/* aligned 1..7 tracks: relative relationship health, scannable down the column */}
                  <RelationshipCell
                    score={parseScore(relationship[p.id]?.score)}
                    history={relationship[p.id]?.history}
                  />
                </td>
                <td>
                  {/* One measure per cell (§6): the bare count is the value; the header
                      supplies "Active Programs", and the noun lives in the accessible name. */}
                  <Link
                    href={`/partners/${p.id}?filter=active`}
                    className={styles.activeProgramsLink}
                    aria-label={t(locale, p.activePrograms === 1 ? 'activeProgramsAriaOne' : 'activeProgramsAria', { n: p.activePrograms })}
                  >
                    {p.activePrograms}
                  </Link>
                </td>
                <td>
                  <Link
                    href={`/partners/${p.id}`}
                    className={styles.lifetimeProgramsLink}
                    aria-label={t(locale, p.lifetimePrograms === 1 ? 'lifetimeProgramsAriaOne' : 'lifetimeProgramsAria', { n: p.lifetimePrograms })}
                  >
                    {p.lifetimePrograms}
                  </Link>
                </td>
                <td>
                  <div className={styles.telList}>
                    {p.tels.length === 0 ? (
                      <span className={styles.empty}>{t(locale, 'none')}</span>
                    ) : (
                      p.tels.map((tel: string, idx: number) => {
                        const matched = resolvePerson(people, tel);
                        return (
                          <span key={tel}>
                            {idx > 0 && ', '}
                            {matched ? (
                              <Link href={`/people/${matched.id}`} className={styles.telLink}>
                                {tel}
                              </Link>
                            ) : (
                              tel
                            )}
                          </span>
                        );
                      })
                    )}
                  </div>
                </td>
                <td>
                  <div className={styles.telList}>
                    {p.team.length === 0 ? (
                      <span className={styles.empty}>{t(locale, 'none')}</span>
                    ) : (
                      p.team.map((email: string, idx: number) => {
                        const matched = resolvePerson(people, email);
                        return (
                          <span key={email}>
                            {idx > 0 && ', '}
                            {matched ? (
                              <Link href={`/people/${matched.id}`} className={styles.telLink}>
                                {matched.name}
                              </Link>
                            ) : (
                              email.split('@')[0]
                            )}
                          </span>
                        );
                      })
                    )}
                  </div>
                </td>
              </tr>
            )}
            defaultSortKey={initialSort?.key ?? 'name'}
            defaultSortOrder={initialSort?.dir ?? 'asc'}
            onSortChange={(key, dir) => setSort({ key, dir })}
            filters={filters}
            onFiltersChange={setFilters}
            textFilter={text}
            onTextFilterChange={setText}
            textFilterPlaceholder={t(locale, 'filterPartnersPlaceholder')}
            // "My partners" is a scope switch, not a column — it rides in the filter
            // bar and the one reset clears it alongside the funnels and the text.
            filterBarExtras={
              <label htmlFor="myPartnersCheckbox" className={styles.toolbarToggle}>
                <input
                  id="myPartnersCheckbox"
                  type="checkbox"
                  checked={myPartnersOnly}
                  onChange={(e) => setMyPartnersOnly(e.target.checked)}
                />
                {t(locale, 'myPartners')}
              </label>
            }
            extrasActive={myPartnersOnly}
            onClearExtras={() => setMyPartnersOnly(false)}
            emptyStateMessage={t(locale, 'noPartnersMatchFilters')}
          />
        </section>
    </PageShell>
  );
}
