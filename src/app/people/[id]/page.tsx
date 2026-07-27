import { notFound } from 'next/navigation';
import PersonProfile from './PersonProfile';

export const dynamic = 'force-dynamic';

// The person route: an id in the path, nothing else. Everything you SEE lives in
// PersonProfile, which /me renders too — see that file's header for why the body is
// shared rather than copied.

export default async function PersonProfilePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const personId = parseInt(id);

  if (isNaN(personId)) {
    return notFound();
  }

  return <PersonProfile personId={personId} />;
}
