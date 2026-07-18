import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import PersonAdminControls from '../../../components/PersonEditor';
import { phaseColor } from '../../../lib/phase';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// THE person page (the /me route is just a shortcut here for the signed-in user).
// A person is two facts: which companies they've been at (affiliations) and which
// programs they've worked on (owned as TEL, phase involvement, assigned actions).
// Maintenance lives behind the title kebab (PersonEditor), not a form farm.

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

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
      currentPartner: true,
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
  interface ProgramRow {
    id: number;
    name: string;
    tel: boolean;
    phases: { id: number; name: string; role: string | null }[];
  }
  const programs = new Map<number, ProgramRow>();
  const rowFor = (project: { id: number; name: string }) => {
    const row = programs.get(project.id) ?? { id: project.id, name: project.name, tel: false, phases: [] };
    programs.set(project.id, row);
    return row;
  };
  for (const p of owned) rowFor(p).tel = true;
  for (const inv of person.phaseInvolvements) {
    const row = rowFor(inv.phase.project);
    if (!row.phases.some((ph) => ph.id === inv.phase.id)) {
      row.phases.push({ id: inv.phase.id, name: inv.phase.name, role: inv.role });
    }
  }
  for (const a of person.actionItems) {
    const row = rowFor(a.phase.project);
    if (!row.phases.some((ph) => ph.id === a.phase.id)) {
      row.phases.push({ id: a.phase.id, name: a.phase.name, role: null });
    }
  }
  const programRows = [...programs.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className={styles.container}>
      {/* Me-page profile grammar: initials avatar + name + identity line. */}
      <header className={styles.header}>
        <div className={styles.avatar}>{initialsOf(person.name)}</div>
        <div className={styles.profileInfo}>
          <div className={styles.titleRow}>
            <h1>{person.name}</h1>
            <PersonAdminControls personId={person.id} personName={person.name} partners={partners} programs={assignablePrograms} />
          </div>
          <div className={styles.identLine}>
            <Link href={`/partners/${person.currentPartnerId}`} className={styles.identCompany}>
              {person.currentPartner.name}
            </Link>
            {(() => {
              // current role rides the identity line — History below is PRIOR companies
              const active = person.affiliations.find((a) => !a.endDate && a.partnerId === person.currentPartnerId);
              return active?.role ? (
                <>
                  <span className={styles.identSep}>·</span>
                  <span className={styles.identRole}>{active.role}</span>
                </>
              ) : null;
            })()}
            <span className={styles.identSep}>·</span>
            <a href={`mailto:${person.email}`} className={styles.identEmail}>{person.email}</a>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {person.notes && <p className={styles.notes}>{person.notes}</p>}

        <div className={styles.colMain}>
          <section className={styles.section}>
            <h2>{t(locale, 'navPrograms')}</h2>
            {programRows.length === 0 ? (
              <p className={styles.empty}>{t(locale, 'noPartnerPrograms')}</p>
            ) : (
              <div className={styles.rows}>
                {programRows.map((prog) => (
                  <div key={prog.id} className={styles.progRow}>
                    <Link href={`/programs/${prog.id}`} className={styles.progName}>{prog.name}</Link>
                    {prog.tel && <span className={styles.telMark}>TEL</span>}
                    <span className={styles.phaseChips}>
                      {prog.phases.map((ph) => (
                        <Link key={ph.id} href={`/history/phase/${ph.id}`} className={styles.phaseChip}
                          title={ph.role ? `${ph.name} · ${ph.role}` : ph.name}>
                          <span className={styles.phaseDot} style={{ background: phaseColor(ph.id) }} />
                          {ph.name}
                          {ph.role && <span className={styles.phaseRole}>{ph.role}</span>}
                        </Link>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h2>{t(locale, 'historyLabel')}</h2>
            {(() => {
              // prior companies only — the current post lives in the identity line
              const prior = person.affiliations.filter(
                (a) => a.endDate != null || a.partnerId !== person.currentPartnerId,
              );
              if (prior.length === 0) {
                return <p className={styles.empty}>{t(locale, 'noPriorCompanies', { c: person.currentPartner.name })}</p>;
              }
              return (
              <div className={styles.rows}>
                {prior.map((aff) => {
                  const startStr = new Date(aff.startDate).toLocaleDateString(locale, { year: 'numeric', month: 'short' });
                  const endStr = aff.endDate
                    ? new Date(aff.endDate).toLocaleDateString(locale, { year: 'numeric', month: 'short' })
                    : t(locale, 'present');
                  return (
                    <div key={aff.id} className={styles.row}>
                      <span className={styles.rowDates}>{startStr} – {endStr}</span>
                      <Link href={`/partners/${aff.partnerId}`} className={styles.rowCompany}>{aff.partner.name}</Link>
                      <span className={styles.rowRole}>{aff.role}</span>
                    </div>
                  );
                })}
              </div>
              );
            })()}
          </section>
        </div>
      </main>
    </div>
  );
}
