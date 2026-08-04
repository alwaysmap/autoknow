import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import PersonAdminControls, { ScheduledChange } from '../../../components/PersonEditor';
import ActivityFeed from '../../../components/ActivityFeed';
import { hasTakenEffect, initialsOf } from '../../../lib/people';
import { getActivity } from '../../../lib/activity';
import { profileAsOf } from '../../../lib/profiles';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import styles from './page.module.css';
import AnchorHeading from '../../../components/AnchorHeading';
import PersonHistoryTable from './PersonHistoryTable';
import PersonProgramsTable from './PersonProgramsTable';
import { personProgramRows } from '../../../lib/personPrograms';
import { untrackedContext } from '../../../lib/untrackedContext';
import { getPersonEscalations } from '../../../lib/escalationQueries';
import EscalationRows from '../../../components/EscalationRows';

// THE person page BODY, rendered by TWO routes: `/people/:id` (any person, by id) and
// `/me` (the signed-in person, by session). Both render this — /me does NOT redirect,
// because /me is the stable address for a moving target and an id is not (autoknow-6q3).
// It is a component and not a duplicated page for the reason AGENTS lesson 7 gives: the
// identity line, Programs table and History section were changed FOUR times in #127 alone
// (E2a, E3, E5, E10), and a second copy would have silently kept the older of each pair.
//
// It stays HERE, not in src/components/, because the rest of this page is here: the two
// tables it renders and the stylesheet all three share are its siblings, and splitting the
// cluster to give /me a shorter import would put the parts of one page in two places. So
// /me reaches into this folder on purpose — the `[id]` in the path names the route the
// body came from, not a dependency on a route param. This component takes a personId and
// does not care where the caller got it.
//
// A person is two facts: which companies they've been at (affiliations) and which
// programs they've worked on (owned as TEL, phase involvement, assigned actions).
// Maintenance lives behind the title kebab (PersonEditor), not a form farm.

export default async function PersonProfile({ personId }: { personId: number }) {
  const locale = await getLocale();

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

  // The NEXT scheduled change, if any — the soonest period that has not started
  // (#127 E14). `hasTakenEffect` is the sanctioned JS spelling for "has this date
  // arrived", so the line here and `cancelScheduledPeriod`'s refusal cannot disagree
  // about whether a change is still cancellable. Affiliations are newest-start-first,
  // so the LAST future row is the soonest one.
  const scheduled = person.affiliations.filter((a) => !hasTakenEffect(a.startDate)).at(-1) ?? null;
  const scheduledDay = scheduled?.startDate.toISOString().slice(0, 10) ?? '';

  // Programs owned as TEL, by REFERENCE (#127 E7). This is #124's Class 4 defect and
  // its fix in one place: the query used to take `person.email`, strip it to a
  // local-part, and match those three spellings against the free-text `ownerName` —
  // so changing an address made every program owned under the old one VANISH from this
  // page, while another person whose handle happened to collide started matching. An
  // indexed join on `ownerPersonId` cannot do either.
  const owned = await prisma.project.findMany({
    where: { ownerPersonId: person.id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  // What this person RECORDED — the same shared feed the partner and program pages
  // render, scoped by actor instead of subject, each row labelled with the job held on
  // ITS OWN day (ADR a-dated-row-is-labelled-as-of-its-own-date).
  const activity = await getActivity({ kind: 'person', id: person.id });

  // What is ON THIS PERSON'S PLATE (#245 section C decision 9/10): every escalation
  // where they are owner, decision maker, OR requested-of. Renders here rather than in a
  // /me-only panel because this component IS both routes — see the file header.
  const escalations = await getPersonEscalations(person.id);

  // Who is already tracked (under EVERY address they have held) and who has been
  // dismissed — the two things the pure detector cannot know (#127 E15).
  const untracked = await untrackedContext();

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
  // assigned action items fill in history the involvement table doesn't cover. Since
  // #127 E11 each row also carries the affiliation held at the time of the involvement,
  // resolved in lib/personPrograms against the career fetched above — which is why the
  // assembly moved there: the dating is a rule with tests, not a rendering choice.
  // Unsorted: PersonProgramsTable owns the order (defaultSortKey="name"), and it sorts
  // during render, so the server HTML is already in that order.
  const programRows = await personProgramRows({
    owned,
    phaseInvolvements: person.phaseInvolvements,
    actionItems: person.actionItems,
    career: person.affiliations,
  });

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
              personPartnerId={profile?.partnerId ?? null} personRole={profile?.role ?? null}
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
          {/* A SCHEDULED change, visible and cancellable (#127 E14, spec #124 §3): a
              pending change nobody can see is Class 1 in a new costume. It sits under
              the identity line it will replace, which is where the reader is already
              looking to find out where this person works. */}
          {scheduled && (
            <div className={styles.scheduledLine}>
              <ScheduledChange
                personId={person.id}
                affiliationId={scheduled.id}
                partnerName={scheduled.partner.name}
                dateIso={scheduledDay}
                partners={partners}
                seed={{
                  name: person.name, email: person.email, notes: person.notes,
                  partnerId: scheduled.partnerId, role: scheduled.role,
                  // The SAME day the line prints: re-recording at the change's own
                  // effective date is how it is corrected, so the dialog must open on it.
                  effectiveDate: scheduledDay,
                }}
              />
            </div>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {person.notes && <p className={styles.notes}>{person.notes}</p>}

        <div className={styles.colMain}>
          <section className={styles.section}>
            <AnchorHeading id="programs">
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
            {/* What is on THIS person's plate (#245 section C) — owner, decision maker,
                or requested-of, oldest-open-first via the shared query. Reads right after
                Programs and before career History: it is current work, not a record. */}
            <AnchorHeading id="escalations">
              {t(locale, 'escalationsLabel')}
            </AnchorHeading>
            <EscalationRows escalations={escalations} locale={locale} />
          </section>

          <section className={styles.section}>
            <AnchorHeading id="history">
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

          <section className={styles.section}>
            <AnchorHeading id="activity">
              {t(locale, 'navActivity')}
            </AnchorHeading>
            {/* The intro states the feed's limit rather than absorbing it — see
                `personActivityIntro` in lib/i18n for why it has to. */}
            <p className={styles.sectionIntro}>{t(locale, 'personActivityIntro')}</p>
            {/* #127 E15: the person feed is the densest prose surface in the app, so it
                is where an untracked colleague is most likely to be named. */}
            <ActivityFeed items={activity} untracked={{ ctx: untracked, partners }} />
          </section>
        </div>
      </main>
    </div>
  );
}
