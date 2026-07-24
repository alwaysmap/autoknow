import { getEcosystemDashboardData } from '../../lib/dashboardData';
import EcosystemSummaryClient from './EcosystemSummaryClient';

export const dynamic = 'force-dynamic';

export default async function EcosystemSummaryPage() {
  const { serializedProjects, people, liveConstraints } = await getEcosystemDashboardData();

  // Snapshot "now" server-side so SSR and hydration agree. This is an async Server
  // Component — Date.now() runs once per request on the server, not on every client
  // render, so the react-hooks purity rule (which assumes client re-render) is a
  // false positive here.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <EcosystemSummaryClient
      initialProjects={serializedProjects}
      people={people}
      liveConstraints={liveConstraints}
      now={now}
    />
  );
}
