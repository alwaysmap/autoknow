import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import AnchorHeading from '../../../components/AnchorHeading';
import ClassBox from '../../../components/ClassBox';
import DateCell from '../../../components/DateCell';
import PersonCell, { type PersonRef } from '../../../components/PersonCell';
import EscalationAdminControls from '../../../components/EscalationEditor';
import {
  ORG_LEVEL_KEY,
  SEVERITY_KEY,
  STATUS_DISPLAY_KEY,
  isClosed,
  type EscalationOrgLevel,
  type EscalationSeverity,
  type EscalationStatus,
} from '../../../lib/escalation';
import { escalationHref, partnerHref, programHref } from '../../../lib/entityHref';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// One escalation (#245 part a). design.md §4's two-column detail shape: a reading column
// carrying the editable STATEMENT and, below it, the ORIGINAL REQUEST exactly as it was
// raised; a rail of one-line facts beside it (§7).
//
// The two blocks of prose are the page's whole point, and #245 decision 4 is why they are
// two rather than one: `originalRequest` is provenance — the record of what was actually
// asked, in the words it was asked in — while `title`/`summary` are the cleaned-up version
// somebody tidied afterwards. Showing only the tidy one loses the evidence; showing only
// the raw one leaves an unreadable page. Neither can overwrite the other, so both are here,
// and only one of them has an edit affordance.

interface PageProps {
  params: Promise<{ id: string }>;
}

/** A one-line label:value fact for the rail (§7). Rendered by a helper rather than by
 *  hand nine times, so the label casing and the empty state cannot drift row to row. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.factRow}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{children}</span>
    </div>
  );
}

export default async function EscalationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const escalationId = Number(id);
  if (!Number.isInteger(escalationId) || escalationId <= 0) notFound();

  const locale = await getLocale();

  const escalation = await prisma.escalation.findUnique({
    where: { id: escalationId },
    include: {
      partner: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      ownerPerson: { select: { id: true, name: true } },
      decisionMakerPerson: { select: { id: true, name: true } },
      requestedOfPerson: { select: { id: true, name: true } },
      duplicateOf: { select: { id: true, title: true } },
      // The ingested chat thread. `url` is what makes the source clickable; `addedBy` is
      // who brought it in, which is the attribution the original-request block carries when
      // `raisedBy` is absent (a manually created escalation has neither).
      contextUrl: { select: { id: true, url: true, title: true, addedBy: true } },
    },
  });
  if (!escalation) notFound();

  // The pickers the ⋯ menu's dialogs need. Archived programs are hidden from pickers, the
  // rule every other list follows (lib/lifecycle's `visibleInLists`).
  const [partners, projects, people, otherEscalations] = await Promise.all([
    prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.project.findMany({
      where: { isArchived: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.person.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    // Candidates for "duplicate of": every OTHER escalation. Excluded by id rather than
    // filtered in the component, so the option this row could pick to become its own
    // duplicate never reaches the client at all — the zod refinement is the backstop, not
    // the only guard.
    prisma.escalation.findMany({
      where: { id: { not: escalationId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true },
      take: 200,
    }),
  ]);

  const status = escalation.status as EscalationStatus;
  const closed = isClosed(status);

  const person = (p: PersonRef | null) => (
    <PersonCell person={p} fallback={<span className={styles.empty}>{t(locale, 'escUnassigned')}</span>} />
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1>{escalation.title}</h1>
          <EscalationAdminControls
            escalation={{
              id: escalation.id,
              title: escalation.title,
              summary: escalation.summary,
              status,
              severity: escalation.severity as EscalationSeverity | null,
              orgLevel: escalation.orgLevel as EscalationOrgLevel | null,
              partnerId: escalation.partnerId,
              projectId: escalation.projectId,
              ownerPersonId: escalation.ownerPersonId,
              decisionMakerPersonId: escalation.decisionMakerPersonId,
              requestedOfPersonId: escalation.requestedOfPersonId,
            }}
            partners={partners}
            projects={projects}
            people={people}
            openEscalations={otherEscalations.map((e) => ({ id: e.id, name: e.title }))}
          />
        </div>
        {/* What this is ABOUT, as navigation (§2: no plain-text dead ends). */}
        <div className={styles.identLine}>
          <ClassBox className={styles.classInk}>{t(locale, STATUS_DISPLAY_KEY[status])}</ClassBox>
          {escalation.partner && (
            <>
              <span className={styles.identSep}>·</span>
              <Link href={partnerHref(escalation.partner.id)} className={styles.identLink}>
                {escalation.partner.name}
              </Link>
            </>
          )}
          {escalation.project && (
            <>
              <span className={styles.identSep}>·</span>
              <Link href={programHref(escalation.project.id)} className={styles.identLink}>
                {escalation.project.name}
              </Link>
            </>
          )}
          <span className={styles.identSep}>·</span>
          <span>
            {escalation.sourceKind === 'chat'
              ? t(locale, 'escSourceChat')
              : t(locale, 'escSourceManual')}
          </span>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.colMain}>
          <section className={styles.section}>
            <AnchorHeading id="statement" linkLabel={t(locale, 'anchorLink')}>
              {t(locale, 'escSummaryLabel')}
            </AnchorHeading>
            {escalation.summary
              ? <p className={styles.prose}>{escalation.summary}</p>
              : <p className={styles.proseMuted}>{t(locale, 'noNote')}</p>}
          </section>

          {/* Provenance. Rendered ONLY when there is one: a manually created escalation has
              no original request, and an empty quoted block would imply something was lost. */}
          {escalation.originalRequest && (
            <section className={styles.section}>
              <AnchorHeading id="original-request" linkLabel={t(locale, 'anchorLink')}>
                {t(locale, 'escOriginalRequest')}
              </AnchorHeading>
              <blockquote className={styles.original}>
                <p className={styles.originalText}>{escalation.originalRequest}</p>
              </blockquote>
              <p className={styles.hint}>{t(locale, 'escOriginalRequestHint')}</p>
              {escalation.contextUrl && (
                <p className={styles.hint}>
                  {/* The source is an EXTERNAL link (chat.google.com), so it opens away
                      from the app; the caveat beside it says what that thread is to us —
                      a snapshot, never a watch (docs/SCALING_LIMITS.md §3). */}
                  <a
                    href={escalation.contextUrl.url}
                    className={styles.factLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t(locale, 'escSourceThread')}
                  </a>
                  {' — '}
                  {t(locale, 'escThreadSnapshotNote')}
                </p>
              )}
            </section>
          )}
        </div>

        <aside className={styles.sidebar}>
          <div className={styles.sidebarCard}>
            <Fact label={t(locale, 'escSeverityLabel')}>
              {escalation.severity
                ? <ClassBox className={styles.classInk}>{t(locale, SEVERITY_KEY[escalation.severity as EscalationSeverity])}</ClassBox>
                : <span className={styles.empty}>{t(locale, 'escUntriaged')}</span>}
            </Fact>
            <Fact label={t(locale, 'escOrgLevelLabel')}>
              {escalation.orgLevel
                ? <ClassBox className={styles.classInk}>{t(locale, ORG_LEVEL_KEY[escalation.orgLevel as EscalationOrgLevel])}</ClassBox>
                : <span className={styles.empty}>{t(locale, 'escUntriaged')}</span>}
            </Fact>
            <Fact label={t(locale, 'escOwner')}>{person(escalation.ownerPerson)}</Fact>
            <Fact label={t(locale, 'escDecisionMaker')}>{person(escalation.decisionMakerPerson)}</Fact>
            <Fact label={t(locale, 'escRequestedOf')}>{person(escalation.requestedOfPerson)}</Fact>
            <Fact label={t(locale, 'escRaisedBy')}>
              {/* `raisedBy` is a stored ADDRESS with no Person relation (a webhook has no
                  session), so it renders through PersonCell's text branch — which prints
                  the local part, never the whole address (#153). Falls back to whoever
                  brought the source in when the escalation itself records nobody. */}
              <PersonCell
                value={escalation.raisedBy ?? escalation.contextUrl?.addedBy ?? null}
                people={[]}
                fallback={<span className={styles.empty}>—</span>}
              />
            </Fact>
            <Fact label={t(locale, 'escRaisedOn')}>
              <DateCell value={escalation.createdAt.toISOString()} />
            </Fact>
            {closed && (
              <Fact label={t(locale, 'escClosedOn')}>
                <DateCell value={escalation.closedAt?.toISOString() ?? null} />
              </Fact>
            )}
            {escalation.duplicateOf && (
              <Fact label={t(locale, 'escDuplicateOf')}>
                <Link href={escalationHref(escalation.duplicateOf.id)} className={styles.factLink}>
                  {escalation.duplicateOf.title}
                </Link>
              </Fact>
            )}
            {/* Delivery state (#245 part c), and it is deliberately ASYMMETRIC. A failure
                is loud because the reader's mental model — "everyone on that thread has
                been told" — is now wrong, and nothing else on the page would say so
                (AGENTS lesson 5). A success is a quiet timestamp, because "the post went
                out" is the expected case and a green tick on every escalation is noise.
                Neither appears at all when there is nothing to deliver to. */}
            {escalation.lastChatPostError ? (
              <p
                className={styles.deliveryFailed}
                role="status"
                title={t(locale, 'escChatPostFailedTitle', { reason: escalation.lastChatPostError })}
              >
                {t(locale, 'escChatPostFailed')}
              </p>
            ) : escalation.lastChatPostAt ? (
              <Fact label={t(locale, 'escChatPostedAt')}>
                <DateCell value={escalation.lastChatPostAt.toISOString()} />
              </Fact>
            ) : null}
          </div>
        </aside>
      </main>
    </div>
  );
}
