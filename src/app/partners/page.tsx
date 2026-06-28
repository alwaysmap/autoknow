import { prisma } from '../../lib/db';
import { PartnerQueries } from '../../lib/partnerQueries';
import PartnersClient from './PartnersClient';

export const dynamic = 'force-dynamic';

interface SearchParams {
  user?: string;
}

export default async function PartnersPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const user = searchParams.user || '@dylan';

  const queries = new PartnerQueries(prisma);
  const partners = await queries.getAllPartners();

  // Fetch all people to resolve TEL links
  const people = await prisma.person.findMany({
    select: {
      id: true,
      name: true,
      email: true
    }
  });

  return (
    <PartnersClient
      partners={partners}
      currentUser={user}
      people={people}
    />
  );
}
