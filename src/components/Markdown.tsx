import React from 'react';
import ReactMarkdown from 'react-markdown';
import { visit } from 'unist-util-visit';
import type { Root, Text } from 'hast';
import { annotateUntracked, type UntrackedContext } from '../lib/untrackedPeople';
import { UntrackedMention } from './TrackPersonProse';

// Renders a markdown string (weekly-update notes, ingested digests) with constrained,
// compact styling so it fits inside feed items and cards. Links open safely.
//
// It is also the ONE place the "track person" affordance reaches five surfaces at once
// (#126's sweep: HillHistoryList, NeedleHistoryList, PhaseGraph, PhaseTrack, FeedList).
// Converging here is what makes that one change rather than five, and what stops a sixth
// prose surface from shipping without it.

/**
 * Wrap each untracked mention in a marker element the renderer can pick up.
 *
 * A REHYPE PLUGIN rather than a pass over the markdown SOURCE, because the source is
 * markdown: splitting `[Dieter](mailto:dieter@bosch.example)` on its address would
 * corrupt the link syntax around it. By the time this runs the tree is HTML, the link is
 * an `<a>` with its own text node, and a text node is exactly the unit the detector was
 * written to split.
 *
 * Text inside `<a>`, `<code>` and `<pre>` is left alone: an address in a link already has an
 * action, and one inside code is a literal being quoted, not a person being named.
 */
function rehypeUntracked(ctx: UntrackedContext) {
  const SKIP = new Set(['a', 'code', 'pre']);
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === undefined || !parent) return;
      if (parent.type === 'element' && SKIP.has(parent.tagName)) return;

      const segments = annotateUntracked(node.value, ctx);
      if (!segments.some((s) => s.untracked)) return;

      // Replace the one text node with the run it split into: plain text stays text, a
      // claimed run becomes a marker element carrying the canonical address.
      const replacement = segments.map((s) =>
        s.untracked
          ? {
              type: 'element' as const,
              tagName: 'untracked-mention',
              properties: { address: s.untracked },
              children: [{ type: 'text' as const, value: s.text }],
            }
          : { type: 'text' as const, value: s.text },
      );
      parent.children.splice(index, 1, ...replacement);
      // Skip the nodes just inserted; revisiting them would re-scan text already claimed.
      return index + replacement.length;
    });
  };
}

/**
 * The marker element `rehypeUntracked` emits, as a renderer.
 *
 * The CAST is confined to this one entry and is unavoidable: react-markdown's
 * `Components` is keyed by known HTML tag names, so a custom tag cannot be expressed in
 * it. Spreading a narrowly-cast object rather than casting the whole `components`
 * literal keeps excess-property checking on the nine style overrides beside it — cast
 * the literal and a typo in any of them lands silently.
 */
const untrackedMarker = {
  'untracked-mention': ({ address, children }: { address?: string; children?: React.ReactNode }) =>
    address ? <UntrackedMention address={address}>{children}</UntrackedMention> : <>{children}</>,
} as React.ComponentProps<typeof ReactMarkdown>['components'];

/**
 * `ctx` is what turns the affordance ON for a surface. Omitted — which is every caller
 * that has not opted in — the pipeline is untouched and this renders exactly what it
 * rendered before, so a surface cannot get the affordance by accident and cannot lose
 * its prose by forgetting it.
 */
export default function Markdown({ children, untracked }: {
  children: string;
  untracked?: UntrackedContext;
}) {
  return (
    <ReactMarkdown
      rehypePlugins={untracked ? [[rehypeUntracked, untracked]] : []}
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
        ...untrackedMarker,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
