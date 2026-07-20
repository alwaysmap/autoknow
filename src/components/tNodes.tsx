import React from 'react';
import { tRaw, type Locale, type StringKey } from '../lib/i18n';

// i18n templates with React nodes in the {var} slots — so entity mentions inside
// localized sentences render as LINKS (everything-is-a-URL, design.md §2) without
// splitting the sentences out of the string catalog. Slot order stays owned by
// each locale's template.

export function tNodes(
  locale: Locale,
  key: StringKey,
  vars: Record<string, React.ReactNode>,
): React.ReactNode {
  // split(/\{(\w+)\}/g) alternates literal text (even indices) and slot names (odd).
  const parts = tRaw(locale, key).split(/\{(\w+)\}/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1
          ? <React.Fragment key={i}>{vars[p] ?? `{${p}}`}</React.Fragment>
          : p,
      )}
    </>
  );
}

/** Interleave nodes with a separator — the node-safe `array.join(', ')`. */
export function joinNodes(nodes: React.ReactNode[], separator: React.ReactNode = ', '): React.ReactNode {
  return (
    <>
      {nodes.map((n, i) => (
        <React.Fragment key={i}>
          {i > 0 && separator}
          {n}
        </React.Fragment>
      ))}
    </>
  );
}
