import { prisma } from '../../lib/db';
import ProgramsClient from './ProgramsClient';

export const dynamic = 'force-dynamic';

function lcg(seed: number) {
  let val = seed;
  return function() {
    val = (val * 1664525 + 1013904223) % 4294967296;
    return val / 4294967296;
  };
}

function runMonteCarlo(remainingPhasesCount: number, seed: number): { p50: number; p85: number; p95: number } {
  if (remainingPhasesCount === 0) {
    return { p50: 0, p85: 0, p95: 0 };
  }

  const rand = lcg(seed);
  const runs = 1000;
  const durations: number[] = [];

  for (let r = 0; r < runs; r++) {
    let projectDuration = 0;
    for (let p = 0; p < remainingPhasesCount; p++) {
      const u1 = rand() || 0.0001;
      const u2 = rand() || 0.0001;
      const normalRand = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const phaseDuration = Math.max(3, 12 + normalRand * 4);
      projectDuration += phaseDuration;
    }
    durations.push(projectDuration);
  }

  durations.sort((a, b) => a - b);

  return {
    p50: Math.round(durations[Math.floor(runs * 0.50)]),
    p85: Math.round(durations[Math.floor(runs * 0.85)]),
    p95: Math.round(durations[Math.floor(runs * 0.95)])
  };
}

export default async function ProgramsPage() {
  const projects = await prisma.project.findMany({
    include: {
      partner: {
        include: {
          type: true,
          region: true
        }
      },
      phases: {
        include: {
          states: {
            orderBy: { timestamp: 'desc' },
            take: 1
          }
        }
      }
    }
  });

  const serializedProjects = projects.map(proj => {
    const unstartedCount = proj.phases.filter(p => 
      p.states[0]?.status === 'Not Started' || !p.states[0]
    ).length;
    const sim = runMonteCarlo(unstartedCount, proj.id);

    return {
      id: proj.id,
      name: proj.name,
      isArchived: proj.isArchived,
      theNeedle: proj.theNeedle,
      hillChartProgress: proj.hillChartProgress,
      sopDate: proj.sopDate ? proj.sopDate.toISOString() : null,
      ownerName: proj.ownerName,
      volumeFirstYear: proj.volumeFirstYear,
      partner: {
        id: proj.partner.id,
        name: proj.partner.name,
        type: proj.partner.type?.name || 'Unknown',
        region: proj.partner.region?.name || null
      },
      phases: proj.phases.map(p => ({
        id: p.id,
        name: p.name,
        states: p.states.map(s => ({
          status: s.status,
          theNeedle: s.theNeedle,
          hillChartProgress: s.hillChartProgress
        }))
      })),
      forecast: {
        remainingPhases: unstartedCount,
        sim
      }
    };
  });

  const people = await prisma.person.findMany({
    select: {
      id: true,
      name: true,
      email: true
    }
  });

  const regions = await prisma.region.findMany({ select: { name: true } });
  const partnerTypes = await prisma.partnerType.findMany({ select: { name: true } });

  return (
    <div style={{ padding: '0 40px', minHeight: '100vh', backgroundColor: 'var(--white)' }}>
      <header style={{ borderBottom: '1px solid var(--border)', padding: '24px 0' }}>
        <h1 style={{ fontFamily: 'var(--head-font)', fontSize: '1.5rem', fontWeight: 600, margin: 0, color: 'var(--fg)' }}>
          Programs
        </h1>
      </header>

      <main style={{ padding: '32px 0' }}>
        <ProgramsClient 
          initialProjects={serializedProjects} 
          people={people} 
          regions={regions.map(r => r.name)}
          partnerTypes={partnerTypes.map(t => t.name)}
        />
      </main>
    </div>
  );
}
