import { notFound, redirect } from 'next/navigation';
import { prisma } from '../../../../lib/db';
import ProgramPhaseEditor from '../../../../components/ProgramPhaseEditor';
import { initiativeProjectHref } from '../../../../lib/entityHref';

export const dynamic = 'force-dynamic';

// The all-up phase editor for one program (mirrors /templates/[id]/edit). Since #crw.1
// it is the ONE surface that changes a phase: structure, name, forecast, Goal & DoD and
// involvement all live here, behind whole-graph DAG validation. The rail on the project
// page reads a phase; it does not edit one.
//
// The involvement pickers are entity references, so their options must be the canonical
// rows (AGENTS lesson 3) — hence the two directory queries. Names only: this surface
// changes WHO is involved, and a person's employer is an as-of question that belongs to
// the surfaces that display it.
export default async function ProgramPhasesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId)) return notFound();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      phases: {
        include: {
          states: { orderBy: { timestamp: 'desc' }, take: 1 },
          dependencies: true,
          partners: { include: { partner: { select: { id: true, name: true } } } },
          people: { include: { person: { select: { id: true, name: true } } } },
        },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!project) return notFound();

  // Copies cannot deviate from their initiative's steps (owner call 2026-08-08) — the
  // editor never opens for one; saveProgramPhases refuses them besides (lesson 2).
  if (project.initiativeId != null) {
    redirect(initiativeProjectHref(project.initiativeId, project.id));
  }

  const [allPartners, allPeople] = await Promise.all([
    prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.person.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const phases = project.phases.map((p) => ({
    id: p.id,
    name: p.name,
    forecastedDuration: p.forecastedDuration,
    progress: p.states[0]?.hillChartProgress ?? 0,
    dependsOn: p.dependencies.map((d) => d.dependsOnPhaseId),
    description: p.description ?? null,
    partners: p.partners.map((pp) => ({
      linkId: pp.id, entityId: pp.partnerId, name: pp.partner.name, role: pp.role,
    })),
    people: p.people.map((pp) => ({
      linkId: pp.id, entityId: pp.personId, name: pp.person.name, role: pp.role,
    })),
  }));

  return (
    <ProgramPhaseEditor projectId={projectId} projectName={project.name} phases={phases}
      allPartners={allPartners} allPeople={allPeople} />
  );
}
