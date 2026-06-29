'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { ingestAction, type IngestState } from './actions';

const card: React.CSSProperties = {
  background: 'var(--surface, #f3f1e9)',
  border: '1px solid var(--border, #e3e0d6)',
  borderRadius: 10,
  padding: 16,
};

export default function IngestClient({ geminiReady }: { geminiReady: boolean }) {
  const [state, formAction, pending] = useActionState(ingestAction, {} as IngestState);
  const r = state.result;
  const d = r?.digest;

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!geminiReady && (
        <p style={{ color: '#b06000', fontSize: 13 }}>
          GEMINI_API_KEY is not set — documents will be stored with a naive summary and a
          non-semantic embedding until you configure it.
        </p>
      )}

      <form action={formAction} style={{ display: 'flex', gap: 8 }}>
        <input
          name="url"
          type="url"
          required
          placeholder="https://docs.google.com/document/d/…"
          style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #ddd)' }}
        />
        <button
          type="submit"
          disabled={pending}
          style={{ padding: '10px 18px', fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border, #ddd)' }}
        >
          {pending ? 'Ingesting…' : 'Ingest'}
        </button>
      </form>

      {r && !r.ok && (
        <p style={{ color: '#b00020', fontSize: 14 }}>⚠ {r.error}</p>
      )}

      {r && r.ok && d && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--muted, #666)' }}>
            Ingested <strong>{r.title}</strong> →{' '}
            {r.attachedTo && r.attachedTo.kind !== 'none' && r.attachedTo.id ? (
              <>
                attached to {r.attachedTo.kind}{' '}
                <Link
                  href={`/${r.attachedTo.kind === 'project' ? 'projects' : 'partners'}/${r.attachedTo.id}`}
                  style={{ fontWeight: 600 }}
                >
                  {r.attachedTo.name}
                </Link>
              </>
            ) : (
              <em>not auto-classified (stored unattached)</em>
            )}
          </div>

          <div style={card}>
            <h3 style={{ marginBottom: 8 }}>Summary</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>{d.summary}</p>
          </div>

          {d.keyTopics.length > 0 && (
            <div style={card}>
              <h3 style={{ marginBottom: 8 }}>Key topics</h3>
              <ul style={{ paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
                {d.keyTopics.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {d.decisions.length > 0 && (
            <div style={card}>
              <h3 style={{ marginBottom: 8 }}>Decisions</h3>
              <ul style={{ paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
                {d.decisions.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {d.openQuestions.length > 0 && (
            <div style={card}>
              <h3 style={{ marginBottom: 8 }}>Open questions</h3>
              <ul style={{ paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
                {d.openQuestions.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
