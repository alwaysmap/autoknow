import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';
import ProjectStatusDashboard from '../../../components/ProjectStatusDashboard';
import ProjectAdminControls from '../../../components/ProjectAdminControls';
import PhaseHillInput from '../../../components/PhaseHillInput';
import ActivityFeed from '../../../components/ActivityFeed';
import UnifiedSearch from '../../../components/UnifiedSearch';
import PhaseManager from './PhaseManager';
import { getActivity } from '../../../lib/activity';
import { findPartnerInText, findPartnersInText } from '../../../lib/associations';
import {
  updateActionItem,
  updatePhaseState
} from './actions';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const projectId = parseInt(id);

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
          }
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

            <PhaseManager
              projectId={project.id}
              phases={project.phases.map(p => ({
                id: p.id,
                name: p.name,
                forecastedDuration: p.forecastedDuration
              }))}
            />
          </div>

          <div className={styles.rightColumn}>
            {project.phases.length === 0 ? (
              <div className={styles.emptyPhasesBox}>
                <p className={styles.emptyText}>No phases defined for this project. Use the workflow panel on the left to add your first phase.</p>
              </div>
            ) : (
              project.phases.map((phase) => {
                const latestState = phase.states[0];
                const phaseStatus = latestState?.status || 'Not Started';

                return (
                  <div key={phase.id} className={styles.phaseCard}>
                    <div className={styles.phaseHeader}>
                      <div className={styles.phaseTitleArea}>
                        <h2>{phase.name}</h2>
                        <div className={styles.phaseStatusRow}>
                          <span className={`${styles.statusBadge} ${styles['status' + phaseStatus.replace(/\s+/g, '')]}`}>
                            {phaseStatus}
                          </span>
                        </div>
                      </div>

                      {/* Inline Form to Tag Phase */}
                      <div className={styles.tagPhaseFormContainer}>
                        <form action={updatePhaseState} className={styles.tagPhaseForm}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="phaseId" value={phase.id} />
                          
                          <div className={styles.formSelectGroup}>
                            <label htmlFor={`phaseStatus-${phase.id}`} className={styles.miniLabel}>Status</label>
                            <select
                              id={`phaseStatus-${phase.id}`}
                              name="status"
                              defaultValue={phaseStatus}
                              className={styles.miniSelect}
                            >
                              <option value="Not Started">Not Started</option>
                              <option value="Active WIP">Active WIP</option>
                              <option value="Finished">Finished</option>
                              <option value="Skipped">Skipped</option>
                            </select>
                          </div>

                          <div className={styles.formSelectGroup}>
                            <label className={styles.miniLabel}>Hill progress (drag)</label>
                            <PhaseHillInput defaultProgress={latestState?.hillChartProgress ?? 0} />
                          </div>

                          <div className={styles.formSelectGroup}>
                            <label htmlFor={`phaseNotes-${phase.id}`} className={styles.miniLabel}>Update note (markdown)</label>
                            <textarea
                              id={`phaseNotes-${phase.id}`}
                              name="notes"
                              rows={2}
                              placeholder="What changed and why?"
                              className={styles.miniNotesInput}
                            />
                          </div>

                          <button type="submit" className={styles.tagPhaseButton}>
                            Tag Phase
                          </button>
                        </form>
                      </div>
                    </div>

                    <div className={styles.actionsSection}>
                      <h3>Actions &amp; Decisions</h3>
                      
                      {phase.actionItems.length === 0 ? (
                        <p className={styles.emptyText}>No active items or decisions for this phase.</p>
                      ) : (
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
                      )}
                    </div>
                  </div>
                );
              })
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
