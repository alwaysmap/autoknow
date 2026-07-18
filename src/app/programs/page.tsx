import { prisma } from '../../lib/db';
import { runMonteCarlo } from '../../lib/forecast';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import ProgramsClient from './ProgramsClient';

export const dynamic = 'force-dynamic';

export default async function ProgramsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getLocale();
  const sp = await props.searchParams;
  const initialMinRisk = typeof sp.minRisk === 'string' ? Math.max(0, Math.min(2, parseInt(sp.minRisk, 10) || 0)) : 0;
  const initialSort = sp.sort === 'risk' ? ('risk' as const) : null;
  const initialActiveOnly = sp.filter === 'active';
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
      <header style={{ borderBottom: '1px solid var(--border)', padding: '14px 0 10px' }}>
        <h1 style={{ fontFamily: 'var(--head-font)', fontSize: '1.5rem', fontWeight: 600, margin: 0, color: 'var(--fg)' }}>
          {t(locale, 'navPrograms')}
        </h1>
      </header>

      <main style={{ padding: '32px 0' }}>
        <ProgramsClient
          initialProjects={serializedProjects}
          people={people}
          regions={regions.map(r => r.name)}
          partnerTypes={partnerTypes.map(t => t.name)}
          initialMinRisk={initialMinRisk}
          initialSort={initialSort}
          initialActiveOnly={initialActiveOnly}
        />
      </main>
    </div>
  );
}
