'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
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

interface PartnersClientProps {
  partners: Partner[];
  currentUser: string;
  people: Person[];
}

export default function PartnersClient({ partners, currentUser, people }: PartnersClientProps) {
  const [selectedType, setSelectedType] = useState<string>('All');
  const [myPartnersOnly, setMyPartnersOnly] = useState<boolean>(false);

  // Derive user email and handle for filtering
  const userEmail = useMemo(() => {
    if (currentUser.includes('@')) {
      return currentUser.startsWith('@') ? `${currentUser.replace('@', '')}@google.com` : currentUser;
    }
    return `${currentUser}@google.com`;
  }, [currentUser]);

  const userHandle = useMemo(() => {
    return currentUser.replace('@', '').toLowerCase();
  }, [currentUser]);

  // Helper check to determine if a partner belongs to the current user
  const isMyPartner = (partner: Partner) => {
    const isTel = partner.projects.some((p) => {
      if (!p.ownerName) return false;
      const ownerClean = p.ownerName.toLowerCase().replace('@', '');
      return (
        p.ownerName.toLowerCase() === currentUser.toLowerCase() ||
        ownerClean === userHandle ||
        p.ownerName.toLowerCase() === userEmail.toLowerCase()
      );
    });

    if (isTel) return true;

    const isEmployee = partner.currentEmployees.some(
      (e) => e.email.toLowerCase() === userEmail.toLowerCase() || e.name.toLowerCase().includes(userHandle)
    );

    if (isEmployee) return true;

    const isAffiliated = partner.personAffiliations.some(
      (pa) =>
        pa.person.email.toLowerCase() === userEmail.toLowerCase() ||
        pa.person.name.toLowerCase().includes(userHandle)
    );

    return isAffiliated;
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
        activePrograms,
        lifetimePrograms,
        tels,
        team,
      };
    });
  }, [filteredPartners]);

  // Person resolver logic to build biography page links
  const resolvePerson = (tel: string) => {
    const clean = tel.toLowerCase().replace('@', '').trim();
    return people.find((p) => {
      const emailHandle = p.email.split('@')[0].toLowerCase();
      const pName = p.name.toLowerCase();
      return (
        p.email.toLowerCase() === clean ||
        emailHandle === clean ||
        pName.includes(clean)
      );
    });
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Partners</h1>
        <div className={styles.userLabel}>
          Logged User: <code>{currentUser}</code>
        </div>
      </header>

      <main className={styles.main}>
        {/* Filters Widget panel */}
        <section className={styles.filterSection}>
          <div className={styles.filterGroup}>
            <label htmlFor="typeSelect" className={styles.filterLabel}>
              Partner Type:
            </label>
            <select
              id="typeSelect"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className={styles.select}
            >
              <option value="All">All Types</option>
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
              My partners
            </label>
          </div>
        </section>

        {/* Partners table list */}
        <section className={styles.tableSection}>
          <DataTable
            headers={[
              { key: 'name', label: 'Partner Name' },
              { key: 'type', label: 'Partner Type' },
              { key: 'activePrograms', label: 'Active Programs' },
              { key: 'lifetimePrograms', label: 'Lifetime Programs' },
              { key: 'tels', label: 'Technical Engagement Leads' },
              { key: 'team', label: 'Team' },
            ]}
            data={displayData}
            renderRow={(p: any) => (
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
                    title={`Filter by ${p.type}`}
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
                  <Link href={`/partners/${p.id}?filter=active`} className={styles.activeProgramsLink}>
                    <strong>{p.activePrograms}</strong> active
                  </Link>
                </td>
                <td>
                  <Link href={`/partners/${p.id}`} className={styles.lifetimeProgramsLink}>
                    {p.lifetimePrograms} lifetime
                  </Link>
                </td>
                <td>
                  <div className={styles.telList}>
                    {p.tels.length === 0 ? (
                      <span className={styles.empty}>None</span>
                    ) : (
                      p.tels.map((tel: string, idx: number) => {
                        const matched = resolvePerson(tel);
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
                      <span className={styles.empty}>None</span>
                    ) : (
                      p.team.map((email: string, idx: number) => {
                        const matched = resolvePerson(email);
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
            emptyStateMessage="No ecosystem partners found matching filters."
          />
        </section>
      </main>
    </div>
  );
}
