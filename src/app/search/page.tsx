import UnifiedSearch from '../../components/UnifiedSearch';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
}

export default async function SearchPage(props: { searchParams: Promise<SearchParams> }) {
  const { q } = await props.searchParams;

  return (
    <div style={{ padding: '32px 40px', maxWidth: 820 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Search</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4 }}>
          Semantic search across partners, programs, people, and ingested context. Use the
          chips to include or exclude types.
        </p>
      </header>
      <UnifiedSearch
        initialQuery={q || ''}
        autoFocus
        placeholder="Search partners, programs, people, context…"
      />
    </div>
  );
}
