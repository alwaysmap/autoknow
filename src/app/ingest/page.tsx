import { geminiConfigured } from '../../lib/gemini';
import IngestClient from './IngestClient';

export const dynamic = 'force-dynamic';

export default function IngestPage() {
  return (
    <div style={{ padding: '32px 40px' }}>
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Ingest context</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4 }}>
          Paste a Google Doc link (e.g. partner meeting notes). Gemini distills it into a
          searchable digest and attaches it to the right program or partner.
        </p>
      </header>
      <IngestClient geminiReady={geminiConfigured} />
    </div>
  );
}
