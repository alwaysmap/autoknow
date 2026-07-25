import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';
import ProjectStatusDashboard from '../../../components/ProjectStatusDashboard';
import ProjectMetaHeader from '../../../components/ProjectMetaHeader';
import ProjectAdminControls from '../../../components/ProjectAdminControls';
import PhaseGraph from '../../../components/PhaseGraph';
import PhaseTrack from '../../../components/PhaseTrack';
import { t } from '../../../lib/i18n';
import { getLocale } from '../../../lib/locale';
import SummaryPanel from '../../../components/SummaryPanel';
import ActivityFeed from '../../../components/ActivityFeed';
import QuickIngest from '../../../components/QuickIngest';
import { getActivity } from '../../../lib/activity';
import { getNeedleHistory } from '../../../lib/history';
import { getSummary } from '../../../lib/summaries';
import { geminiConfigured } from '../../../lib/gemini';
import { findPartnerInText, findPartnersInText } from '../../../lib/associations';
import { resolvePerson } from '../../../lib/people';
import { effectiveStartedAt, phaseDetailHref, statusProgress } from '../../../lib/phase';
import PhaseHillChart from '../../../components/PhaseHillChart';
import { tNodes } from '../../../components/tNodes';
import ChainLedger from '../../../components/ChainLedger';
import AnchorHeading from '../../../components/AnchorHeading';
import { computeChainLedger, type LedgerResourceInput, type StateTuple } from '../../../lib/chainLedger';
import { getProgramLedgers } from '../../../lib/chainLedgerData';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailsPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  const projectId = parseInt(id);

  // PhaseTrack (the train-line surface) is the default phases UI; ?graph=classic
  // renders the legacy PhaseGraph for comparison. Locale from ?lang=en|de|ja|ko,
  // sticky via cookie so it survives param-less navigation.
  const sp = await props.searchParams;
  const showTrack = sp.graph !== 'classic';
  // The hill's dot deeplinks fire JUMP_PHASE_EVENT, whose listener lives in PhaseTrack —
  // a window event, so the two need not be adjacent, but the listener must EXIST. Both
  // render off this one name so a future change cannot mount one without the other.
  const railMounted = showTrack;
  // ?lang= wins for deep links; otherwise the namespaced locale cookie (registry, #31).
  const locale = await getLocale(sp.lang);

  if (isNaN(projectId)) {
    return notFound();
  }

  // 1. Fetch Project with partner and phases containing action items. State history
  // is append-only and unbounded — only what the page renders is fetched: current +
  // previous project state, and the 6 newest per phase (current, previous, history
  // popover). First-started/first-completed come from a SQL aggregate below.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      partner: { include: { type: true, region: true } },
      states: {
        orderBy: { timestamp: 'desc' },
        take: 2
      },
      phases: {
        include: {
          states: {
            orderBy: { timestamp: 'desc' },
            take: 6
          },
          actionItems: {
            orderBy: { id: 'asc' }
          },
          partners: { include: { partner: { include: { type: true } } } },
          people: { include: { person: { include: { currentPartner: { include: { type: true } } } } } },
          dependencies: true
        },
        orderBy: { id: 'asc' }
      }
    }
  });

  if (!project) {
    return notFound();
  }

  // Anticipated-vs-actual timing per phase, aggregated in SQL — never by loading
  // each phase's full state history (same pattern as lib/dashboardData).
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

  // Unified activity for this program: status/needle/hill/phase changes + context.
  const activity = await getActivity({ kind: 'project', id: projectId });

  // Every needle update with its written note — the History popup beside the
  // gauge. The note never renders next to the needle itself (it feeds the AI
  // briefing); this log is where the words are read.
  const needleHistory = await getNeedleHistory('project', projectId);

  // The leadership summary — the page's "read this first" slot (cached; the panel
  // refreshes it in the background when newer content exists).
  const summary = await getSummary('program', projectId);

  const sopDateString = project.sopDate
    ? new Date(project.sopDate).toISOString().split('T')[0]
    : '';

  // Fetch OEM and Supplier partners to resolve links and associations
  const oems = await prisma.partner.findMany({ where: { type: { name: 'OEM' } } });
  const suppliers = await prisma.partner.findMany({ where: { type: { name: 'Supplier' } } });

  // All partners + people (for the involvement pickers) + the graph's row shape.
  const allPartners = await prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const allPeople = await prisma.person.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });

  // Resource contention (CCPM's resource dimension, approximated with the signals we
  // have): for every partner/person involved in THIS program's phases, count the
  // ACTIVE phases (0 < progress < 100) they're simultaneously involved in across
  // OTHER live programs. The counts ride on the involvement rows so the track can
  // mark contended pills and explain the constraint.
  const involvedPartnerIds = [...new Set(project.phases.flatMap((ph) => ph.partners.map((pp) => pp.partnerId)))];
  const involvedPersonIds = [...new Set(project.phases.flatMap((ph) => ph.people.map((pp) => pp.personId)))];
  const isActive = (states: { hillChartProgress: number | null }[]) => {
    const p = states[0]?.hillChartProgress ?? 0;
    return p > 0 && p < 100;
  };
  const partnerElsewhere = involvedPartnerIds.length === 0 ? [] : await prisma.phasePartner.findMany({
    where: { partnerId: { in: involvedPartnerIds }, phase: { projectId: { not: projectId }, project: { isArchived: false } } },
    include: { phase: { include: { states: { orderBy: { timestamp: 'desc' }, take: 1 }, project: { select: { id: true, name: true } } } } },
  });
  const personElsewhere = involvedPersonIds.length === 0 ? [] : await prisma.phasePerson.findMany({
    where: { personId: { in: involvedPersonIds }, phase: { projectId: { not: projectId }, project: { isArchived: false } } },
    include: { phase: { include: { states: { orderBy: { timestamp: 'desc' }, take: 1 }, project: { select: { id: true, name: true } } } } },
  });
  const partnerLoad = new Map<number, number>();
  for (const pp of partnerElsewhere) {
    if (isActive(pp.phase.states)) partnerLoad.set(pp.partnerId, (partnerLoad.get(pp.partnerId) ?? 0) + 1);
  }
  const personLoad = new Map<number, number>();
  for (const pp of personElsewhere) {
    if (isActive(pp.phase.states)) personLoad.set(pp.personId, (personLoad.get(pp.personId) ?? 0) + 1);
  }
  const graphRows = project.phases.map((phase) => {
    return {
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
      // Explicit start (the Active toggle) wins over the derived first-progress
      // timestamp — work often begins before the first update is filed.
      startedAt: effectiveStartedAt(phase.startedAt, phase.states[0]?.hillChartProgress ?? 0, spanByPhase.get(phase.id)?.startedAt ?? null)?.toISOString() ?? null,
      startedExplicit: phase.startedAt != null,
      completedAt: spanByPhase.get(phase.id)?.finishedAt?.toISOString() ?? null,
      history: phase.states.slice(0, 6).map((s) => ({
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
        otherActive: partnerLoad.get(pp.partnerId) ?? 0,
      })),
      people: phase.people.map((pp) => ({
        linkId: pp.id,
        personId: pp.personId,
        name: pp.person.name,
        role: pp.role,
        company: pp.person.currentPartner?.name ?? null,
        companyType: pp.person.currentPartner?.type?.name ?? null,
        otherActive: personLoad.get(pp.personId) ?? 0,
      })),
    };
  });

  // ---- Critical Chain ledger (docs/CRITICAL_CHAIN_VIEW_PLAN.md) ----
  // Narrow state tuples for the buffer-trend replay (never full PhaseState rows).
  // Async Server Component: Date.now() runs once per request on the server, so the
  // react-hooks purity rule (which assumes client re-render) is a false positive —
  // same sanctioned pattern as src/app/page.tsx.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const stateTuples = await prisma.$queryRaw<{ phaseId: number; timestamp: Date; hillChartProgress: number | null }[]>`
    SELECT s."phaseId", s."timestamp", s."hillChartProgress"
    FROM "PhaseState" s JOIN "Phase" p ON p.id = s."phaseId"
    WHERE p."projectId" = ${projectId}
    ORDER BY s."timestamp" ASC`;
  const ledgerStates: StateTuple[] = stateTuples
    .filter((s) => s.hillChartProgress != null)
    .map((s) => ({ phaseId: s.phaseId, at: s.timestamp.toISOString(), progress: s.hillChartProgress! }));

  // Cross-program buffers for the oversubscription packets: the ledger of every
  // OTHER program where this program's contended partners/people are active.
  const otherProgramIds = [
    ...new Set([
      ...partnerElsewhere.filter((pp) => isActive(pp.phase.states)).map((pp) => pp.phase.project.id),
      ...personElsewhere.filter((pp) => isActive(pp.phase.states)).map((pp) => pp.phase.project.id),
    ]),
  ];
  const otherLedgers = await getProgramLedgers(now, otherProgramIds);
  const otherBuffer = new Map(otherLedgers.map((b) => [b.programId, b.ledger.bufferDays]));

  const ledgerResources: LedgerResourceInput[] = [];
  for (const phase of project.phases) {
    for (const pp of phase.partners) {
      const others = partnerElsewhere.filter((x) => x.partnerId === pp.partnerId && isActive(x.phase.states));
      if (others.length === 0) continue;
      const programs = [...new Map(others.map((x) => [x.phase.project.id, x.phase.project])).values()];
      ledgerResources.push({
        kind: 'partner', id: pp.partnerId, name: pp.partner.name, phaseId: phase.id,
        otherPrograms: programs.map((pr) => ({ programId: pr.id, programName: pr.name, bufferDays: otherBuffer.get(pr.id) ?? null })),
      });
    }
    for (const pp of phase.people) {
      const others = personElsewhere.filter((x) => x.personId === pp.personId && isActive(x.phase.states));
      if (others.length === 0) continue;
      const programs = [...new Map(others.map((x) => [x.phase.project.id, x.phase.project])).values()];
      ledgerResources.push({
        kind: 'person', id: pp.personId, name: pp.person.name, phaseId: phase.id,
        otherPrograms: programs.map((pr) => ({ programId: pr.id, programName: pr.name, bufferDays: otherBuffer.get(pr.id) ?? null })),
      });
    }
  }

  const ledger = computeChainLedger({
    phases: project.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      forecastedDuration: phase.forecastedDuration,
      progress: phase.states[0]?.hillChartProgress ?? 0,
      parentIds: phase.dependencies.map((d) => d.dependsOnPhaseId),
      startedAt: effectiveStartedAt(phase.startedAt, phase.states[0]?.hillChartProgress ?? 0, spanByPhase.get(phase.id)?.startedAt ?? null)?.toISOString() ?? null,
      completedAt: spanByPhase.get(phase.id)?.finishedAt?.toISOString() ?? null,
    })),
    sopDate: project.sopDate ? project.sopDate.toISOString() : null,
    now,
    volumeFirstYear: project.volumeFirstYear,
    states: ledgerStates,
    resources: ledgerResources,
  });

  // CCPM resource dimension: the owner's ACTIVE phases in other (non-archived)
  // programs — the cross-program contention on the one Googler. Surfaced in the
  // Critical Chain next-steps list (it used to sit on the phase rail).
  let otherActive: { projectId: number; projectName: string; phaseName: string }[] = [];
  if (project.ownerName) {
    const others = await prisma.project.findMany({
      where: { ownerName: project.ownerName, isArchived: false, id: { not: projectId } },
      include: { phases: { include: { states: { orderBy: { timestamp: 'desc' }, take: 1 } } } },
    });
    otherActive = others.flatMap((o) =>
      o.phases
        .filter((ph) => {
          const p = ph.states[0]?.hillChartProgress ?? 0;
          return p > 0 && p < 100;
        })
        .map((ph) => ({ projectId: o.id, projectName: o.name, phaseName: ph.name })),
    );
  }
  // The owner is stored as a handle/email; resolve it to the Person so the
  // mention links like every other person on the page (design.md §2).
  const ownerPerson = resolvePerson(allPeople, project.ownerName);

  // The program-level overrun flag (rendered in the header below). `count` includes
  // the named phase, so the copy's subject — how many OTHERS are also over — is
  // named once here rather than re-derived at each of its three uses.
  const focus = ledger.immediateFocus;
  const otherOverruns = focus ? focus.count - 1 : 0;

  // Identify the OEM for the project (heuristic name match; see lib/associations).
  const matchedOem = findPartnerInText(oems, project.name);
  const oemPartner = matchedOem || (project.partner.type?.name === 'OEM' ? project.partner : null);

  // Identify associated Suppliers by scanning the project name, phase notes, and
  // action item text for supplier names (the schema has no direct project->supplier link).
  const associatedSuppliers = new Map<number, (typeof suppliers)[number]>();
  if (project.partner.type?.name === 'Supplier') {
    associatedSuppliers.set(project.partner.id, project.partner);
  }

  const supplierSearchText = [
    project.name,
    ...project.phases.flatMap(phase => [
      phase.states[0]?.notes || '',
      ...phase.actionItems.flatMap(ai => [ai.description, ai.assignedTo || ''])
    ])
  ].join(' ');

  for (const supplier of findPartnersInText(suppliers, supplierSearchText)) {
    associatedSuppliers.set(supplier.id, supplier);
  }

  // Real per-phase partner links (PhasePartner) beat the text heuristics above.
  for (const phase of project.phases) {
    for (const pp of phase.partners) {
      const supplier = suppliers.find((s) => s.id === pp.partnerId);
      if (supplier) associatedSuppliers.set(supplier.id, supplier);
    }
  }

  const supplierList = Array.from(associatedSuppliers.values());

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        {/* the whole header: compact title row + metadata strip. The old back-link is
            gone — the OEM fact below IS the link back to the partner. */}
        <ProjectMetaHeader
          projectId={project.id}
          projectName={project.name}
          archivedTag={project.isArchived ? t(locale, 'archivedTag') : null}
          actions={
            <ProjectAdminControls
              lifecycle={project.lifecycle}
              projectId={project.id}
              projectName={project.name}
              isArchived={project.isArchived}
            />
          }
          currentNeedle={project.theNeedle}
          currentHillChartProgress={project.hillChartProgress}
          ownerName={project.ownerName || ''}
          sopDateString={sopDateString}
          projectedFinishMs={ledger.projectedFinishMs}
          bufferDays={ledger.bufferDays}
          guidelineDays={ledger.guidelineDays}
          now={now}
          volumeFirstYear={project.volumeFirstYear}
          hasGas={project.hasGas}
          hasGbi={project.hasGbi}
          hasDigitalKey={project.hasDigitalKey}
          hasAap={project.hasAap}
          currentPartnerId={project.partnerId}
          partnerOptions={[...oems, ...suppliers].map((pa) => ({ id: pa.id, name: pa.name, isOem: oems.some((o) => o.id === pa.id) }))}
          peopleOptions={allPeople}
          oemPartner={oemPartner ? { id: oemPartner.id, name: oemPartner.name } : null}
          suppliersList={supplierList.map((sp) => ({ id: sp.id, name: sp.name }))}
        />

        {/* Immediate focus (2026-07-24, user call). A phase far enough past its OWN
            estimate is the constraint TODAY, whatever the buffer says, so the fact
            is raised to program level: it is read before the needle, the briefing
            and every chart, rather than after scrolling into the chain section —
            where it previously appeared only as history in "Where the buffer went".
            One line, no box: label · fact · reaction (design.md §1, §7). */}
        {focus && (
          <p className={styles.focus} data-testid="program-focus">
            <span className={styles.focusLabel}>{t(locale, 'clFocusLabel')}</span>
            {tNodes(locale, 'clFocusPhase', {
              phase: <Link href={phaseDetailHref(projectId, focus.phaseId)}>{focus.phaseName}</Link>,
              pct: focus.overPct,
              r: focus.remainingDays,
            })}{' '}
            {otherOverruns > 0 && (
              <>{t(locale, otherOverruns === 1 ? 'clFocusAlsoOne' : 'clFocusAlso', { n: otherOverruns })}{' '}</>
            )}
            {t(locale, 'clFocusExploit')}
          </p>
        )}
      </header>

      <main className={styles.main}>
        {/* Top row (user call 2026-07-20): the needle and the AI briefing side by
            side; everything from the Critical Chain section down spans the full
            width of both columns. */}
        <div className={styles.topGrid}>
          <div id="program-status" className={styles.anchor}>
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
            <AnchorHeading id="briefing" linkLabel={t(locale, 'anchorLink')} className={styles.briefingHeading}>
              {t(locale, 'briefingHeading')}
            </AnchorHeading>
            <SummaryPanel scope="program" targetId={projectId} path={`/programs/${projectId}`}
              summary={summary} configured={geminiConfigured} />
          </section>
        </div>

        <div className={styles.contentCol}>
            {/* The program's progress at a glance: every phase as one dot on one hill,
                read straight after the needle and the briefing and BEFORE the chain
                (#154). Full content width — a `topGrid` cell would halve it, and this
                chart's apparent size is a pure function of its container's width.
                No heading: the axis captions name it, and a title here would only
                restate the picture (design.md §7, "few titles").

                statusProgress, not raw progress — a phase explicitly marked Active
                before its hill has moved is In Progress, and the rail below says so.
                Passing the raw 0 put it in the "Not Started" pile, i.e. two views
                contradicting each other about the same phase on one screen. The rail
                calls the same function; neither re-derives it. */}
            {railMounted && graphRows.length > 0 && (
              <section className={styles.historySection}>
                <PhaseHillChart wide phases={graphRows.map((p) => ({
                  id: p.id, name: p.name, progress: statusProgress(p.progress, p.startedAt),
                }))} />
              </section>
            )}

            {/* Critical Chain ledger: buffer vs SOP, where it went, who is
                oversubscribed — "how are we doing" before the rail's structure. */}
            {/* the anchor lives on ChainLedger's own heading, not here — two
                elements sharing an id is invalid and the jump hits the wrong one */}
            <section className={styles.historySection}>
              <ChainLedger projectId={projectId} locale={locale} now={now} ledger={ledger}
                sopDate={project.sopDate ? project.sopDate.toISOString() : null}
                volumeFirstYear={project.volumeFirstYear}
                owner={project.ownerName} ownerPersonId={ownerPerson?.id ?? null}
                ownerOtherActive={otherActive} />
            </section>

            {/* Phases as a vertical rail (spec §2.13): node per phase, latest hill +
                update + partners per row, Done rows collapsed, add/remove inline. */}
            <section className={styles.historySection}>
              {railMounted ? (
                // PhaseTrack owns its title row — the ⋯ menu (expand/hide/edit) rides
                // beside it and needs the component's collapse state.
                <PhaseTrack projectId={projectId} phases={graphRows} allPartners={allPartners}
                  allPeople={allPeople} locale={locale} />
              ) : (
                <>
                  <AnchorHeading id="phases" linkLabel={t(locale, 'anchorLink')}>
                    {t(locale, 'phasesCard')}
                  </AnchorHeading>
                  <PhaseGraph projectId={projectId} phases={graphRows} allPartners={allPartners} />
                </>
              )}
            </section>

            {/* Activity: scoped search riding on top of the feed — one section, one
                chip row (the feed's), no duplicated heading or intro */}
            <section className={styles.historySection}>
              <AnchorHeading id="activity" linkLabel={t(locale, 'anchorLink')}>
                {t(locale, 'navActivity')}
              </AnchorHeading>
              {/* Activity is filtered by ActivityFeed's own SearchField (over the
                  activity items), not a scoped entity search — #41; consistent with
                  design.md §2b "one search surface, and it is the page you land on". */}
              {/* scoped paste-a-link: this page IS the anchor (plan §5.2) */}
              <div style={{ margin: '0 0 0.75rem' }}>
                <QuickIngest anchorKind="program" anchorId={projectId} path={`/programs/${projectId}`} />
              </div>
              <ActivityFeed items={activity} deletable revalidate={`/programs/${projectId}`} />
            </section>
        </div>
      </main>
    </div>
  );
}
