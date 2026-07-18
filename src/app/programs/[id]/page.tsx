import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';
import ProjectStatusDashboard from '../../../components/ProjectStatusDashboard';
import ProjectMetaHeader from '../../../components/ProjectMetaHeader';
import ProjectAdminControls from '../../../components/ProjectAdminControls';
import PhaseGraph from '../../../components/PhaseGraph';
import PhaseTrack from '../../../components/PhaseTrack';
import { isLocale, t, Locale } from '../../../lib/i18n';
import SummaryPanel from '../../../components/SummaryPanel';
import ActivityFeed from '../../../components/ActivityFeed';
import UnifiedSearch from '../../../components/UnifiedSearch';
import QuickIngest from '../../../components/QuickIngest';
import { getActivity } from '../../../lib/activity';
import { getSummary } from '../../../lib/summaries';
import { geminiConfigured } from '../../../lib/gemini';
import { findPartnerInText, findPartnersInText } from '../../../lib/associations';

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
  const cookieStore = await cookies();
  const showTrack = sp.graph !== 'classic';
  const langValue = typeof sp.lang === 'string' ? sp.lang : cookieStore.get('lang')?.value;
  const locale: Locale = isLocale(langValue) ? langValue : 'en';

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
  const allPeople = await prisma.person.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });

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
    include: { phase: { include: { states: { orderBy: { timestamp: 'desc' }, take: 1 } } } },
  });
  const personElsewhere = involvedPersonIds.length === 0 ? [] : await prisma.phasePerson.findMany({
    where: { personId: { in: involvedPersonIds }, phase: { projectId: { not: projectId }, project: { isArchived: false } } },
    include: { phase: { include: { states: { orderBy: { timestamp: 'desc' }, take: 1 } } } },
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
      startedAt: spanByPhase.get(phase.id)?.startedAt?.toISOString() ?? null,
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

  // CCPM resource dimension for the track prototype: the owner's ACTIVE phases in
  // other (non-archived) programs — the cross-program contention on the one Googler.
  let otherActive: { projectId: number; projectName: string; phaseName: string }[] = [];
  if (showTrack && project.ownerName) {
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
          volumeFirstYear={project.volumeFirstYear}
          hasGas={project.hasGas}
          hasGbi={project.hasGbi}
          hasDigitalKey={project.hasDigitalKey}
          hasAap={project.hasAap}
          currentPartnerId={project.partnerId}
          partnerOptions={[...oems, ...suppliers].map((pa) => ({ id: pa.id, name: pa.name, isOem: oems.some((o) => o.id === pa.id) }))}
          oemPartner={oemPartner ? { id: oemPartner.id, name: oemPartner.name } : null}
          suppliersList={supplierList.map((sp) => ({ id: sp.id, name: sp.name }))}
        />
      </header>

      <main className={styles.main}>
        <div className={styles.dashboardGrid}>
          <div className={styles.leftColumn}>
            <ProjectStatusDashboard
              projectId={project.id}
              currentNeedle={project.theNeedle}
              currentHillChartProgress={project.hillChartProgress}
              previousProgress={project.states[1]?.hillChartProgress ?? null}
              previousHealth={project.states[1]?.theNeedle ?? null}
              updatedAt={project.states[0]?.timestamp?.toISOString() ?? null}
              // Only the fields the client component reads — the raw Prisma include
              // tree (people, partners, notes markdown…) would be serialized into
              // the RSC payload wholesale.
              phases={project.phases.map((p) => ({
                id: p.id,
                name: p.name,
                states: p.states.slice(0, 1).map((s) => ({
                  status: s.status,
                  hillChartProgress: s.hillChartProgress,
                })),
              }))}
            />

          </div>

          <div className={styles.rightColumn}>
            {/* The leadership summary: words beside the gauges' numbers, above the fold. */}
            <section className={styles.historySection}>
              <SummaryPanel scope="program" targetId={projectId} path={`/programs/${projectId}`}
                summary={summary} configured={geminiConfigured} />
            </section>

            {/* Phases as a vertical rail (spec §2.13): node per phase, latest hill +
                update + partners per row, Done rows collapsed, add/remove inline. */}
            <section className={styles.historySection}>
              {showTrack ? (
                // PhaseTrack owns its title row — the ⋯ menu (expand/hide/edit) rides
                // beside it and needs the component's collapse state.
                <PhaseTrack projectId={projectId} phases={graphRows} allPartners={allPartners}
                  allPeople={allPeople} locale={locale} owner={project.ownerName} otherActive={otherActive} />
              ) : (
                <>
                  <h2>{t(locale, 'phasesCard')}</h2>
                  <PhaseGraph projectId={projectId} phases={graphRows} allPartners={allPartners} />
                </>
              )}
            </section>

            {/* Activity: scoped search riding on top of the feed — one section, one
                chip row (the feed's), no duplicated heading or intro */}
            <section className={styles.historySection}>
              <h2>{t(locale, 'navActivity')}</h2>
              <div style={{ margin: '4px 0 14px' }}>
                <UnifiedSearch
                  scope={{ kind: 'project', id: projectId }}
                  placeholder={t(locale, 'searchThisProgram')}
                  showTypeChips={false}
                />
              </div>
              {/* scoped paste-a-link: this page IS the anchor (plan §5.2) */}
              <div style={{ margin: '0 0 12px' }}>
                <QuickIngest anchorKind="program" anchorId={projectId} path={`/programs/${projectId}`} />
              </div>
              <ActivityFeed items={activity} deletable revalidate={`/programs/${projectId}`} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
