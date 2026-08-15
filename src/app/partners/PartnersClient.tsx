'use client';

import { useState, useMemo } from 'react';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import ClassBox from '../../components/ClassBox';
import { NewPartnerButton } from '../../components/PartnerEditor';
import PageShell from '../../components/PageShell';
import { RelationshipCell } from '../../components/RelationshipScale';
import { parseScore, clampScore, REL_KEY } from '../../lib/relationship';
import { PersonList, type PersonRef } from '../../components/PersonCell';
import { deriveEmail, normalizeHandle } from '../../lib/auth';
import type { PersonLike } from '../../lib/people';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import styles from './page.module.css';

interface Project {
  id: number;
  name: string;
  isArchived: boolean;
  /** The Googler owner as an ENTITY, resolved server-side from `Project.ownerPersonId`
   *  (#127 E7) — was the stored `ownerName` email, which this component matched against
   *  the signed-in user's derived address and deduped as a raw string. */
  owner: PersonRef | null;
}

/** Structurally `RosterMember` from lib/profiles, redeclared because this is a client
 *  component and that module is server-only. Keep the two in step. */
interface RosterMember {
  id: number;
  name: string;
  email: string;
}

interface Partner {
  id: number;
  name: string;
  type: string;
  region: string;
  projects: Project[];
  /** Who is at this partner TODAY — the as-of roster (lib/partnerQueries), not everyone
   *  who ever was. */
  team: RosterMember[];
}

interface Option {
  id: number;
  name: string;
}

interface PartnersClientProps {
  partners: Partner[];
  currentUser: string;
  /** Who "me" is as a PERSON row, resolved once on the server (see partners/page.tsx).
   *  The "My partners" scope tests program ownership by REFERENCE against this (#127
   *  E7); it used to compare derived email strings, so a program owned under an address
   *  its owner had left dropped out of the scope entirely (#124 Class 4). Null when the
   *  signed-in user (or the `?user=` view-as override) matches no Person. */
  currentUserPersonId: number | null;
  /** The org's own email domain, resolved on the server (`orgEmailDomain()`). REQUIRED,
   *  and passed rather than read: `AUTH_ALLOWED_DOMAIN` is not inlined into the browser
   *  bundle, so `deriveEmail`'s default would expand every handle at the dev fallback
   *  here and quietly match the wrong people on any non-Google tenant (gh-255,
   *  docs/knowledge/an-env-derived-default-is-the-fallback-inside-a-client-component.md).
   *  Optional-with-a-default would reintroduce that the first time somebody forgot it. */
  emailDomain: string;
  people: PersonLike[];
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

export default function PartnersClient({ partners, currentUser, currentUserPersonId, emailDomain, people, relationship, types, regions, initialFilters, initialSort, initialMine = false, initialQ = '' }: PartnersClientProps) {
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
  const userEmail = useMemo(() => deriveEmail(currentUser, emailDomain), [currentUser, emailDomain]);
  const userHandle = useMemo(() => normalizeHandle(currentUser), [currentUser]);

  // Whether a ROSTER MEMBER's address refers to the current user. Base predicate only;
  // type/region live in the per-column funnel filters. It lives inside the memo so it
  // closes over only the stable primitives (userEmail/userHandle) — matches on canonical
  // email or bare handle, never a name substring (which previously made "My partners"
  // include people whose name merely contained the handle). Program OWNERSHIP no longer
  // comes through here at all: it is an id comparison against the FK (#127 E7).
  const filteredPartners = useMemo(() => {
    const isCurrentUser = (value: string | null | undefined) =>
      !!value && (deriveEmail(value, emailDomain) === userEmail || normalizeHandle(value) === userHandle);
    const isMyPartner = (partner: Partner) =>
      // Ownership by REFERENCE (#127 E7); membership still by address, because a roster
      // member IS an address on this surface and has no such reference to key on.
      partner.projects.some((p) => p.owner != null && p.owner.id === currentUserPersonId) ||
      partner.team.some((member) => isCurrentUser(member.email));
    return partners.filter((partner) => !myPartnersOnly || isMyPartner(partner));
  }, [partners, myPartnersOnly, userEmail, userHandle, emailDomain, currentUserPersonId]);

  // Map partners to displayable data structure
  const displayData = useMemo(() => {
    return filteredPartners.map((partner) => {
      const activePrograms = partner.projects.filter((p) => !p.isArchived).length;
      const lifetimePrograms = partner.projects.length;

      // The distinct owners across this partner's programs, deduped by PERSON ID (#127
      // E7) — deduping the stored strings listed one human twice once they had held two
      // addresses, and could not tell two people apart who shared a local part.
      const tels = [
        ...new Map(
          partner.projects.flatMap((p) => (p.owner ? [[p.owner.id, p.owner] as const] : [])),
        ).values(),
      ];

      // Team member emails. The Set is belt-and-braces: the as-of predicate SELECTS one
      // period per person, but nothing constrains the data to have only one, so an
      // overlap authored elsewhere must not print a name twice.
      const team = Array.from(new Set(partner.team.map((member) => member.email)));

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
      actions={<NewPartnerButton types={types} regions={regions} />}
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
              {
                // The cell holds PEOPLE now, so the column says how to sort them —
                // by name, which is what it shows. Without this, sorting stringifies a
                // `PersonRef[]` and every row compares equal (see DataTable.sortValue).
                key: 'tels', label: t(locale, 'telsHeader'),
                sortValue: (row) =>
                  (row as (typeof displayData)[number]).tels.map((tel) => tel.name).join(', '),
              },
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
                {/* Both person columns render through the SAME cell now (#153). They
                    used to disagree with each other one column apart: TELs printed the
                    raw email, Team printed the name. */}
                <td>
                  <div className={styles.telList}>
                    <PersonList persons={p.tels} emptyLabel={t(locale, 'none')} />
                  </div>
                </td>
                <td>
                  <div className={styles.telList}>
                    <PersonList values={p.team} people={people} emptyLabel={t(locale, 'none')} />
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
