'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import { NewPartnerButton } from '../../components/PartnerEditor';
import { RelationshipCell } from '../../components/RelationshipScale';
import { parseScore } from '../../lib/relationship';
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
  /** partnerId → latest/previous relationship score (see lib/relationship). */
  relationship: Record<number, { score: number | null; prev: number | null }>;
  types: Option[];
  regions: Option[];
}

export default function PartnersClient({ partners, currentUser, people, relationship, types, regions }: PartnersClientProps) {
  const locale = useLocale();
  const [selectedType, setSelectedType] = useState<string>('All');
  const [myPartnersOnly, setMyPartnersOnly] = useState<boolean>(false);

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

  // Filter partners list
  const filteredPartners = useMemo(() => {
    return partners.filter((partner) => {
      if (selectedType !== 'All' && partner.type !== selectedType) {
        return false;
      }
      if (myPartnersOnly && !isMyPartner(partner)) {
        return false;
      }
      return true;
    });
  }, [partners, selectedType, myPartnersOnly, currentUser]);

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
        <div className={styles.userLabel}>
          {t(locale, 'loggedUser')} <code>{currentUser}</code>
        </div>
        <NewPartnerButton types={types} regions={regions} />
      </header>

      <main className={styles.main}>
        {/* Filters Widget panel */}
        <section className={styles.filterSection}>
          <div className={styles.filterGroup}>
            <label htmlFor="typeSelect" className={styles.filterLabel}>
              {t(locale, 'partnerType')}:
            </label>
            <select
              id="typeSelect"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className={styles.select}
            >
              <option value="All">{t(locale, 'allTypes')}</option>
              <option value="OEM">OEM</option>
              <option value="Supplier">Supplier</option>
            </select>
          </div>

          <div className={styles.checkboxGroup}>
            <input
              id="myPartnersCheckbox"
              type="checkbox"
              checked={myPartnersOnly}
              onChange={(e) => setMyPartnersOnly(e.target.checked)}
              className={styles.checkbox}
            />
            <label htmlFor="myPartnersCheckbox" className={styles.checkboxLabel}>
              {t(locale, 'myPartners')}
            </label>
          </div>
        </section>

        {/* Partners table list */}
        <section className={styles.tableSection}>
          <DataTable
            headers={[
              { key: 'name', label: t(locale, 'partnerName') },
              { key: 'type', label: t(locale, 'partnerType') },
              { key: 'relationship', label: t(locale, 'relationshipLabel') },
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
                  <button
                    onClick={() => setSelectedType(p.type)}
                    className={styles.typeFilterBtn}
                    title={t(locale, 'filterByType', { t: p.type })}
                  >
                    <span
                      className={`${styles.badge} ${
                        p.type === 'OEM' ? styles.oemBadge : styles.supplierBadge
                      }`}
                    >
                      {p.type}
                    </span>
                  </button>
                </td>
                <td>
                  {/* aligned 1..7 tracks: relative relationship health, scannable down the column */}
                  <RelationshipCell
                    score={parseScore(relationship[p.id]?.score)}
                    previousScore={parseScore(relationship[p.id]?.prev)}
                  />
                </td>
                <td>
                  <Link href={`/partners/${p.id}?filter=active`} className={styles.activeProgramsLink}>
                    <strong>{p.activePrograms}</strong> {t(locale, 'activeSuffix')}
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
            defaultSortKey="name"
            pageSize={10}
            emptyStateMessage={t(locale, 'noPartnersMatchFilters')}
          />
        </section>
      </main>
    </div>
  );
}
