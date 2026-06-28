import { redirect } from 'next/navigation';
import { prisma } from '../../../lib/db';
import { TEMPLATES } from '../../../lib/templates';
import styles from './page.module.css';

async function createProject(formData: FormData) {
  'use server';

  const name = formData.get('name') as string;
  const partnerIdStr = formData.get('partnerId') as string;
  const templateName = formData.get('template') as keyof typeof TEMPLATES;
  const owner = formData.get('owner') as string;

  if (!name || !partnerIdStr || !templateName) {
    throw new Error('Missing fields');
  }

  const partnerId = parseInt(partnerIdStr, 10);

  // 1. Create the Project
  const project = await prisma.project.create({
    data: {
      name,
      partnerId,
      ownerName: owner || null
    }
  });

  // 2. Fetch standard phases for the template
  const template = TEMPLATES[templateName];
  if (template) {
    const phasesMap: Record<string, { id: number }> = {};

    // 3. Create the phases
    for (const p of template.phases) {
      const phase = await prisma.phase.create({
        data: {
          name: p.name,
          projectId: project.id,
          forecastedDuration: p.forecastedDuration
        }
      });
      phasesMap[p.name] = phase;

      // Create a default initial state for each phase
      await prisma.phaseState.create({
        data: {
          phaseId: phase.id,
          status: p.name === template.phases[0].name ? 'Active WIP' : 'Not Started',
          hillChartProgress: p.name === template.phases[0].name ? 10 : 0,
          theNeedle: 'Low'
        }
      });

      // If owner is specified, assign it to the first phase or create a placeholder action item
      if (owner && p.name === template.phases[0].name) {
        await prisma.actionItem.create({
          data: {
            phaseId: phase.id,
            description: `Initial bring-up action for ${p.name}`,
            assignedTo: owner,
            status: 'Pending'
          }
        });
      }
    }

    // 4. Create dependencies
    for (const p of template.phases) {
      const phase = phasesMap[p.name];
      for (const depName of p.dependsOn) {
        const depPhase = phasesMap[depName];
        if (depPhase) {
          await prisma.phaseDependency.create({
            data: {
              phaseId: phase.id,
              dependsOnPhaseId: depPhase.id
            }
          });
        }
      }
    }
  }

  // Redirect to project details page
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
