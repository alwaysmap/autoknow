import { prisma } from '../../lib/db';
import { PartnerQueries } from '../../lib/partnerQueries';
import { getCurrentUser } from '../../lib/session';
import PartnersClient from './PartnersClient';

export const dynamic = 'force-dynamic';

interface SearchParams {
  user?: string;
}

export default async function PartnersPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  // Default to the signed-in user; `?user=` is an explicit "view as" override
  // (this internal tool has no auth layer yet — see lib/auth.ts).
  const user = searchParams.user || (await getCurrentUser()).display;

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
