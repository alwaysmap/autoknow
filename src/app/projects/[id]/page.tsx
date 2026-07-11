import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';
import ProjectStatusDashboard from '../../../components/ProjectStatusDashboard';
import ProjectAdminControls from '../../../components/ProjectAdminControls';
import PhaseGraph from '../../../components/PhaseGraph';
import PhaseTrack from '../../../components/PhaseTrack';
import { isLocale, Locale } from '../../../lib/i18n';
import ProgramBrief from '../../../components/ProgramBrief';
import ActivityFeed from '../../../components/ActivityFeed';
import UnifiedSearch from '../../../components/UnifiedSearch';
import { getActivity } from '../../../lib/activity';
import { getLatestBrief } from '../../../lib/brief';
import { geminiConfigured } from '../../../lib/gemini';
import { findPartnerInText, findPartnersInText } from '../../../lib/associations';
import {
  updateActionItem,
} from './actions';

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

  // 1. Fetch Project with partner and phases containing action items
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      partner: { include: { type: true, region: true } },
      states: {
        orderBy: { timestamp: 'desc' }
      },
      phases: {
        include: {
          states: {
            orderBy: { timestamp: 'desc' }
          },
          actionItems: {
            orderBy: { id: 'asc' }
          },
          partners: { include: { partner: true } },
          people: { include: { person: true } },
          dependencies: true
        },
        orderBy: { id: 'asc' }
      }
    }
  });

  if (!project) {
    return notFound();
  }

  // Unified activity for this program: status/needle/hill/phase changes + context.
  const activity = await getActivity({ kind: 'project', id: projectId });

  // The latest AI-generated brief (spec §2.12) — the page's "read this first" slot.
  const brief = await getLatestBrief(projectId);

  const problemCount = project.phases.reduce(
    (sum, phase) => sum + phase.actionItems.filter(item => item.status === 'Pending').length,
    0
  );

  const sopDateString = project.sopDate
    ? new Date(project.sopDate).toISOString().split('T')[0]
    : '';

  // Fetch OEM and Supplier partners to resolve links and associations
  const oems = await prisma.partner.findMany({ where: { type: { name: 'OEM' } } });
  const suppliers = await prisma.partner.findMany({ where: { type: { name: 'Supplier' } } });

  // All partners + people (for the involvement pickers) + the graph's row shape.
  const allPartners = await prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const allPeople = await prisma.person.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const graphRows = project.phases.map((phase) => {
    // states are newest-first; walk oldest-first for anticipated-vs-actual timing.
    const asc = [...phase.states].reverse();
    return {
      id: phase.id,
      name: phase.name,
      progress: phase.states[0]?.hillChartProgress ?? 0,
      previousProgress: phase.states[1]?.hillChartProgress ?? null,
      updatedAt: phase.states[0]?.timestamp?.toISOString() ?? null,
      updatedBy: phase.states[0]?.source ?? null,
      note: phase.states[0]?.notes ?? null,
      forecastedDuration: phase.forecastedDuration,
      startedAt: asc.find((s) => (s.hillChartProgress ?? 0) > 0)?.timestamp?.toISOString() ?? null,
      completedAt: asc.find((s) => (s.hillChartProgress ?? 0) >= 100)?.timestamp?.toISOString() ?? null,
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
      })),
      people: phase.people.map((pp) => ({
        linkId: pp.id,
        personId: pp.personId,
        name: pp.person.name,
        role: pp.role,
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
  const phasesWithActions = project.phases.filter((p) => p.actionItems.length > 0);

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
        <div className={styles.headerLeft}>
          <div className={styles.brand}>
            <Link href={oemPartner ? `/partners/${oemPartner.id}` : `/partners`}>
              &larr; Back to {oemPartner ? oemPartner.name : 'Partners'}
            </Link>
          </div>
          <h1>
            {project.name}
            {project.isArchived && <span className={styles.archivedLabel}> [Archived]</span>}
          </h1>
          <div className={styles.metaCol}>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>OEM:</span>{' '}
              {oemPartner ? (
                <Link href={`/partners/${oemPartner.id}`} className={styles.metaLink}>
                  {oemPartner.name}
                </Link>
              ) : (
                <strong>TBD</strong>
              )}
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Suppliers:</span>{' '}
              {supplierList.length === 0 ? (
                <span className={styles.empty}>None</span>
              ) : (
                supplierList.map((supplier, idx) => (
                  <span key={supplier.id}>
                    {idx > 0 && ', '}
                    <Link href={`/partners/${supplier.id}`} className={styles.metaLink}>
                      {supplier.name}
                    </Link>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
        <div className={styles.headerRight}>
          <ProjectAdminControls
            projectId={project.id}
            projectName={project.name}
            isArchived={project.isArchived}
          />
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.dashboardGrid}>
          <div className={styles.leftColumn}>
            <ProjectStatusDashboard
              projectId={project.id}
              projectName={project.name}
              currentNeedle={project.theNeedle}
              currentHillChartProgress={project.hillChartProgress}
              previousProgress={project.states[1]?.hillChartProgress ?? null}
              previousHealth={project.states[1]?.theNeedle ?? null}
              updatedAt={project.states[0]?.timestamp?.toISOString() ?? null}
              problemCount={problemCount}
              ownerName={project.ownerName || ''}
              sopDateString={sopDateString}
              volumeFirstYear={project.volumeFirstYear}
              phases={project.phases}
              oemPartner={oemPartner}
              suppliersList={Array.from(associatedSuppliers.values())}
            />

          </div>

          <div className={styles.rightColumn}>
            {/* The AI brief (spec §2.12): words beside the gauges' numbers, above the fold. */}
            <section className={styles.historySection}>
              <ProgramBrief projectId={projectId} brief={brief} geminiConfigured={geminiConfigured} />
            </section>

            {/* Phases as a vertical rail (spec §2.13): node per phase, latest hill +
                update + partners per row, Done rows collapsed, add/remove inline. */}
            <section className={styles.historySection}>
              <h2>Phases</h2>
              {showTrack ? (
                <PhaseTrack projectId={projectId} phases={graphRows} allPartners={allPartners}
                  allPeople={allPeople} locale={locale} owner={project.ownerName} otherActive={otherActive} />
              ) : (
                <PhaseGraph projectId={projectId} phases={graphRows} allPartners={allPartners} />
              )}
            </section>

            {phasesWithActions.length > 0 && (
              <section className={styles.historySection}>
                <h2>Actions &amp; Decisions</h2>
                {phasesWithActions.map((phase) => (
                  <div key={phase.id} className={styles.actionsSection}>
                    <h3>{phase.name}</h3>
                    <div className={styles.actionGrid}>
                      {phase.actionItems.map((item) => (
                            <div key={item.id} className={`${styles.actionCard} action-item-${item.id}`}>
                              <form action={updateActionItem}>
                                <input type="hidden" name="actionItemId" value={item.id} />
                                <input type="hidden" name="projectId" value={projectId} />

                                <div className={styles.actionFormGroup}>
                                  <label className={styles.actionLabel}>Description</label>
                                  <p className={styles.actionDesc}>{item.description}</p>
                                </div>

                                <div className={styles.actionFormGroup}>
                                  <label htmlFor={`status-${item.id}`} className={styles.actionLabel}>Status</label>
                                  <select 
                                    id={`status-${item.id}`}
                                    name="status" 
                                    defaultValue={item.status} 
                                    className={styles.select}
                                  >
                                    <option value="Pending">Pending</option>
                                    <option value="Completed">Completed</option>
                                  </select>
                                </div>

                                <div className={styles.actionFormGroup}>
                                  <label htmlFor={`nextStep-${item.id}`} className={styles.actionLabel}>Next Step</label>
                                  <select 
                                    id={`nextStep-${item.id}`}
                                    name="nextStep" 
                                    defaultValue={item.nextStep} 
                                    className={styles.select}
                                  >
                                    <option value="Undecided">Undecided</option>
                                    <option value="Resolved">Resolved</option>
                                    <option value="Partner">Partner</option>
                                    <option value="Googler">Googler</option>
                                  </select>
                                </div>

                                <div className={styles.actionFormGroup}>
                                  <label htmlFor={`linkUrl-${item.id}`} className={styles.actionLabel}>System of Record Link</label>
                                  <input
                                    id={`linkUrl-${item.id}`}
                                    type="url"
                                    name="linkUrl"
                                    defaultValue={item.linkUrl || ''}
                                    placeholder="Buganizer (b/...) or Google Doc Link"
                                    className={styles.input}
                                  />
                                  {item.linkUrl && (
                                    <div className={styles.activeLinkRow}>
                                      <a href={item.linkUrl} target="_blank" rel="noreferrer" className={styles.linkAnchor}>
                                        Open Link &rarr;
                                      </a>
                                    </div>
                                  )}
                                </div>

                                <div className={styles.submitRow}>
                                  <button type="submit" className={styles.saveButton}>
                                    Save Changes
                                  </button>
                                </div>
                              </form>
                            </div>
                          ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Unified scoped search + ingested context for this program */}
            <section className={styles.historySection}>
              <h2>Search</h2>
              <UnifiedSearch
                scope={{ kind: 'project', id: projectId }}
                placeholder="Search this program — context, people, partner…"
              />
            </section>

            {/* Unified activity: program/needle/hill/phase changes + ingested context */}
            <section className={styles.historySection}>
              <h2>Activity</h2>
              <p className={styles.historyIntro}>Needle and progress changes, phase updates, and ingested context for this program.</p>
              <ActivityFeed items={activity} deletable revalidate={`/projects/${projectId}`} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
