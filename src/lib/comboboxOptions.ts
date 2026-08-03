// The option shape `Combobox` renders, and the mapper most call sites need — here rather
// than in the component because `Combobox` is a `'use client'` module, and Next marks EVERY
// export of one as a client reference. A server component calling `toComboboxOptions()` from
// there fails at request time with "attempted to call … from the server", which typecheck
// cannot see. Two server pages import it — `/programs/new` and `/me` — so the helper has to
// live somewhere both server and client may call.

export interface ComboboxOption {
  /** The value posted under the field's `name` when this option is chosen — a stable id,
   *  never a display string (the option a row filters TO must be the same option however it
   *  was found: typed, arrowed to, or already selected on page load). */
  value: string;
  label: string;
}

/** Rows named `{ id, name }` — the shape most of this app's pickers already fetch — as
 *  options. The id goes to `value` and the name to `label`, never the other way round
 *  (AGENTS lesson 3: a picker's committed value is the id, not the display string). A
 *  picker whose value is not the id, or whose label is composed from more than `name`,
 *  maps inline at its own call site rather than growing options onto this. */
export function toComboboxOptions(rows: { id: number; name: string }[]): ComboboxOption[] {
  return rows.map((r) => ({ value: String(r.id), label: r.name }));
}
