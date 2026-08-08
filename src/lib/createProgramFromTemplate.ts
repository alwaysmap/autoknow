// Template → program instantiation, extracted from the /programs/new server action
// (gh-286 part b) so a second caller can create program-shaped work without owning a
// form. Server-only (imports prisma). Lives apart from programTemplates.ts because
// that module reads and writes TEMPLATE rows; this one consumes a template to write
// Project/Phase rows. The split of responsibilities is deliberate:
// the CALLER owns policy — what is required (the /programs/new form insists on an SOP
// date; an initiative copy may be date-less, gh-286) — while this function owns the
// mechanics that must not fork per caller: template validation, role resolution, and
// the atomic project + phase-graph + seed-state write.
import { prisma } from './db';
import { getTemplateWithPhases } from './programTemplates';
import { validateTemplateDag } from './templateDag';
import { hillStatus } from './phase';
import { indexEntity } from './search';
import type { OwnerFieldsOrNone } from './owner';

export interface CreateProgramInput {
  name: string;
  partnerId: number;
  templateId: number;
  // A pair from lib/owner — spread straight into `data:` (its contract: no seam yields
  // the email alone, so no path can write one column and forget the other). NO_OWNER is
  // legal (gh-286 part c): an initiative copy starts unowned — the honest state until a
  // human assigns one — while /programs/new keeps requiring a real owner as its policy.
  owner: OwnerFieldsOrNone;
  // Nullable HERE because requiredness is caller policy, not instantiation mechanics.
  sopDate: Date | null;
  // Set when this program is an initiative's per-partner copy (gh-286).
  initiativeId?: number;
  products: { hasGas: boolean; hasGbi: boolean; hasDigitalKey: boolean; hasAap: boolean };
  // Attributed as the ProjectState source so creation appears in the activity feed
  // under whoever (or whatever flow) did it.
  createdBy: string;
}

/** Create a program from a template: validate, instantiate the phase graph atomically,
 *  index for search. Returns the created project's id. Throws on an unknown/empty
 *  template or one whose DAG no longer validates — callers surface the message. */
export async function createProgramFromTemplate(input: CreateProgramInput): Promise<{ id: number }> {
  const { name, partnerId, templateId, owner, sopDate, initiativeId, products, createdBy } = input;

  // Templates live in the database (PHASE_TEMPLATES_PLAN §7). Validate up front so an
  // unexpected value can't silently create a project with zero phases.
  const template = await getTemplateWithPhases(templateId);
  if (!template || template.phases.length === 0) {
    throw new Error(`Unknown project template: ${templateId}`);
  }

  // The template must still be a valid converging DAG at instantiation time.
  const validation = validateTemplateDag(
    template.phases.map((p) => ({ id: p.id, isEndPhase: p.isEndPhase, name: p.name })),
    template.phases.flatMap((p) => p.dependsOn.map((d) => ({ nodeId: p.id, dependsOnId: d.dependsOnId }))),
  );
  if (!validation.ok) {
    throw new Error(`Template “${template.name}” is invalid: ${validation.errors.map((e) => e.message).join(' ')}`);
  }

  // leadRole → concrete partner, only where unambiguous: "OEM" maps to the program's
  // partner when that partner IS an OEM; anything else is left for the user.
  const programPartner = await prisma.partner.findUnique({ where: { id: partnerId }, include: { type: true } });
  const leadPartnerFor = (leadRole: string | null) =>
    leadRole === 'OEM' && programPartner?.type?.name === 'OEM' ? programPartner.id : null;

  const firstPhaseName = template.phases[0]?.name;

  // Create the project and its full phase graph atomically — a failure partway
  // through must not leave a half-built project.
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { name, partnerId, ...owner, sopDate, initiativeId, ...products }
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

      if (p.name === firstPhaseName) {
        await tx.actionItem.create({
          data: {
            phaseId: phase.id,
            description: `Initial bring-up action for ${p.name}`,
            // The assignee columns are the same pair as the owner's, so fill BOTH —
            // this path had been writing the text alone, which is the defect #127 E6
            // is closing one model over (AGENTS lesson 7).
            assignedTo: owner.ownerName,
            assignedToPersonId: owner.ownerPersonId,
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

  await indexEntity('program', project.id);

  return { id: project.id };
}
