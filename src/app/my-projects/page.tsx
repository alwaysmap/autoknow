import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface SearchParams {
  user?: string;
}

export default async function MyProjectsPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const user = searchParams.user || '@dylan';
  redirect(`/me?user=${encodeURIComponent(user)}`);
}
