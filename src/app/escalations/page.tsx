import { prisma } from '../../lib/db';
import { parseFilterParams, parseSortParams } from '../../lib/tableUrlState';
import EscalationsClient from './EscalationsClient';

export const dynamic = 'force-dynamic';

interface SearchParams {
  [key: string]: string | string[] | undefined; // per-column filters + sort/dir + q
}

/** Exactly what the table RENDERS — no more. "Requested of" and the close date are real
 *  columns on the model and are read on the detail page; selecting them here as well, for
 *  a table that shows neither, is a join and a payload nobody looks at. Each person comes back
 *  as `{ id, name }` — the `PersonRef` shape — so the client filters and sorts by the FK
 *  id and renders the NAME, without a people directory being shipped alongside just to
 *  resolve a string (#127 E7). */
const listSelect = {
  id: true,
  title: true,
  status: true,
  severity: true,
  orgLevel: true,
  createdAt: true,
  partner: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  ownerPerson: { select: { id: true, name: true } },
  decisionMakerPerson: { select: { id: true, name: true } },
} as const;

export default async function EscalationsPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;

  const [escalations, partners, projects, people] = await Promise.all([
    prisma.escalation.findMany({
      select: listSelect,
      // OPEN FIRST, then newest. The severity ordering the table leads on is applied
      // client-side by rank (lib/escalation), because Postgres would order the enum by its
      // declaration position — which happens to be right for severity and would silently
      // stop being right the moment a value is inserted anywhere but the end.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    // Archived programs are hidden from PICKERS, the same rule every other list follows
    // (lib/lifecycle's `visibleInLists`): raising a new escalation against an archived
    // program is not a thing anyone means to do.
    prisma.project.findMany({
      where: { isArchived: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.person.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const rows = escalations.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    severity: e.severity,
    orgLevel: e.orgLevel,
    createdAt: e.createdAt.toISOString(),
    partner: e.partner,
    project: e.project,
    owner: e.ownerPerson,
    decisionMaker: e.decisionMakerPerson,
  }));

  return (
    <EscalationsClient
      // Remount when the URL's params change — the client seeds filter/sort state from
      // initial* once (the rule /partners and /programs both follow).
      key={JSON.stringify(searchParams, Object.keys(searchParams).sort())}
      escalations={rows}
      partners={partners}
      projects={projects}
      people={people}
      initialFilters={parseFilterParams(searchParams, [
        'status', 'severity', 'orgLevel', 'partner', 'project', 'owner', 'decisionMaker',
      ])}
      initialSort={parseSortParams(searchParams)}
      initialQ={typeof searchParams.q === 'string' ? searchParams.q : ''}
    />
  );
}
