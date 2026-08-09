import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../../lib/db';
import styles from './page.module.css';
import ProjectStatusDashboard from '../../../../components/ProjectStatusDashboard';
import PhaseTrack from '../../../../components/PhaseTrack';
import PhaseHillChart from '../../../../components/PhaseHillChart';
import SummaryPanel from '../../../../components/SummaryPanel';
import ActivityFeed from '../../../../components/ActivityFeed';
import QuickIngest from '../../../../components/QuickIngest';
import AnchorHeading from '../../../../components/AnchorHeading';
import CollapsibleSection from '../../../../components/CollapsibleSection';
import KebabMenu from '../../../../components/KebabMenu';
import EscalationRows from '../../../../components/EscalationRows';
import DateCell from '../../../../components/DateCell';
import { getActivity } from '../../../../lib/activity';
import { untrackedContext } from '../../../../lib/untrackedContext';
import { getNeedleHistory } from '../../../../lib/history';
import { getSummary } from '../../../../lib/summaries';
import { geminiConfigured } from '../../../../lib/gemini';
import { getProgramEscalations } from '../../../../lib/escalationQueries';
import { profilesAsOf } from '../../../../lib/profiles';
import { effectiveStartedAt, statusProgress } from '../../../../lib/phase';
import { initiativeHref, initiativeProjectHref, partnerHref } from '../../../../lib/entityHref';
import { getLocale } from '../../../../lib/locale';
import { t } from '../../../../lib/i18n';

export const dynamic = 'force-dynamic';

// The user-visible home of an initiative's per-partner copy (gh-286, owner calls
// 2026-08-08): presented UNDER its initiative, deliberately WITHOUT the critical-chain
// section or any phase-structure editing — the steps are the initiative's template and
// cannot deviate per copy; only the initiative-level edit changes them. What remains is
// the copy's own life: needle + briefing, the hill, the step rail (progress updates
// stay per-copy), escalations, activity. `/programs/[id]` redirects copies here.
export default async function InitiativeProjectPage(props: {
  params: Promise<{ id: string; projectId: string }>;
}) {
  const { id, projectId: projectIdParam } = await props.params;
  const initiativeId = parseInt(id, 10);
  const projectId = parseInt(projectIdParam, 10);
  if (isNaN(initiativeId) || isNaN(projectId)) return notFound();
  const locale = await getLocale();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      initiative: { select: { id: true, name: true } },
      partner: { include: { type: true, region: true } },
      states: { orderBy: { timestamp: 'desc' }, take: 2 },
      phases: {
        include: {
          states: { orderBy: { timestamp: 'desc' }, take: 6 },
          actionItems: { orderBy: { id: 'asc' } },
          partners: { include: { partner: { include: { type: true } } } },
          people: { include: { person: { select: { id: true, name: true } } } },
          dependencies: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  });
  // The pair must MATCH — a copy is addressable only under its own initiative.
  if (!project || project.initiativeId !== initiativeId || !project.initiative) return notFound();

  // Anticipated-vs-actual timing per phase, aggregated in SQL (the program page's
  // pattern — never each phase's full history).
  const spans = await prisma.$queryRaw<
    { phaseId: number; startedAt: Date | null; finishedAt: Date | null }[]
  >`
    SELECT p.id AS "phaseId",
           MIN(s."timestamp") FILTER (WHERE s."hillChartProgress" > 0)    AS "startedAt",
           MIN(s."timestamp") FILTER (WHERE s."hillChartProgress" >= 100) AS "finishedAt"
    FROM "Phase" p
    LEFT JOIN "PhaseState" s ON s."phaseId" = p.id
    WHERE p."projectId" = ${projectId}
    GROUP BY p.id`;
  const spanByPhase = new Map(spans.map((s) => [s.phaseId, s]));

  const activity = await getActivity({ kind: 'project', id: projectId });
  const escalations = await getProgramEscalations(projectId);
  const needleHistory = await getNeedleHistory('project', projectId);
  const summary = await getSummary('program', projectId);
  const untracked = await untrackedContext();
  const allPartners = await prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });

  const involvedPersonIds = [...new Set(project.phases.flatMap((ph) => ph.people.map((pp) => pp.personId)))];
  const profileByPerson = await profilesAsOf(involvedPersonIds);

  const path = initiativeProjectHref(initiativeId, projectId);

  const graphRows = project.phases.map((phase) => ({
    id: phase.id,
    name: phase.name,
    progress: phase.states[0]?.hillChartProgress ?? 0,
    previousProgress: phase.states[1]?.hillChartProgress ?? null,
    updatedAt: phase.states[0]?.timestamp?.toISOString() ?? null,
    updatedBy: phase.states[0]?.source ?? null,
    note: phase.states[0]?.notes ?? null,
    forecastedDuration: phase.forecastedDuration,
    description: phase.description ?? null,
    googleFocus: phase.googleFocus ?? null,
    startedAt: effectiveStartedAt(phase.startedAt, phase.states[0]?.hillChartProgress ?? 0, spanByPhase.get(phase.id)?.startedAt ?? null)?.toISOString() ?? null,
    startedExplicit: phase.startedAt != null,
    completedAt: spanByPhase.get(phase.id)?.finishedAt?.toISOString() ?? null,
    history: phase.states.slice(0, 6).map((s) => ({
      id: s.id,
      at: s.timestamp.toISOString(),
      progress: s.hillChartProgress ?? 0,
      note: s.notes ?? null,
      by: s.source ?? null,
    })),
    activities: phase.actionItems
      .filter((a) => a.status === 'Pending')
      .map((a) => ({
        id: a.id,
        description: a.description,
        nextStep: a.nextStep,
        assignedTo: a.assignedTo,
        linkUrl: a.linkUrl,
      })),
    parents: phase.dependencies.map((d) => ({ linkId: d.id, id: d.dependsOnPhaseId })),
    partners: phase.partners.map((pp) => ({
      linkId: pp.id,
      partnerId: pp.partnerId,
      name: pp.partner.name,
      role: pp.role,
      type: pp.partner.type?.name ?? null,
      // Cross-program contention is chain machinery — deliberately absent here.
      otherActive: 0,
    })),
    people: phase.people.map((pp) => ({
      linkId: pp.id,
      personId: pp.personId,
      name: pp.person.name,
      role: pp.role,
      company: profileByPerson.get(pp.personId)?.partner.name ?? null,
      companyType: profileByPerson.get(pp.personId)?.partner.type?.name ?? null,
      otherActive: 0,
    })),
  }));

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {project.name}
          {project.isArchived && <span className={styles.archivedTag}> {t(locale, 'archivedTag')}</span>}
        </h1>
        {/* One-line facts (design.md §7): the context this copy lives in. The
            initiative fact IS the way back up; the partner fact is the way sideways. */}
        <p className={styles.facts}>
          <span className={styles.factLabel}>{t(locale, 'initiativeLabel')}</span>{' '}
          <Link href={initiativeHref(project.initiative.id)}>{project.initiative.name}</Link>
          <span className={styles.factSep} aria-hidden>·</span>
          <span className={styles.factLabel}>{t(locale, 'partnerOemSupplier')}</span>{' '}
          <Link href={partnerHref(project.partner.id)}>{project.partner.name}</Link>
          <span className={styles.factSep} aria-hidden>·</span>
          <span className={styles.factLabel}>{t(locale, 'initiativeTargetLabel')}</span>{' '}
          <DateCell value={project.sopDate} />
        </p>
      </header>

      <main className={styles.main}>
        <div className={styles.topGrid}>
          <div id="program-status">
            <ProjectStatusDashboard
              projectId={project.id}
              currentNeedle={project.theNeedle}
              currentHillChartProgress={project.hillChartProgress}
              previousProgress={project.states[1]?.hillChartProgress ?? null}
              previousHealth={project.states[1]?.theNeedle ?? null}
              updatedAt={project.states[0]?.timestamp?.toISOString() ?? null}
              history={needleHistory?.changes ?? []}
            />
          </div>
          <section>
            <AnchorHeading id="briefing" className={styles.briefingHeading}>
              {t(locale, 'briefingHeading')}
            </AnchorHeading>
            <SummaryPanel scope="program" targetId={projectId} path={path}
              untracked={{ ctx: untracked, partners: allPartners }}
              summary={summary} configured={geminiConfigured} />
          </section>
        </div>

        <div className={styles.contentCol}>
          {/* Collapsible sections share the program page's section ids (autoknow-hcz.15):
              this page is program-shaped, and "I tucked the hill away" is a claim about
              the SECTION, not about which route renders it. The hill's heading is its
              collapse handle, same as there. */}
          {graphRows.length > 0 && (
            <CollapsibleSection sectionId="programs:hill" className={styles.historySection}>
              <AnchorHeading id="hill">
                {t(locale, 'hillChartHeader')}
              </AnchorHeading>
              <PhaseHillChart wide phases={graphRows.map((p) => ({
                id: p.id, name: p.name, progress: statusProgress(p.progress, p.startedAt),
              }))} />
            </CollapsibleSection>
          )}

          {/* The step rail: per-step progress updates stay per-copy; STRUCTURE is the
              initiative's and locked (owner call 2026-08-08) — structureLocked hides
              every edit-phases affordance and the mutation refuses copies besides. */}
          <CollapsibleSection sectionId="programs:phases" className={styles.historySection}>
            <PhaseTrack projectId={projectId} phases={graphRows} locale={locale} structureLocked />
            <p className={styles.stepsLockedNote}>{t(locale, 'initiativeStepsLocked')}</p>
          </CollapsibleSection>

          <CollapsibleSection sectionId="programs:escalations" className={styles.historySection}>
            <AnchorHeading
              id="escalations"
              actions={
                <KebabMenu ariaLabel={t(locale, 'moreActions')}>
                  <Link href={`/escalations?project=${encodeURIComponent(project.name)}`}>
                    {t(locale, 'escalationsLabel')}
                  </Link>
                </KebabMenu>
              }
            >
              {t(locale, 'escalationsLabel')}
            </AnchorHeading>
            <EscalationRows escalations={escalations} locale={locale} />
          </CollapsibleSection>

          <CollapsibleSection sectionId="programs:activity" className={styles.historySection}>
            <AnchorHeading id="activity">
              {t(locale, 'navActivity')}
            </AnchorHeading>
            <div style={{ margin: '0 0 0.75rem' }}>
              <QuickIngest anchorKind="program" anchorId={projectId} path={path} />
            </div>
            <ActivityFeed items={activity} deletable revalidate={path} untracked={{ ctx: untracked, partners: allPartners }} />
          </CollapsibleSection>
        </div>
      </main>
    </div>
  );
}
