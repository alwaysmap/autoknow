import { redirect } from 'next/navigation';
import { prisma } from '../../../lib/db';
import { listTemplates, getTemplateWithPhases } from '../../../lib/programTemplates';
import { validateTemplateDag } from '../../../lib/templateDag';
import { getCurrentUser } from '../../../lib/session';
import { hillStatus } from '../../../lib/phase';
import styles from './page.module.css';

// This page reads partners from the database at request time, so it must render
// dynamically rather than being statically prerendered at build (which has no DB).
export const dynamic = 'force-dynamic';

async function createProject(formData: FormData) {
  'use server';

  const name = formData.get('name') as string;
  const partnerIdStr = formData.get('partnerId') as string;
  const templateIdStr = formData.get('template') as string;
  const owner = formData.get('owner') as string;

  if (!name || !partnerIdStr || !templateIdStr) {
    throw new Error('Missing fields');
  }

  // Templates live in the database (PHASE_TEMPLATES_PLAN §7). Validate up front so an
  // unexpected value can't silently create a project with zero phases.
  const templateId = parseInt(templateIdStr, 10);
  const template = isNaN(templateId) ? null : await getTemplateWithPhases(templateId);
  if (!template || template.phases.length === 0) {
    throw new Error(`Unknown project template: ${templateIdStr}`);
  }

  // The template must still be a valid converging DAG at instantiation time.
  const validation = validateTemplateDag(
    template.phases.map((p) => ({ id: p.id, isEndPhase: p.isEndPhase, name: p.name })),
    template.phases.flatMap((p) => p.dependsOn.map((d) => ({ nodeId: p.id, dependsOnId: d.dependsOnId }))),
  );
  if (!validation.ok) {
    throw new Error(`Template “${template.name}” is invalid: ${validation.errors.map((e) => e.message).join(' ')}`);
  }

  const partnerId = parseInt(partnerIdStr, 10);
  if (isNaN(partnerId)) {
    throw new Error('Invalid partner');
  }

  // leadRole → concrete partner, only where unambiguous: "OEM" maps to the program's
  // partner when that partner IS an OEM; anything else is left for the user.
  const programPartner = await prisma.partner.findUnique({ where: { id: partnerId }, include: { type: true } });
  const leadPartnerFor = (leadRole: string | null) =>
    leadRole === 'OEM' && programPartner?.type?.name === 'OEM' ? programPartner.id : null;

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
      data: { projectId: created.id, theNeedle: 'On Track', hillChartProgress: 0, notes: 'Program created', source: createdBy },
    });

    const phasesMap: Record<number, { id: number }> = {};

    for (const p of template.phases) {
      const phase = await tx.phase.create({
        data: {
          name: p.name,
          projectId: created.id,
          forecastedDuration: p.durationWeeks * 7, // templates store weeks; runtime stays days
          description: p.description,
          googleFocus: p.googleFocus,
          isEndPhase: p.isEndPhase,
          leadPartnerId: leadPartnerFor(p.leadRole),
        }
      });
      phasesMap[p.id] = phase;

      // Status is derived from the dot's position on the hill — never chosen directly.
      const initialProgress = p.name === firstPhaseName ? 10 : 0;
      await tx.phaseState.create({
        data: {
          phaseId: phase.id,
          status: hillStatus(initialProgress),
          hillChartProgress: initialProgress,
          theNeedle: 'On Track'
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
      const phase = phasesMap[p.id];
      for (const dep of p.dependsOn) {
        const depPhase = phasesMap[dep.dependsOnId];
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
  const templates = await listTemplates(); // seeds built-ins on first touch

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
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
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
