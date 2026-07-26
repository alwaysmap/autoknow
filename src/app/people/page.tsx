import { prisma } from '../../lib/db';
import { profilesAsOf } from '../../lib/profiles';
import PeopleClient from './PeopleClient';

export const dynamic = 'force-dynamic';

// The people directory: everyone AutoKnow knows about, with their current company,
// role, and how many programs they touch. Company deep-links (?company=) preselect
// the column funnel — same grammar as /partners (design.md §6).

import { parseFilterParams, parseSortParams } from '../../lib/tableUrlState';

interface SearchParams {
  [key: string]: string | string[] | undefined;
}

export default async function PeoplePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;

  const people = await prisma.person.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      currentPartner: { select: { id: true, name: true } },
      phaseInvolvements: { select: { phase: { select: { projectId: true } } } },
      actionItems: { select: { phase: { select: { projectId: true } } } },
    },
  });

  // ONE query for the whole page rather than one per row. Note the Company column above
  // still comes from `currentPartner` — this made the ROLE as-of, not the whole row;
  // demoting that cache is the rest of #127 E5.
  const affiliationByPerson = await profilesAsOf(people.map((p) => p.id));

  const rows = people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    companyId: p.currentPartner.id,
    company: p.currentPartner.name,
    role: affiliationByPerson.get(p.id)?.role ?? '',
    programs: new Set([
      ...p.phaseInvolvements.map((i) => i.phase.projectId),
      ...p.actionItems.map((a) => a.phase.projectId),
    ]).size,
  }));

  const initialFilters = parseFilterParams(searchParams, ['company', 'role']);
  const initialSort = parseSortParams(searchParams);
  const initialQ = typeof searchParams.q === 'string' ? searchParams.q : '';

  const partners = await prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });

  return <PeopleClient people={rows} partners={partners} initialFilters={initialFilters} initialSort={initialSort} initialQ={initialQ} />;
}
