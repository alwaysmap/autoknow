import { redirect } from 'next/navigation';
import { prisma } from '../../../lib/db';
import { TEMPLATES } from '../../../lib/templates';
import { getCurrentUser } from '../../../lib/session';
import styles from './page.module.css';

// This page reads partners from the database at request time, so it must render
// dynamically rather than being statically prerendered at build (which has no DB).
export const dynamic = 'force-dynamic';

async function createProject(formData: FormData) {
  'use server';

  const name = formData.get('name') as string;
  const partnerIdStr = formData.get('partnerId') as string;
  const templateName = formData.get('template') as string;
  const owner = formData.get('owner') as string;

  if (!name || !partnerIdStr || !templateName) {
    throw new Error('Missing fields');
  }

  // Validate the template up front so an unexpected value can't silently create a
  // project with zero phases.
  if (!(templateName in TEMPLATES)) {
    throw new Error(`Unknown project template: ${templateName}`);
  }
  const template = TEMPLATES[templateName as keyof typeof TEMPLATES];

  const partnerId = parseInt(partnerIdStr, 10);
  if (isNaN(partnerId)) {
    throw new Error('Invalid partner');
  }

  const firstPhaseName = template.phases[0]?.name;

  // Create the project and its full phase graph atomically — a failure partway
  // through must not leave a half-built project.
  const createdBy = (await getCurrentUser()).handle;

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { name, partnerId, ownerName: owner || null }
    });

    // Log program creation so it appears in the activity feed.
    await tx.projectState.create({
      data: { projectId: created.id, theNeedle: 'Low', hillChartProgress: 0, notes: 'Program created', source: createdBy },
    });

    const phasesMap: Record<string, { id: number }> = {};

    for (const p of template.phases) {
      const phase = await tx.phase.create({
        data: {
          name: p.name,
          projectId: created.id,
          forecastedDuration: p.forecastedDuration
        }
      });
      phasesMap[p.name] = phase;

      await tx.phaseState.create({
        data: {
          phaseId: phase.id,
          status: p.name === firstPhaseName ? 'Active WIP' : 'Not Started',
          hillChartProgress: p.name === firstPhaseName ? 10 : 0,
          theNeedle: 'Low'
        }
      });

      if (owner && p.name === firstPhaseName) {
        await tx.actionItem.create({
          data: {
            phaseId: phase.id,
            description: `Initial bring-up action for ${p.name}`,
            assignedTo: owner,
            status: 'Pending'
          }
        });
      }
    }

    for (const p of template.phases) {
      const phase = phasesMap[p.name];
      for (const depName of p.dependsOn) {
        const depPhase = phasesMap[depName];
        if (depPhase) {
          await tx.phaseDependency.create({
            data: {
              phaseId: phase.id,
              dependsOnPhaseId: depPhase.id
            }
          });
        }
      }
    }

    return created;
  });

  // Redirect to project details page (outside the transaction).
  redirect(`/projects/${project.id}`);
}

export default async function NewProjectPage() {
  const partners = await prisma.partner.findMany({
    orderBy: { name: 'asc' },
    include: { type: true }
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.brand}>AutoKnow</div>
        <h1>Create New Project</h1>
      </header>

      <main className={styles.main}>
        <form action={createProject} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="name">Project Name</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              placeholder="e.g. Ford F-150 AAOS Bring-up"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="partnerId">Partner (OEM / Supplier)</label>
            <select id="partnerId" name="partnerId" required>
              <option value="">Select a partner...</option>
              {partners.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type?.name})
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="template">Project Template (Critical Chain DAG)</label>
            <select id="template" name="template" required>
              <option value="AAOS">Android IVI (AAOS) Bring-up - 5 standard phases</option>
              <option value="GAS">Google Automotive Services (GAS) Integration - 3 standard phases</option>
              <option value="Digital Key">Digital Key Bring-up - 3 standard phases</option>
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="owner">Owner (Handle)</label>
            <input
              type="text"
              id="owner"
              name="owner"
              required
              placeholder="e.g. jdoe@google.com"
            />
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.submitBtn}>
              Create Project
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
