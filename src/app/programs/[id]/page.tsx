import { notFound, redirect } from 'next/navigation';
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
import { untrackedContext } from '../../../lib/untrackedContext';
import { getNeedleHistory } from '../../../lib/history';
import { getSummary } from '../../../lib/summaries';
import { geminiConfigured } from '../../../lib/gemini';
import { findPartnerInText, findPartnersInText } from '../../../lib/associations';
import { personDirectorySelect } from '../../../lib/people';
import { profilesAsOf } from '../../../lib/profiles';
import { effectiveStartedAt, isPhaseActive, phaseHref, statusProgress } from '../../../lib/phase';
import { personActivePhases } from '../../../lib/activeWork';
import { initiativeProjectHref } from '../../../lib/entityHref';
import PhaseHillChart from '../../../components/PhaseHillChart';
import { tNodes } from '../../../components/tNodes';
import ChainLedger from '../../../components/ChainLedger';
import AnchorHeading from '../../../components/AnchorHeading';
import CollapsibleSection from '../../../components/CollapsibleSection';
import KebabMenu from '../../../components/KebabMenu';
import EscalationRows from '../../../components/EscalationRows';
import { getProgramEscalations } from '../../../lib/escalationQueries';
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
      ownerPerson: { select: { id: true, name: true } }, // the owner by REFERENCE (#127 E7)
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
          people: { include: { person: { select: { id: true, name: true } } } },
          dependencies: true
        },
        orderBy: { id: 'asc' }
      }
    }
  });

  if (!project) {
    return notFound();
  }

  // An initiative copy's user-visible home is under its initiative (gh-286, owner call
  // 2026-08-08). Redirect rather than 404: programHref callers and persisted citations
  // to this shape keep resolving (AGENTS lesson 15).
  if (project.initiativeId != null) {
    redirect(initiativeProjectHref(project.initiativeId, project.id));
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
  const escalations = await getProgramEscalations(projectId);

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
  // See the partner page: the two sets the pure detector cannot know (#127 E15).
  const untracked = await untrackedContext();
  const allPeople = await prisma.person.findMany({ select: personDirectorySelect, orderBy: { name: 'asc' } });

  // Resource contention (CCPM's resource dimension, approximated with the signals we
  // have): for every partner/person involved in THIS program's phases, count the
  // ACTIVE phases they're simultaneously involved in across OTHER live programs. The
  // counts ride on the involvement rows so the track can mark contended pills and
  // explain the constraint.
  //
  // "Active" is `isPhaseActive` (lib/phase), the same predicate the rail and the hill
  // chart derive their status from — #167's one-definition rule. This file used to spell
  // it `p > 0 && p < 100` in two places, which silently dropped a phase somebody had
  // marked Active before its hill moved: the rail called it In Progress and the
  // contention count did not.
  const involvedPartnerIds = [...new Set(project.phases.flatMap((ph) => ph.partners.map((pp) => pp.partnerId)))];
  const involvedPersonIds = [...new Set(project.phases.flatMap((ph) => ph.people.map((pp) => pp.personId)))];
  const isActive = (phase: { startedAt: Date | null; states: { hillChartProgress: number | null }[] }) =>
    isPhaseActive(phase.states[0]?.hillChartProgress ?? 0, phase.startedAt ? phase.startedAt.toISOString() : null);
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
    if (isActive(pp.phase)) partnerLoad.set(pp.partnerId, (partnerLoad.get(pp.partnerId) ?? 0) + 1);
  }
  const personLoad = new Map<number, number>();
  for (const pp of personElsewhere) {
    if (isActive(pp.phase)) personLoad.set(pp.personId, (personLoad.get(pp.personId) ?? 0) + 1);
  }
  // Which company each phase participant is at TODAY, in one query for the whole page —
  // it drives the OEM/supplier colour of their pill on the track. As-of, not the
  // `currentPartner` cache the include above used to carry (ADR
  // currentpartnerid-is-a-cache-affiliations-are-the-truth).
  const profileByPerson = await profilesAsOf(involvedPersonIds);

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
        otherActive: partnerLoad.get(pp.partnerId) ?? 0,
      })),
      people: phase.people.map((pp) => ({
        linkId: pp.id,
        personId: pp.personId,
        name: pp.person.name,
        role: pp.role,
        company: profileByPerson.get(pp.personId)?.partner.name ?? null,
        companyType: profileByPerson.get(pp.personId)?.partner.type?.name ?? null,
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
      ...partnerElsewhere.filter((pp) => isActive(pp.phase)).map((pp) => pp.phase.project.id),
      ...personElsewhere.filter((pp) => isActive(pp.phase)).map((pp) => pp.phase.project.id),
    ]),
  ];
  const otherLedgers = await getProgramLedgers(now, otherProgramIds);
  const otherBuffer = new Map(otherLedgers.map((b) => [b.programId, b.ledger.bufferDays]));

  const ledgerResources: LedgerResourceInput[] = [];
  for (const phase of project.phases) {
    for (const pp of phase.partners) {
      const others = partnerElsewhere.filter((x) => x.partnerId === pp.partnerId && isActive(x.phase));
      if (others.length === 0) continue;
      const programs = [...new Map(others.map((x) => [x.phase.project.id, x.phase.project])).values()];
      ledgerResources.push({
        kind: 'partner', id: pp.partnerId, name: pp.partner.name, phaseId: phase.id,
        otherPrograms: programs.map((pr) => ({ programId: pr.id, programName: pr.name, bufferDays: otherBuffer.get(pr.id) ?? null })),
      });
    }
    for (const pp of phase.people) {
      const others = personElsewhere.filter((x) => x.personId === pp.personId && isActive(x.phase));
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
  //
  // Through lib/activeWork since #167, which is the whole point of that module: this
  // bullet no longer enumerates the phases, it LINKS to the person page filtered to
  // them, so the count in the sentence and the rows behind the link have to be answers
  // to the same question. It also widens the old query, correctly — that one asked only
  // about programs the owner OWNS, while "before asking for more of their time" is a
  // claim about all of their work, phases they are merely named on included.
  const otherActive = project.ownerPersonId
    ? await personActivePhases(project.ownerPersonId, { excludeProjectId: projectId })
    : [];
  // The owner Person, off the FK relation rather than matched out of the people
  // directory (#127 E7) — named here because the header and the ledger both take it.
  const ownerPerson = project.ownerPerson;

  // The program-level overrun flag (rendered in the header below). `focus.count` — how
  // many phases are over in total — is no longer read here: the header stopped restating
  // it (#167), and the Next-steps list already emits one bullet per overrunning phase,
  // which is the same number said by enumeration instead of by arithmetic.
  const focus = ledger.immediateFocus;

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
          owner={ownerPerson}
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
          leadPartnerId={project.partnerId}
          partnerOptions={[...oems, ...suppliers].map((pa) => ({ id: pa.id, name: pa.name, isOem: oems.some((o) => o.id === pa.id) }))}
          peopleOptions={allPeople}
          oemPartner={oemPartner ? { id: oemPartner.id, name: oemPartner.name } : null}
          suppliersList={supplierList.map((sp) => ({ id: sp.id, name: sp.name }))}
        />

        {/* Immediate focus (2026-07-24, user call — the GOAL is unchanged, the mechanism
            is not; #167). A phase far enough past its OWN estimate is the constraint
            TODAY, whatever the buffer says, and that is worth knowing before the needle,
            the briefing and every chart rather than after scrolling into the chain
            section.

            What changed: this line used to restate the entire finding — percentage over,
            days of work left, how many other phases are also over, and the "Exploit the
            constraint" reaction. Every one of those is already in the first Next-steps
            bullet, built from the SAME sorted `forecastOverrun` list, in a strictly
            fuller form (it adds the planned days and the re-estimate branch). So the
            terser copy above the fuller one is deleted — the pattern this repo has now
            removed three times — and what is left is the one thing scrolling actually
            costs you: WHICH phase, and a link to where the recommendation lives.

            The link is a plain anchor. It only changes WHERE you are (design.md §6), and
            the scroll offset for every in-page jump lives once on `scroll-padding-top`. */}
        {focus && (
          <p className={styles.focus} data-testid="program-focus">
            <span data-eyebrow className={styles.focusLabel}>{t(locale, 'clFocusLabel')}</span>
            {tNodes(locale, 'clFocusPointer', {
              phase: <Link href={phaseHref(projectId, focus.phaseId)}>{focus.phaseName}</Link>,
            })}{' '}
            <a href="#critical-chain">{t(locale, 'clFocusSeeSteps')} →</a>
          </p>
        )}
      </header>

      <main className={styles.main}>
        {/* Top row (user call 2026-07-20): the needle and the AI briefing side by
            side; everything from the Critical Chain section down spans the full
            width of both columns. */}
        <div className={styles.topGrid}>
          {/* id only: the scroll offset for every in-page jump lives once on
              `html { scroll-padding-top }` (globals.css). `styles.anchor` used to
              ride here too — page.module.css has had no such rule since the offset
              moved, so it resolved to undefined and painted nothing. */}
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
            <AnchorHeading id="briefing">
              {t(locale, 'briefingHeading')}
            </AnchorHeading>
            <SummaryPanel scope="program" targetId={projectId} path={`/programs/${projectId}`}
              untracked={{ ctx: untracked, partners: allPartners }}
              summary={summary} configured={geminiConfigured} />
          </section>
        </div>

        <div className={styles.contentCol}>
            {/* The program's progress at a glance: every phase as one dot on one hill,
                read straight after the needle and the briefing and BEFORE the chain
                (#154). Full content width — a `topGrid` cell would halve it, and this
                chart's apparent size is a pure function of its container's width.
                The heading earns its place as the section's collapse handle
                (autoknow-hcz.15): a foldable section needs a labelled row to fold
                against — §8c puts affordances inside a heading, and a collapsed
                section with no title is unfindable. (It ran headingless before,
                per §7 "few titles", when the axis captions alone named it.)

                statusProgress, not raw progress — a phase explicitly marked Active
                before its hill has moved is In Progress, and the rail below says so.
                Passing the raw 0 put it in the "Not Started" pile, i.e. two views
                contradicting each other about the same phase on one screen. The rail
                calls the same function; neither re-derives it. */}
            {railMounted && graphRows.length > 0 && (
              <CollapsibleSection sectionId="programs:hill" className={styles.historySection}>
                <AnchorHeading id="hill">
                  {t(locale, 'hillChartHeader')}
                </AnchorHeading>
                <PhaseHillChart wide phases={graphRows.map((p) => ({
                  id: p.id, name: p.name, progress: statusProgress(p.progress, p.startedAt),
                }))} />
              </CollapsibleSection>
            )}

            {/* Critical Chain ledger: buffer vs SOP, where it went, who is
                oversubscribed — "how are we doing" before the rail's structure. */}
            {/* the anchor lives on ChainLedger's own heading, not here — two
                elements sharing an id is invalid and the jump hits the wrong one */}
            <CollapsibleSection sectionId="programs:chain" className={styles.historySection}>
              <ChainLedger projectId={projectId} locale={locale} now={now} ledger={ledger}
                sopDate={project.sopDate ? project.sopDate.toISOString() : null}
                volumeFirstYear={project.volumeFirstYear}
                ownerPerson={ownerPerson}
                ownerOtherActive={otherActive} />
            </CollapsibleSection>

            {/* Phases as a vertical rail (spec §2.13): node per phase, latest hill +
                update + partners per row, Done rows collapsed, add/remove inline. */}
            <CollapsibleSection sectionId="programs:phases" className={styles.historySection}>
              {railMounted ? (
                // PhaseTrack owns its title row — the ⋯ menu (expand/hide/edit) rides
                // beside it and needs the component's collapse state.
                // No partner/person option sets: WHO is on a phase is edited in the one
                // phase editor now (autoknow-crw.1), and the rail's card links to that
                // rather than embedding a second copy of the control.
                <PhaseTrack projectId={projectId} phases={graphRows} locale={locale} />
              ) : (
                <>
                  <AnchorHeading id="phases">
                    {t(locale, 'phasesCard')}
                  </AnchorHeading>
                  <PhaseGraph projectId={projectId} phases={graphRows} allPartners={allPartners} />
                </>
              )}
            </CollapsibleSection>

            {/* Escalations raised about this program (#245) — the same condensed panel
                the partner page carries; the full listing at /escalations is where
                filtering lives. */}
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

            {/* Activity: scoped search riding on top of the feed — one section, one
                chip row (the feed's), no duplicated heading or intro */}
            <CollapsibleSection sectionId="programs:activity" className={styles.historySection}>
              <AnchorHeading id="activity">
                {t(locale, 'navActivity')}
              </AnchorHeading>
              {/* Activity is filtered by ActivityFeed's own SearchField (over the
                  activity items), not a scoped entity search — #41; consistent with
                  design.md §2b "one search surface, and it is the page you land on". */}
              {/* scoped paste-a-link: this page IS the anchor (plan §5.2) */}
              <div style={{ margin: '0 0 0.75rem' }}>
                <QuickIngest anchorKind="program" anchorId={projectId} path={`/programs/${projectId}`} />
              </div>
              <ActivityFeed items={activity} deletable revalidate={`/programs/${projectId}`} untracked={{ ctx: untracked, partners: allPartners }} />
            </CollapsibleSection>
        </div>
      </main>
    </div>
  );
}
