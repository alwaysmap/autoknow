import { getEcosystemDashboardData } from '../../lib/dashboardData';
import { parseFilterParams, parseSortParams } from '../../lib/tableUrlState';
import EcosystemSummaryClient from './EcosystemSummaryClient';

export const dynamic = 'force-dynamic';

export default async function EcosystemSummaryPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const sp = await props.searchParams;
  const { serializedProjects, people, liveConstraints } = await getEcosystemDashboardData();

  // Snapshot "now" server-side so SSR and hydration agree. This is an async Server
  // Component — Date.now() runs once per request on the server, not on every client
  // render, so the react-hooks purity rule (which assumes client re-render) is a
  // false positive here.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <EcosystemSummaryClient
      // Remount when the URL's params change: the client seeds its filter/sort state
      // from initial* once, so same-route navigation (clicking the header link while
      // filtered) must not leave stale view state. Same reason as /programs.
      key={JSON.stringify(sp, Object.keys(sp).sort())}
      initialProjects={serializedProjects}
      people={people}
      liveConstraints={liveConstraints}
      now={now}
      initialFilters={parseFilterParams(sp, ['ownerName', 'theNeedle'])}
      initialTableSort={parseSortParams(sp)}
    />
  );
}
