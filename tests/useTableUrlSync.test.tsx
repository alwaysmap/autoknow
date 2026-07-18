/** @jest-environment jsdom */
// The URL sync must touch only its own keys — an unrelated param like ?lang= (the
// locale deep-link) must survive the first filter interaction, and a cleared filter
// must remove its param.
import { renderHook } from '@testing-library/react';
import { useTableUrlSync } from '../src/lib/useTableUrlSync';
import type { TableSort } from '../src/lib/tableUrlState';

function setUrl(search: string) {
  window.history.replaceState(null, '', `/partners${search}`);
}

describe('useTableUrlSync', () => {
  it('preserves unmanaged params (?lang=) when writing filters', () => {
    setUrl('?lang=de');
    const { rerender } = renderHook(
      ({ f, s }: { f: Record<string, string[]>; s: TableSort | null }) => useTableUrlSync(f, s),
      { initialProps: { f: {} as Record<string, string[]>, s: null as TableSort | null } },
    );
    // second render (first is skipped by design) applies a filter
    rerender({ f: { type: ['OEM'] }, s: { key: 'name', dir: 'asc' } });

    const params = new URLSearchParams(window.location.search);
    expect(params.get('lang')).toBe('de');
    expect(params.getAll('type')).toEqual(['OEM']);
    expect(params.get('sort')).toBe('name');
  });

  it('removes a filter param when the filter is cleared', () => {
    setUrl('?lang=de');
    const { rerender } = renderHook(
      ({ f }: { f: Record<string, string[]> }) => useTableUrlSync(f, null),
      { initialProps: { f: {} as Record<string, string[]> } },
    );
    rerender({ f: { type: ['OEM'] } });
    expect(new URLSearchParams(window.location.search).getAll('type')).toEqual(['OEM']);
    rerender({ f: { type: [] } });
    const params = new URLSearchParams(window.location.search);
    expect(params.getAll('type')).toEqual([]);
    expect(params.get('lang')).toBe('de'); // still preserved
  });
});
