import { redirect } from 'next/navigation';

// /search folded into the landing page (2026-07-20, user call): the landing IS the
// search experience now, so a second surface running the same component would be a
// duplicate to keep in sync. Kept as a redirect because `/search?q=…` links have
// been shareable and shouldn't rot.

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  lang?: string;
}

export default async function SearchPage(props: { searchParams: Promise<SearchParams> }) {
  const { q, lang } = await props.searchParams;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (lang) params.set('lang', lang);
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : '/');
}
