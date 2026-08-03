import { getEcosystemDashboardData } from '../../../lib/dashboardData';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import PageShell from '../../../components/PageShell';
import CycleTimeScatterPlot from '../../../components/CycleTimeScatterPlot';

// The phase cycle-time view (autoknow-7ii), and THE statement of why it lives here rather
// than on /ecosystem — the two pointers back at this file (the dashboard's kebab and the
// component's CSS) exist so this argument has one home.
//
// The chart is ONE ROW PER PHASE NAME, so its height is set by the portfolio's vocabulary
// rather than by a layout choice: 44 names in the demo seed at 60px each, plus 100 for the
// axes, is a 2740-tall viewBox — ~3800px once that scales up to the 1100px column — taller than the whole
// dashboard put together, which is why it is not a section there. It grows with the
// business.
//
// It WAS on the dashboard until 2026-07-18 (`0ae0aa5`), removed when that page was slimmed
// to strip + briefing. This does not reopen that decision: the chart is not returning to
// /ecosystem, it is getting the one surface where its height is nobody else's problem.
// Note it was never TALL there — `.container` pinned it to 400px, so what that page showed
// was the crushed sliver the component's CSS comment describes.
//
// The data comes from the same `getEcosystemDashboardData` the dashboard calls — this page
// adds no new query, it renders fields that were already being computed and discarded.

export const dynamic = 'force-dynamic';

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
