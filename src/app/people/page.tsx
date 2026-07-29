import { prisma } from '../../lib/db';
import { profilesAsOf } from '../../lib/profiles';
import { personProgramCounts } from '../../lib/personPrograms';
import PeopleClient from './PeopleClient';

export const dynamic = 'force-dynamic';

// The people directory: everyone AutoKnow knows about, with their current company,
// role, and how many programs they touch — split into Leads and Involved (#243):
// collapsing TEL ownership and phase/action-item involvement into one number is what
// let a person's list count silently disagree with their own page's Programs table.
// `personProgramCounts` (lib/personPrograms) classifies the same three routes the
// person page's Connection column reads off `via` (#144) — a separate, synchronous
// computation (the list can't afford a per-row DB round trip just for a count), kept
// honest by the fixture `tests/personPrograms.test.ts` pins. Company deep-links
// (?company=) preselect the column funnel — same grammar as /partners (design.md §6).

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
      ownedProjects: { select: { id: true } },
      phaseInvolvements: { select: { phase: { select: { project: { select: { id: true } } } } } },
      actionItems: { select: { phase: { select: { project: { select: { id: true } } } } } },
    },
  });

  // ONE query for the whole page rather than one per row, and the source of BOTH company
  // and role — they are one fact and must not come from two places (#127 E5).
  const profileByPerson = await profilesAsOf(people.map((p) => p.id));

  const rows = people.map((p) => {
    // No period covering today is a real answer — a gap, or a hire that starts next
    // month. Blank cells, never a guessed company: the funnel filter groups on the
    // rendered value, so an invented one would open a phantom facet.
    const profile = profileByPerson.get(p.id);
    const { leads, involved } = personProgramCounts({
      owned: p.ownedProjects,
      phaseInvolvements: p.phaseInvolvements,
      actionItems: p.actionItems,
    });
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      companyId: profile?.partnerId ?? null,
      company: profile?.partner.name ?? '',
      role: profile?.role ?? '',
      programsLed: leads,
      programsInvolved: involved,
    };
  });

  const initialFilters = parseFilterParams(searchParams, ['company', 'role']);
  const initialSort = parseSortParams(searchParams);
  const initialQ = typeof searchParams.q === 'string' ? searchParams.q : '';

  const partners = await prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });

  return <PeopleClient people={rows} partners={partners} initialFilters={initialFilters} initialSort={initialSort} initialQ={initialQ} />;
}
