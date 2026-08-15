import { notFound } from 'next/navigation';
import PersonProfile from './PersonProfile';
import { parsePersonProgramsFilter } from '../../../lib/entityHref';

export const dynamic = 'force-dynamic';

// The person route: an id in the path, nothing else. Everything you SEE lives in
// PersonProfile, which /me renders too — see that file's header for why the body is
// shared rather than copied.

export default async function PersonProfilePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { id } = await props.params;
  const personId = parseInt(id);

  if (isNaN(personId)) {
    return notFound();
  }

  // `?filter=active` initializes the Programs table (design.md §6, #167). Parsed by
  // `lib/entityHref`, beside the builder that writes it — both ends of one contract.
  const { filter } = await props.searchParams;

  return <PersonProfile personId={personId} programsFilter={parsePersonProgramsFilter(filter)} />;
}
