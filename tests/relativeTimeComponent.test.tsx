/** @jest-environment jsdom */
// #171 — the React half: the hydration-safe swap (`useSyncExternalStore` reading the
// shared ticker) and the `<time>` markup itself. The bucket/format arithmetic is
// covered without a DOM in tests/relativeTime.test.ts.
import React from 'react';
import { render } from '@testing-library/react';
import RelativeTime from '../src/components/RelativeTime';
import { LocaleProvider } from '../src/components/LocaleProvider';

describe('RelativeTime', () => {
  it('renders the ISO instant in `dateTime` and the full UTC stamp in `title`', () => {
    const { container } = render(
      <LocaleProvider locale="en">
        <RelativeTime value="2026-06-01T14:32:00.000Z" />
      </LocaleProvider>,
    );
    const time = container.querySelector('time')!;
    expect(time.getAttribute('dateTime')).toBe('2026-06-01T14:32:00.000Z');
    expect(time.getAttribute('title')).toBe('2026-06-01 14:32 UTC');
  });

  it('swaps to relative text after mount, not the raw absolute SSR snapshot', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { container } = render(
      <LocaleProvider locale="en">
        <RelativeTime value={fiveMinAgo} />
      </LocaleProvider>,
    );
    // useSyncExternalStore re-checks its snapshot immediately after subscribing (React
    // flushes this within the same `render()` under RTL's act() wrapper), so this
    // reads the post-mount value without needing to wait out a real 30s tick.
    expect(container.querySelector('time')!.textContent).toMatch(/minutes? ago/);
  });

  it('never lets a stray class prop go unapplied', () => {
    const { container } = render(
      <LocaleProvider locale="en">
        <RelativeTime value={new Date().toISOString()} className="stamp" />
      </LocaleProvider>,
    );
    expect(container.querySelector('time')!.className).toBe('stamp');
  });
});
