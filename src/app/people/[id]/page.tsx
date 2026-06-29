import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { prisma } from '../../../lib/db';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

async function movePersonCompany(formData: FormData) {
  'use server';
  const personIdStr = formData.get('personId') as string;
  const newPartnerIdStr = formData.get('newPartnerId') as string;
  const newRole = formData.get('newRole') as string;
  const startDateStr = formData.get('startDate') as string;

  const personId = parseInt(personIdStr);
  const newPartnerId = parseInt(newPartnerIdStr);

  if (!isNaN(personId) && !isNaN(newPartnerId)) {
    const startDate = startDateStr ? new Date(startDateStr) : new Date();

    // Close any currently active affiliations (where endDate is null)
    await prisma.personAffiliation.updateMany({
      where: { personId, endDate: null },
      data: { endDate: startDate }
    });

    // Create a new affiliation
    await prisma.personAffiliation.create({
      data: {
        personId,
        partnerId: newPartnerId,
        role: newRole || 'Engineer',
        startDate
      }
    });

    // Update current partner on the Person record
    await prisma.person.update({
      where: { id: personId },
      data: { currentPartnerId: newPartnerId }
    });
  }

  revalidatePath(`/people/${personIdStr}`);
}

async function copyPerson(formData: FormData) {
  'use server';
  const personIdStr = formData.get('personId') as string;
  const copyEmail = formData.get('copyEmail') as string;

  const personId = parseInt(personIdStr);
  let newPersonId = personId;

  if (!isNaN(personId) && copyEmail) {
    const source = await prisma.person.findUnique({
      where: { id: personId }
    });

    if (source) {
      const copy = await prisma.person.create({
        data: {
          name: source.name,
          email: copyEmail.trim(),
          currentPartnerId: source.currentPartnerId,
          notes: source.notes
        }
      });
      newPersonId = copy.id;

      // Duplicate active affiliations if any
      const activeAff = await prisma.personAffiliation.findFirst({
        where: { personId, endDate: null }
      });

      if (activeAff) {
        await prisma.personAffiliation.create({
          data: {
            personId: copy.id,
            partnerId: activeAff.partnerId,
            role: activeAff.role,
            startDate: new Date()
          }
        });
      }
    }
  }

  redirect(`/people/${newPersonId}`);
}

async function deletePerson(formData: FormData) {
  'use server';
  const personIdStr = formData.get('personId') as string;
  const personId = parseInt(personIdStr);

  if (!isNaN(personId)) {
    await prisma.personAffiliation.deleteMany({ where: { personId } });
    await prisma.actionItem.updateMany({
      where: { assignedToPersonId: personId },
      data: { assignedToPersonId: null }
    });
    await prisma.person.delete({ where: { id: personId } });
  }

  redirect('/');
}

interface ActionWithPhase {
  id: number;
  description: string;
  status: string;
  createdAt: Date;
  phase: {
    name: string;
    project: {
      id: number;
      name: string;
      partner: {
        name: string;
      };
    };
  };
}

export default async function PersonProfilePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const personId = parseInt(id);

  if (isNaN(personId)) {
    return notFound();
  }

  // 1. Fetch Person with current partner, affiliations, and action items
  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: {
      currentPartner: true,
      affiliations: {
        include: {
          partner: true
        },
        orderBy: { startDate: 'asc' }
      },
      actionItems: {
        include: {
          phase: {
            include: {
              project: {
                include: {
                  partner: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!person) {
    return notFound();
  }

  const partners = await prisma.partner.findMany({ 
    orderBy: { name: 'asc' },
    include: { type: true }
  });

  // 2. Map action items to the affiliation they had at the time the action was created
  const groupedActions: Record<string, { partnerName: string; role: string; actions: ActionWithPhase[] }> = {};

  // Initialize groups for each affiliation to make sure they all appear, even if empty
  for (const aff of person.affiliations) {
    groupedActions[aff.id.toString()] = {
      partnerName: aff.partner.name,
      role: aff.role,
      actions: []
    };
  }

  const unassociatedActions: ActionWithPhase[] = [];

  // Group each action item
  for (const action of person.actionItems) {
    const actionDate = new Date(action.createdAt);
    
    // Find matching affiliation at actionDate
    const matchingAff = person.affiliations.find(aff => {
      const start = new Date(aff.startDate);
      const end = aff.endDate ? new Date(aff.endDate) : null;
      return actionDate >= start && (end === null || actionDate <= end);
    });

    if (matchingAff) {
      groupedActions[matchingAff.id.toString()].actions.push(action);
    } else {
      unassociatedActions.push(action);
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{person.name}</h1>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Current Organization:</span>{' '}
          <strong className={styles.highlightText}>{person.currentPartner.name}</strong>
          <span className={styles.metaSeparator}>|</span>
          <span className={styles.metaLabel}>Email:</span> {person.email}
        </div>
        {person.notes && <p className={styles.notes}>{person.notes}</p>}
      </header>

      <main className={styles.main}>
        {/* Section 1: Career History Timeline */}
        <section className={styles.section}>
          <h2>Career History</h2>
          <div className={styles.timeline}>
            {person.affiliations.map((aff) => {
              const startStr = new Date(aff.startDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
              const endStr = aff.endDate 
                ? new Date(aff.endDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
                : 'Present';
              
              return (
                <div key={aff.id} className={styles.timelineItem}>
                  <div className={styles.timelineDates}>{startStr} - {endStr}</div>
                  <div className={styles.timelineContent}>
                    <h3>{aff.role}</h3>
                    <div className={styles.timelineOrg}>{aff.partner.name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 2: Biographical Actions History */}
        <section className={styles.section}>
          <h2>Action & Decision History</h2>
          <p className={styles.sectionSubtext}>
            Historical activities and project decisions mapped to the organization/role they held at the time of action:
          </p>

          {person.affiliations.length === 0 ? (
            <p className={styles.emptyText}>No career history found for this person.</p>
          ) : (
            person.affiliations.map((aff) => {
              const group = groupedActions[aff.id.toString()];
              return (
                <div key={aff.id} className={styles.affiliationGroup}>
                  <div className={styles.groupHeader}>
                    <h3>{group.partnerName}</h3>
                    <span className={styles.groupRole}>{group.role}</span>
                  </div>

                  {group.actions.length === 0 ? (
                    <p className={styles.emptyActions}>No actions recorded during this tenure.</p>
                  ) : (
                    <ul className={styles.actionList}>
                      {group.actions.map((action) => (
                        <li key={action.id} className={styles.actionItem}>
                          <div className={styles.actionMeta}>
                            <span className={styles.actionDate}>
                              {new Date(action.createdAt).toLocaleDateString()}
                            </span>
                            <span className={`${styles.statusBadge} ${action.status === 'Completed' ? styles.statusCompleted : styles.statusPending}`}>
                              {action.status}
                            </span>
                          </div>
                          <div className={styles.actionDetails}>
                            <p className={styles.actionDesc}>{action.description}</p>
                            <span className={styles.actionContext}>
                              Project:{' '}
                              <Link href={`/projects/${action.phase.project.id}`}>
                                {action.phase.project.name}
                              </Link>{' '}
                              ({action.phase.name})
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}

          {unassociatedActions.length > 0 && (
            <div className={styles.affiliationGroup}>
              <div className={styles.groupHeader}>
                <h3>Other / Unassociated</h3>
              </div>
              <ul className={styles.actionList}>
                {unassociatedActions.map((action) => (
                  <li key={action.id} className={styles.actionItem}>
                    <div className={styles.actionMeta}>
                      <span className={styles.actionDate}>
                        {new Date(action.createdAt).toLocaleDateString()}
                      </span>
                      <span className={`${styles.statusBadge} ${action.status === 'Completed' ? styles.statusCompleted : styles.statusPending}`}>
                        {action.status}
                      </span>
                    </div>
                    <div className={styles.actionDetails}>
                      <p className={styles.actionDesc}>{action.description}</p>
                      <span className={styles.actionContext}>
                        Project:{' '}
                        <Link href={`/projects/${action.phase.project.id}`}>
                          {action.phase.project.name}
                        </Link>{' '}
                        ({action.phase.name})
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Profile Maintenance & Administration section */}
        <section className={styles.section}>
          <h2>Profile Maintenance</h2>
          <div className={styles.adminGrid}>
            {/* Form 1: Move Company */}
            <div className={styles.adminFormCard}>
              <h3>Move to Different Company</h3>
              <form action={movePersonCompany} className={styles.adminForm}>
                <input type="hidden" name="personId" value={personId} />
                <div className={styles.formGroup}>
                  <label htmlFor="newPartnerId" className={styles.formLabel}>New Organization</label>
                  <select id="newPartnerId" name="newPartnerId" required className={styles.select}>
                    <option value="">Select Partner...</option>
                    {partners.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.type?.name})</option>
                    ))}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="newRole" className={styles.formLabel}>Role / Title</label>
                  <input type="text" id="newRole" name="newRole" placeholder="e.g. Lead Systems Architect" required className={styles.input} />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="startDate" className={styles.formLabel}>Effective Date</label>
                  <input type="date" id="startDate" name="startDate" required className={styles.input} />
                </div>
                <button type="submit" className={styles.primaryButton}>Move Partner</button>
              </form>
            </div>

            {/* Form 2: Copy Profile */}
            <div className={styles.adminFormCard}>
              <h3>Copy Person Profile</h3>
              <p className={styles.formHelp}>Creates a duplicated profile with a different email address.</p>
              <form action={copyPerson} className={styles.adminForm}>
                <input type="hidden" name="personId" value={personId} />
                <div className={styles.formGroup}>
                  <label htmlFor="copyEmail" className={styles.formLabel}>New Email Address</label>
                  <input type="email" id="copyEmail" name="copyEmail" placeholder="e.g. user.new@company.com" required className={styles.input} />
                </div>
                <button type="submit" className={styles.primaryButton}>Copy Profile</button>
              </form>
            </div>

            {/* Form 3: Delete Profile */}
            <div className={styles.adminFormCard}>
              <h3>Delete Person Profile</h3>
              <p className={styles.formHelp}>Permanently removes this profile and career affiliations.</p>
              <form action={deletePerson} className={styles.adminForm}>
                <input type="hidden" name="personId" value={personId} />
                <button type="submit" className={styles.dangerButton}>
                  Delete Profile
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
