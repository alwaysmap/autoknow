import { getEcosystemDashboardData } from '../../lib/dashboardData';
import EcosystemSummaryClient from './EcosystemSummaryClient';

export const dynamic = 'force-dynamic';

export default async function EcosystemSummaryPage() {
  const { serializedProjects, people } = await getEcosystemDashboardData();

  return (
    <EcosystemSummaryClient
      initialProjects={serializedProjects}
      people={people}
    />
  );
}
