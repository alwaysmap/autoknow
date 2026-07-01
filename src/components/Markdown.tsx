import ReactMarkdown from 'react-markdown';

// Renders a markdown string (weekly-update notes, ingested digests) with constrained,
// compact styling so it fits inside feed items and cards. Links open safely.

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        p: (props) => <p style={{ margin: '0 0 6px' }} {...props} />,
        ul: (props) => <ul style={{ margin: '0 0 6px', paddingLeft: 18 }} {...props} />,
        ol: (props) => <ol style={{ margin: '0 0 6px', paddingLeft: 18 }} {...props} />,
        li: (props) => <li style={{ marginBottom: 2 }} {...props} />,
        h1: (props) => <strong {...props} />,
        h2: (props) => <strong {...props} />,
        h3: (props) => <strong {...props} />,
        code: (props) => (
          <code style={{ background: 'var(--surface, #f0eee6)', padding: '1px 4px', borderRadius: 3, fontSize: '0.92em' }} {...props} />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
