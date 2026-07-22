import ReactMarkdown from 'react-markdown';

// Renders a markdown string (weekly-update notes, ingested digests) with constrained,
// compact styling so it fits inside feed items and cards. Links open safely.

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        p: (props) => <p style={{ margin: '0 0 0.375rem' }} {...props} />,
        ul: (props) => <ul style={{ margin: '0 0 0.375rem', paddingLeft: '1.125rem' }} {...props} />,
        ol: (props) => <ol style={{ margin: '0 0 0.375rem', paddingLeft: '1.125rem' }} {...props} />,
        li: (props) => <li style={{ marginBottom: '0.125rem' }} {...props} />,
        h1: (props) => <strong {...props} />,
        h2: (props) => <strong {...props} />,
        h3: (props) => <strong {...props} />,
        code: (props) => (
          <code style={{ background: 'var(--surface, #f0eee6)', padding: '0.0625rem 0.25rem', borderRadius: '0.1875rem', fontSize: '0.92em' }} {...props} />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
