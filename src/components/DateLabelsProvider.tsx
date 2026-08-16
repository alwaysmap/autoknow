'use client';

import React, { createContext, useContext } from 'react';
import type { DateLabelMode } from '../lib/dates';

// Client-side distribution of the two date-label preferences, as LocaleProvider
// distributes the locale: the root layout resolves the cookies server-side and mounts
// this, so any client component can ask for the mode instead of having it threaded
// through prop chains that are already ten deep with `locale`.
//
// TWO modes, one provider, two hooks — because the question a surface should ask is part
// of what the surface IS. `useDateLabels()` is prose, readouts and chart captions;
// `useTableDateLabels()` is a table CELL, read down a column against its neighbours rather
// than across in a sentence (design.md §6). A component that reaches for the wrong one is
// making a claim about which kind of surface it is, which is exactly the thing worth
// having to be explicit about.
//
// Both context defaults are the app default ('date'), which is what makes this safe to
// adopt piecemeal: a component rendered outside the provider — a unit test mounting one
// chart — gets today's behaviour rather than an undefined mode to branch on.

const DateLabelsContext = createContext<DateLabelMode>('date');
const TableDateLabelsContext = createContext<DateLabelMode>('date');

/** Takes the resolver's object WHOLE (`getDateLabelModes()`), so `prose` and `table` keep
 *  the names every comment in this feature uses instead of being renamed in a layout line
 *  whose only job would be the rename. */
export function DateLabelsProvider({ modes, children }: {
  modes: { prose: DateLabelMode; table: DateLabelMode };
  children: React.ReactNode;
}) {
  return (
    <DateLabelsContext.Provider value={modes.prose}>
      <TableDateLabelsContext.Provider value={modes.table}>{children}</TableDateLabelsContext.Provider>
    </DateLabelsContext.Provider>
  );
}

/** How a DAY is written in prose, a readout, or a chart caption. */
export function useDateLabels(): DateLabelMode {
  return useContext(DateLabelsContext);
}

/** How a DAY is written in a table CELL. `DateCell` is the only caller — a table's dates
 *  go through it (design.md §6), so a second caller here means a hand-rolled cell. */
export function useTableDateLabels(): DateLabelMode {
  return useContext(TableDateLabelsContext);
}
