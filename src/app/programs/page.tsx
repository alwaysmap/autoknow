import { prisma } from '../../lib/db';
import { runMonteCarlo } from '../../lib/forecast';
import { computeCriticalChain } from '../../lib/criticalChain';
import { sopBufferCategory } from '../../lib/sop';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import Link from 'next/link';
import ProgramsClient from './ProgramsClient';
import PageShell from '../../components/PageShell';
import KebabMenu from '../../components/KebabMenu';
import { parseFilterParams, parseSortParams } from '../../lib/tableUrlState';

export const dynamic = 'force-dynamic';

export default async function ProgramsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getLocale();
  const sp = await props.searchParams;
  const initialMinRisk = typeof sp.minRisk === 'string' ? Math.max(0, Math.min(2, parseInt(sp.minRisk, 10) || 0)) : 0;
  const initialSort = sp.sort === 'risk' ? ('risk' as const) : null;
  const initialActiveOnly = sp.filter === 'active';
  // Shareable table state (design.md §6): canonical per-column params + sort/dir + q.
  // The legacy ?minRisk / ?filter=active deep links above still preselect; any change
  // in the UI rewrites the URL to the canonical form.
  const initialFilters = parseFilterParams(sp, ['partner.name', 'partner.region', 'ownerName', 'theNeedle', 'status', 'sopOutlook']);
  const initialTableSort = sp.sort === 'risk' ? null : parseSortParams(sp);
  const initialQ = typeof sp.q === 'string' ? sp.q : '';
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
          },
          dependencies: true
        }
      }
    }
  });

  // Snapshot "now" once per request (server-side) so the deterministic SOP outlook is
  // stable across SSR + hydration — same rule as the ecosystem dashboard.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const serializedProjects = projects.map(proj => {
    const unstartedCount = proj.phases.filter(p =>
      p.states[0]?.status === 'Not Started' || !p.states[0]
    ).length;
    const sim = runMonteCarlo(unstartedCount, proj.id);

    // Deterministic critical-chain buffer (NOT the Monte Carlo sim): remaining chain
    // days vs the SOP target is THE on-track signal, and it drives the SOP-outlook
    // column + the ecosystem "SOP at risk" tile's deep link.
    const chain = computeCriticalChain(
      proj.phases.map((p) => ({
        id: p.id,
        name: p.name,
        forecastedDuration: p.forecastedDuration,
        progress: p.states[0]?.hillChartProgress ?? 0,
        parentIds: p.dependencies.map((d) => d.dependsOnPhaseId),
      })),
    );
    const sopOutlook = sopBufferCategory(
      {
        isArchived: proj.isArchived,
        lifecycle: proj.lifecycle,
        hillChartProgress: proj.hillChartProgress,
        sopDate: proj.sopDate ? proj.sopDate.toISOString() : null,
        chainRemainingDays: chain.remainingDays,
      },
      now,
    );

    return {
      id: proj.id,
      name: proj.name,
      isArchived: proj.isArchived,
      lifecycle: proj.lifecycle,
      theNeedle: proj.theNeedle,
      hillChartProgress: proj.hillChartProgress,
      sopDate: proj.sopDate ? proj.sopDate.toISOString() : null,
      sopOutlook,
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
    <PageShell
      title={t(locale, 'navPrograms')}
      actions={
        // The list had no create affordance (#—): a ⋯ menu beside the title, matching
        // /partners and /people. The item is a real link to the existing full-page
        // create flow (template DAG + phase graph) — "everything is a URL" (design.md).
        <KebabMenu ariaLabel={t(locale, 'moreActions')}>
          <Link href="/programs/new" data-testid="new-program">{t(locale, 'createProject')}</Link>
        </KebabMenu>
      }
    >
      <ProgramsClient
        // Remount when the URL's params change: the client seeds its filter/sort
        // state from initial* once, so same-route navigation (e.g. clicking the
        // header "Programs" link while filtered) must not leave stale view state.
        key={JSON.stringify(sp, Object.keys(sp).sort())}
        initialFilters={initialFilters}
        initialTableSort={initialTableSort}
        initialQ={initialQ}
        initialProjects={serializedProjects}
        people={people}
        regions={regions.map(r => r.name)}
        partnerTypes={partnerTypes.map(t => t.name)}
        initialMinRisk={initialMinRisk}
        initialSort={initialSort}
        initialActiveOnly={initialActiveOnly}
      />
    </PageShell>
  );
}
