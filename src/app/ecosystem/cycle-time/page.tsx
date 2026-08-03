import { getEcosystemDashboardData } from '../../../lib/dashboardData';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import PageShell from '../../../components/PageShell';
import CycleTimeScatterPlot from '../../../components/CycleTimeScatterPlot';

// The phase cycle-time view (autoknow-7ii). Its own page, not a section on /ecosystem: the
// chart is ONE ROW PER PHASE NAME, so its height is set by the portfolio's vocabulary
// rather than by a layout choice — 44 names in the demo seed, and it grows with the
// business. On the dashboard that made it taller than every other section combined and
// pushed the briefing below the fold; here it can be exactly as tall as it needs to be,
// which is the only place a chart like this reads honestly.
//
// The data comes from the same `getEcosystemDashboardData` the dashboard calls — this page
// adds no new query, it renders fields that were already being computed and discarded.

export default async function CycleTimePage() {
  const locale = await getLocale();
  const { cycleTimeData, cycleTimeStats } = await getEcosystemDashboardData();

  return (
    <PageShell
      title={t(locale, 'cycleTimeTitle')}
      subtitle={t(locale, 'cycleTimeSub')}
      maxWidth="68.75rem"
    >
      <CycleTimeScatterPlot data={cycleTimeData} stats={cycleTimeStats} />
    </PageShell>
  );
}
