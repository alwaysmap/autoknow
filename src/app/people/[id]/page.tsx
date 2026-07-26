import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import PersonAdminControls from '../../../components/PersonEditor';
import { initialsOf } from '../../../lib/people';
import { profileAsOf } from '../../../lib/profiles';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import styles from './page.module.css';
import AnchorHeading from '../../../components/AnchorHeading';
import PersonHistoryTable from './PersonHistoryTable';
import PersonProgramsTable, { type PersonProgramRow } from './PersonProgramsTable';

export const dynamic = 'force-dynamic';

// THE person page (the /me route is just a shortcut here for the signed-in user).
// A person is two facts: which companies they've been at (affiliations) and which
// programs they've worked on (owned as TEL, phase involvement, assigned actions).
// Maintenance lives behind the title kebab (PersonEditor), not a form farm.

export default async function PersonProfilePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const personId = parseInt(id);
  const locale = await getLocale();

  if (isNaN(personId)) {
    return notFound();
  }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: {
      affiliations: {
        include: { partner: true },
        orderBy: { startDate: 'desc' },
      },
      phaseInvolvements: {
        include: { phase: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
      },
      actionItems: {
        select: { phase: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
      },
    },
  });

  if (!person) {
    return notFound();
  }

  // The job held TODAY, decided ONCE for the whole page (#127 E5). The identity line
  // prints it and the History section below is its complement BY ROW ID — one decision,
  // so no period can land in both sections or in neither, which is how this page broke
  // before. Null is a real answer: a gap between jobs, or a hire starting next month.
  const profile = await profileAsOf(person.id);

  // Programs owned as TEL: ownerName is a free-text handle/email, so match the
  // person's email and its bare local-part/handle forms.
  const local = person.email.split('@')[0];
  const owned = await prisma.project.findMany({
    where: {
      OR: [person.email, `@${local}`, local].map((v) => ({
        ownerName: { equals: v, mode: 'insensitive' as const },
      })),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const partners = await prisma.partner.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  // For the Add-to-program dialog (lists hide archived — lib/lifecycle).
  const assignablePrograms = await prisma.project.findMany({
    where: { isArchived: false },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, phases: { orderBy: { id: 'asc' }, select: { id: true, name: true } } },
  });

  // Programs worked on: TEL ownership + phase-level involvement; phases reached via
  // assigned action items fill in history the involvement table doesn't cover.
  const programs = new Map<number, PersonProgramRow>();
  const rowFor = (project: { id: number; name: string }) => {
    const row = programs.get(project.id)
      ?? { id: project.id, name: project.name, tel: false, roles: [], roleSummary: '', phases: [] };
    programs.set(project.id, row);
    return row;
  };
  for (const p of owned) rowFor(p).tel = true;
  for (const inv of person.phaseInvolvements) {
    const row = rowFor(inv.phase.project);
    if (!row.phases.some((ph) => ph.id === inv.phase.id)) {
      row.phases.push({ id: inv.phase.id, name: inv.phase.name, role: inv.role });
    }
    // `PhasePerson.role` is nullable and repeats across a program's phases; the Role
    // column wants the distinct set, not one per phase.
    if (inv.role && !row.roles.includes(inv.role)) row.roles.push(inv.role);
  }
  for (const a of person.actionItems) {
    const row = rowFor(a.phase.project);
    if (!row.phases.some((ph) => ph.id === a.phase.id)) {
      row.phases.push({ id: a.phase.id, name: a.phase.name, role: null });
    }
  }
  // Unsorted: PersonProgramsTable owns the order (defaultSortKey="name"), and it sorts
  // during render, so the server HTML is already in that order.
  const programRows = [...programs.values()].map((r) => ({
    ...r,
    // The Role column's sort key. 'TEL' unlocalized on purpose: this is a sort value,
    // never rendered — the cell renders the badge and `telRole` carries the expansion.
    roleSummary: [r.tel ? 'TEL' : '', ...r.roles].filter(Boolean).join(', '),
  }));

  return (
    <div className={styles.container}>
      {/* Me-page profile grammar: initials avatar + name + identity line. */}
      <header className={styles.header}>
        <div className={styles.avatar}>{initialsOf(person.name)}</div>
        <div className={styles.profileInfo}>
          <div className={styles.titleRow}>
            <h1>{person.name}</h1>
            <PersonAdminControls personId={person.id} personName={person.name}
              personEmail={person.email} personNotes={person.notes}
              partners={partners} programs={assignablePrograms} />
          </div>
          <div className={styles.identLine}>
            {/* Company and role are ONE fact — the period covering today — so they are
                read off one row and appear or vanish together. The old pair could not:
                the company came from the `currentPartnerId` cache and the role from the
                affiliations, so a scheduled move printed the new employer beside the old
                job's title. With no period today the line is just the address; inventing
                a company would be the same lie the cache used to tell. */}
            {profile && (
              <>
                <Link href={`/partners/${profile.partnerId}`} className={styles.identCompany}>
                  {profile.partner.name}
                </Link>
                {profile.role && (
                  <>
                    <span className={styles.identSep}>·</span>
                    <span className={styles.identRole}>{profile.role}</span>
                  </>
                )}
                <span className={styles.identSep}>·</span>
              </>
            )}
            <a href={`mailto:${person.email}`} className={styles.identEmail}>{person.email}</a>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {person.notes && <p className={styles.notes}>{person.notes}</p>}

        <div className={styles.colMain}>
          <section className={styles.section}>
            <AnchorHeading id="programs" linkLabel={t(locale, 'anchorLink')}>
              {t(locale, 'navPrograms')}
            </AnchorHeading>
            <p className={styles.sectionIntro}>{t(locale, 'personProgramsIntro')}</p>
            {programRows.length === 0 ? (
              <p className={styles.empty}>{t(locale, 'noPartnerPrograms')}</p>
            ) : (
              <PersonProgramsTable locale={locale} rows={programRows} />
            )}
          </section>

          <section className={styles.section}>
            <AnchorHeading id="history" linkLabel={t(locale, 'anchorLink')}>
              {t(locale, 'historyLabel')}
            </AnchorHeading>
            {(() => {
              // The COMPLEMENT of the identity line, by row id — see the `profileAsOf`
              // call above for why it is a complement and not a second decision.
              //
              // A period that has not started yet lists here too — so this is NOT "prior"
              // companies — and its open end still renders as "Present", wrong for a job
              // beginning in November. Left alone on purpose: #124 §3 gives a scheduled
              // period its own affordance ("moves to Honda on 1 Nov 2026", with
              // edit/cancel), which is #127 E14. Dropping the row in the meantime would
              // read as the move having been cancelled — a worse lie than an early
              // "Present".
              const otherPeriods = person.affiliations.filter((a) => a.id !== profile?.id);
              if (otherPeriods.length === 0) {
                // "before {c}" only parses when there IS a current company to be before.
                return (
                  <p className={styles.empty}>
                    {profile
                      ? t(locale, 'noPriorCompanies', { c: profile.partner.name })
                      : t(locale, 'noAffiliations')}
                  </p>
                );
              }
              return (
                <PersonHistoryTable
                  locale={locale}
                  rows={otherPeriods.map((aff) => ({
                    id: aff.id,
                    partnerId: aff.partnerId,
                    partnerName: aff.partner.name,
                    role: aff.role,
                    startDate: aff.startDate.toISOString(),
                    endDate: aff.endDate ? aff.endDate.toISOString() : null,
                  }))}
                />
              );
            })()}
          </section>
        </div>
      </main>
    </div>
  );
}
