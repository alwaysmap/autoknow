'use client';

import { useState, useMemo } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import { NewPartnerButton } from '../../components/PartnerEditor';
import KebabMenu from '../../components/KebabMenu';
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
}

export default function PartnersClient({ partners, currentUser, people, relationship, types, regions, initialFilters, initialSort, initialMine = false }: PartnersClientProps) {
  const locale = useLocale();
  // Column filters are controlled here so type/region cell clicks can set them.
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const [myPartnersOnly, setMyPartnersOnly] = useState<boolean>(initialMine);
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);
  // every filter/sort choice is shareable — the URL mirrors the view
  useTableUrlSync(filters, sort, { mine: myPartnersOnly ? '1' : null });

  // Derive the current user's canonical email/handle once for filtering.
  const userEmail = useMemo(() => deriveEmail(currentUser), [currentUser]);
  const userHandle = useMemo(() => normalizeHandle(currentUser), [currentUser]);

  // Whether a project owner / employee / affiliate string refers to the current user.
  // Matches on canonical email or bare handle only — never a name substring (which
  // previously made "My partners" include people whose name merely contained the handle).
  const isCurrentUser = (value: string | null | undefined) => {
    if (!value) return false;
    return deriveEmail(value) === userEmail || normalizeHandle(value) === userHandle;
  };

  const isMyPartner = (partner: Partner) => {
    const isTel = partner.projects.some((p) => isCurrentUser(p.ownerName));
    if (isTel) return true;

    const isEmployee = partner.currentEmployees.some((e) => isCurrentUser(e.email));
    if (isEmployee) return true;

    return partner.personAffiliations.some((pa) => isCurrentUser(pa.person.email));
  };

  // Base predicate only; type/region live in the per-column funnel filters.
  const filteredPartners = useMemo(() => {
    return partners.filter((partner) => !myPartnersOnly || isMyPartner(partner));
  }, [partners, myPartnersOnly, currentUser]);

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
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{t(locale, 'partnersLabel')}</h1>
        <KebabMenu ariaLabel={t(locale, 'moreActions')}>
          <NewPartnerButton types={types} regions={regions} />
        </KebabMenu>
      </header>

      <main className={styles.main}>
        {/* Column filtering lives in the funnels; this slim row carries only the
            ownership toggle (not a column) and the reset for everything at once. */}
        <div className={styles.toolbar}>
          <label htmlFor="myPartnersCheckbox" className={styles.toolbarToggle}>
            <input
              id="myPartnersCheckbox"
              type="checkbox"
              checked={myPartnersOnly}
              onChange={(e) => setMyPartnersOnly(e.target.checked)}
            />
            {t(locale, 'myPartners')}
          </label>
          {(myPartnersOnly || Object.values(filters).some((v) => v && v.length > 0)) && (
            <button
              type="button"
              className={styles.clearAll}
              onClick={() => { setFilters({}); setMyPartnersOnly(false); }}
            >
              ✕ {t(locale, 'clearAllFilters')}
            </button>
          )}
        </div>

        {/* Partners table list */}
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
                filterValue: (row) => {
                  const score = (row as { relationship: number }).relationship;
                  return score === 0 ? t(locale, 'relNotRated') : `${score} — ${t(locale, REL_KEY[clampScore(score)])}`;
                },
              },
              { key: 'activePrograms', label: t(locale, 'activePrograms') },
              { key: 'lifetimePrograms', label: t(locale, 'lifetimePrograms') },
              { key: 'tels', label: t(locale, 'telsHeader') },
              { key: 'team', label: t(locale, 'teamLabel') },
            ]}
            data={displayData}
            renderRow={(p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/partners/${p.id}`} className={styles.tableLink}>
                    {p.name}
                  </Link>
                </td>
                <td>
                  {p.type ? (
                    <button
                      onClick={() => setFilters({ ...filters, type: [p.type] })}
                      className={styles.typeFilterBtn}
                      title={t(locale, 'filterByType', { t: p.type })}
                    >
                      <span className={styles.typeText}>{p.type}</span>
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
                      <span className={styles.typeText}>{p.region}</span>
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
                  <Link href={`/partners/${p.id}?filter=active`} className={styles.activeProgramsLink}>
                    {p.activePrograms} {t(locale, 'activeSuffix')}
                  </Link>
                </td>
                <td>
                  <Link href={`/partners/${p.id}`} className={styles.lifetimeProgramsLink}>
                    {t(locale, 'lifetimeSuffix', { n: p.lifetimePrograms })}
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
            pageSize={10}
            emptyStateMessage={t(locale, 'noPartnersMatchFilters')}
          />
        </section>
      </main>
    </div>
  );
}
