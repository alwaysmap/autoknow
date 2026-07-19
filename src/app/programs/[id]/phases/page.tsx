import { notFound } from 'next/navigation';
import { prisma } from '../../../../lib/db';
import ProgramPhaseEditor from '../../../../components/ProgramPhaseEditor';

export const dynamic = 'force-dynamic';

// The all-up phase structure editor for one program (mirrors /templates/[id]/edit).
// The rail on the project page is read-only on structure; every add/remove/rewire
// happens here, behind whole-graph DAG validation.
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
        },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!project) return notFound();

  const phases = project.phases.map((p) => ({
    id: p.id,
    name: p.name,
    forecastedDuration: p.forecastedDuration,
    progress: p.states[0]?.hillChartProgress ?? 0,
    dependsOn: p.dependencies.map((d) => d.dependsOnPhaseId),
    description: p.description ?? null,
  }));

  return <ProgramPhaseEditor projectId={projectId} projectName={project.name} phases={phases} />;
}
