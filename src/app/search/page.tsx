import Link from 'next/link';
import { prisma } from '../../lib/db';
import { searchVectorDatabase, generateDeterministicEmbedding } from '../../lib/vector';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
}

export default async function SearchResultsPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const query = searchParams.q || '';

  let dbPartners: any[] = [];
  let dbProjects: any[] = [];
  let dbPeople: any[] = [];
  let vectorResults: any[] = [];

  if (query.trim()) {
    const cleanQuery = query.trim();
    const queryEmbedding = generateDeterministicEmbedding(cleanQuery);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    // 1. Vector search partners
    const rawPartners = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, type, (1 - (embedding <=> $1::vector)) as similarity 
       FROM "Partner" 
       WHERE embedding IS NOT NULL 
       ORDER BY embedding <=> $1::vector 
       LIMIT 5`,
      vectorStr
    );
    dbPartners = rawPartners.filter(p => p.similarity > 0.15);

    // 2. Vector search projects
    const rawProjects = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.name, p."partnerId", p."isArchived", 
              pt.name as "partnerName",
              (1 - (p.embedding <=> $1::vector)) as similarity 
       FROM "Project" p
       JOIN "Partner" pt ON p."partnerId" = pt.id
       WHERE p."isArchived" = false AND p.embedding IS NOT NULL 
       ORDER BY p.embedding <=> $1::vector 
       LIMIT 5`,
      vectorStr
    );
    dbProjects = rawProjects.filter(p => p.similarity > 0.15).map(p => ({
      ...p,
      partner: { name: p.partnerName }
    }));

    // 3. Vector search people
    const rawPeople = await prisma.$queryRawUnsafe<any[]>(
      `SELECT pe.id, pe.name, pe.email, pe.notes,
              pt.name as "partnerName",
              (1 - (pe.embedding <=> $1::vector)) as similarity 
       FROM "Person" pe
       JOIN "Partner" pt ON pe."currentPartnerId" = pt.id
       WHERE pe.embedding IS NOT NULL 
       ORDER BY pe.embedding <=> $1::vector 
       LIMIT 5`,
      vectorStr
    );
    dbPeople = rawPeople.filter(p => p.similarity > 0.15).map(p => ({
      ...p,
      currentPartner: { name: p.partnerName }
    }));

    // 4. Vector search using pg_vector on ContextUrl
    vectorResults = await searchVectorDatabase(query, 10);
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Search Results</h1>
        <p className={styles.subtext}>
          Query: &ldquo;<strong>{query}</strong>&rdquo;
        </p>
      </header>

      <main className={styles.main}>
        {/* Simple Input form to search again from this page */}
        <section className={styles.searchFormSection}>
          <form action="/search" method="GET" className={styles.searchForm}>
            <input 
              type="text" 
              name="q" 
              defaultValue={query} 
              placeholder="Search partners, projects, people, or ask a question..." 
              className={styles.searchInput}
            />
            <button type="submit" className={styles.searchButton}>Search</button>
          </form>
        </section>

        {query.trim() === '' ? (
          <p className={styles.emptyState}>Please enter a search query above.</p>
        ) : (
          <div className={styles.resultsGrid}>
            {/* Left: Vector Semantic Match results */}
            <div className={styles.vectorResultsSection}>
              <h2>Vector Search (Semantic Matches)</h2>
              <p className={styles.sectionIntro}>AI-powered pgvector matches from briefings, templates, and profile context documents.</p>
              
              {vectorResults.length === 0 ? (
                <div className={styles.emptyCard}>
                  <p>No semantic matches found in pgvector index.</p>
                  <p className={styles.tip}>Tip: Go to the <Link href="/admin" className={styles.inlineLink}>Dev Console</Link> and click <strong>&ldquo;Seed Mock Data&rdquo;</strong> to populate pg_vector embeddings!</p>
                </div>
              ) : (
                <div className={styles.vectorList}>
                  {vectorResults.map((res) => (
                    <div key={res.id} className={styles.vectorCard}>
                      <div className={styles.vectorHeader}>
                        <span className={styles.vectorBadge}>Semantic Match ({(res.similarity * 100).toFixed(1)}%)</span>
                        <span className={styles.vectorType}>{res.type}</span>
                      </div>
                      <h3>{res.title || 'Untitled Document'}</h3>
                      <p className={styles.vectorExcerpt}>{res.ingestedText}</p>
                      <Link href={res.url} className={styles.vectorLink}>
                        Open Context Link &rarr;
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Literal database record matches */}
            <div className={styles.literalResultsSection}>
              <h2>Database Matches</h2>
              
              {/* Partners */}
              <div className={styles.literalGroup}>
                <h3>Partners ({dbPartners.length})</h3>
                {dbPartners.length === 0 ? (
                  <p className={styles.noResults}>No partner records matched.</p>
                ) : (
                  <ul className={styles.literalList}>
                    {dbPartners.map(p => (
                      <li key={p.id}>
                        <Link href={`/partners/${p.id}`} className={styles.recordLink}>
                          {p.name} <span className={styles.mutedText}>({p.type})</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Projects */}
              <div className={styles.literalGroup}>
                <h3>Projects ({dbProjects.length})</h3>
                {dbProjects.length === 0 ? (
                  <p className={styles.noResults}>No active project records matched.</p>
                ) : (
                  <ul className={styles.literalList}>
                    {dbProjects.map(p => (
                      <li key={p.id}>
                        <Link href={`/projects/${p.id}`} className={styles.recordLink}>
                          {p.name} <span className={styles.mutedText}>collaborating with {p.partner.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* People */}
              <div className={styles.literalGroup}>
                <h3>People ({dbPeople.length})</h3>
                {dbPeople.length === 0 ? (
                  <p className={styles.noResults}>No people records matched.</p>
                ) : (
                  <ul className={styles.literalList}>
                    {dbPeople.map(p => (
                      <li key={p.id}>
                        <Link href={`/people/${p.id}`} className={styles.recordLink}>
                          {p.name} <span className={styles.mutedText}>({p.email} at {p.currentPartner.name})</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
