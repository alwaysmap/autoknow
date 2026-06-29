import { getEcosystemDashboardData } from '../../lib/dashboardData';
import EcosystemSummaryClient from './EcosystemSummaryClient';

export const dynamic = 'force-dynamic';

export default async function EcosystemSummaryPage() {
  const { serializedProjects, briefings, p85LeadTime, people } = await getEcosystemDashboardData();

  return (
    <EcosystemSummaryClient
      initialProjects={serializedProjects}
      briefings={briefings}
      p85LeadTime={p85LeadTime}
      people={people}
    />
  );
}
