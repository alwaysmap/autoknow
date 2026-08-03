import { getEcosystemDashboardData } from '../../../lib/dashboardData';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import PageShell from '../../../components/PageShell';
import CycleTimeScatterPlot from '../../../components/CycleTimeScatterPlot';

// The phase cycle-time view (autoknow-7ii).
//
// WHY ITS OWN PAGE, honestly: because the user asked for it when the chart was one row per
// phase name and ~3800px tall. That reason is GONE — the rework made it one population of
// completed work at a constant 800x380, so it would now fit on /ecosystem comfortably. The
// page survives on the weaker but still real argument that the dashboard's density is
// deliberate and this is a diagnostic rather than a headline, plus the kebab costing that
// page no vertical space. If someone wants it back inline, nothing here argues against it;
// the height objection no longer applies and this comment should not be read as if it did.
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
