import { prisma } from '../../lib/db';
import { getAllPartners } from '../../lib/partnerQueries';
import { getCurrentUser } from '../../lib/session';
import { deriveScore } from '../../lib/relationship';
import PartnersClient from './PartnersClient';

export const dynamic = 'force-dynamic';

import { parseFilterParams, parseSortParams } from '../../lib/tableUrlState';

interface SearchParams {
  user?: string;
  [key: string]: string | string[] | undefined; // per-column filters + sort/dir (shareable URLs)
}

export default async function PartnersPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  // Default to the signed-in user; `?user=` is an explicit "view as" override
  // (this internal tool has no auth layer yet — see lib/auth.ts).
  const user = searchParams.user || (await getCurrentUser()).display;

  const partners = await getAllPartners();

  // Fetch all people to resolve TEL links
  const people = await prisma.person.findMany({
    select: {
      id: true,
      name: true,
      email: true
    }
  });

  // Relationship health per partner: latest state → score, previous → ghost ring.
  // One query, newest-first, reduced to the first two rows per partner.
  const states = await prisma.partnerState.findMany({
    orderBy: { timestamp: 'desc' },
    select: { partnerId: true, relationshipScore: true, theNeedle: true },
  });
  // Newest-first rows → latest score + a capped oldest→newest history per partner.
  const relationship: Record<number, { score: number | null; history: number[] }> = {};
  for (const s of states) {
    const entry = (relationship[s.partnerId] ??= { score: deriveScore(s), history: [] });
    if (entry.history.length < 10) entry.history.unshift(deriveScore(s));
  }

  // Type/region options for the New partner form.
  const [types, regions] = await Promise.all([
    prisma.partnerType.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.region.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  // Shareable table state (design.md §6): filters, sort, and the ownership toggle
  // all round-trip through the URL.
  const initialFilters = parseFilterParams(searchParams, ['type', 'region', 'relationship']);
  const initialSort = parseSortParams(searchParams);
  const initialMine = searchParams.mine === '1';
  const initialQ = typeof searchParams.q === 'string' ? searchParams.q : '';

  return (
    <PartnersClient
      // Remount when the URL's params change — the client seeds filter/sort state
      // from initial* once (see programs/page.tsx for the same rule).
      key={JSON.stringify(searchParams, Object.keys(searchParams).sort())}
      partners={partners}
      initialFilters={initialFilters}
      initialSort={initialSort}
      initialMine={initialMine}
      initialQ={initialQ}
      currentUser={user}
      people={people}
      relationship={relationship}
      types={types}
      regions={regions}
    />
  );
}
