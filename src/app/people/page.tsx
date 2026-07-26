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
      phaseInvolvements: { select: { phase: { select: { projectId: true } } } },
      actionItems: { select: { phase: { select: { projectId: true } } } },
    },
  });

  // ONE query for the whole page rather than one per row, and now the source of BOTH
  // company and role. It used to feed only Role while Company came off the
  // `currentPartnerId` cache, so a row could name one employer and that employer's
  // predecessor's job title (#127 E5).
  const affiliationByPerson = await profilesAsOf(people.map((p) => p.id));

  const rows = people.map((p) => {
    // No period covering today is a real answer — a gap, or a hire that starts next
    // month. Blank cells, never a guessed company: the funnel filter groups on the
    // rendered value, so an invented one would open a phantom facet.
    const at = affiliationByPerson.get(p.id);
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      companyId: at?.partnerId ?? null,
      company: at?.partner.name ?? '',
      role: at?.role ?? '',
      programs: new Set([
        ...p.phaseInvolvements.map((i) => i.phase.projectId),
        ...p.actionItems.map((a) => a.phase.projectId),
      ]).size,
    };
  });

  const initialFilters = parseFilterParams(searchParams, ['company', 'role']);
  const initialSort = parseSortParams(searchParams);
  const initialQ = typeof searchParams.q === 'string' ? searchParams.q : '';

  const partners = await prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });

  return <PeopleClient people={rows} partners={partners} initialFilters={initialFilters} initialSort={initialSort} initialQ={initialQ} />;
}
