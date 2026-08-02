'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { anchoredPosition, rovingIndex } from '../lib/anchoredPosition';
import dash from './ProjectStatusDashboard.module.css';
import styles from './Combobox.module.css';

// A type-to-filter ENTITY PICKER (gh-269) — a drop-in replacement for a bare `<select>`
// over a full table, which is what every entity picker in this app was: the escalation
// edit dialog alone opens five (three person roles, partner, program), and the lists are
// unbounded by construction.
//
// SUBSTRING, not prefix, case-insensitive — typing "vol" must match both "Volvo Cars"
// AND "Involved", the reported case. Prefix-matching is the reflex default and would
// silently drop the second one.
//
// WHY NOT `AnchoredPopover`: that component's dismiss/placement model is built on the
// native Popover API's BUTTON invoker (`popovertarget`), which the HTML spec does not
// support on a text `<input>` — a combobox's whole interaction model is input-driven
// (type to filter, arrow to navigate), not button-driven, so the two do not fit
// together. This reuses the one genuinely shared piece — `anchoredPosition`, the pure,
// unit-tested placement math — without forcing the mismatched invoker mechanism on it.
// (`UnifiedSearch` also hand-rolls a roving-index listbox for its own suggestions list —
// a different use case, navigational search rather than a form field with a committed
// value, so not folded in here; worth a follow-up look if a third variant ever appears.)
//
// THE GUARANTEE THIS EXISTS TO KEEP (AGENTS lesson 3 / design.md §2 — entity inputs are
// PICKERS, never free text): the component NEVER posts unmatched text. `selectedId` is
// the only thing written to the hidden form field, and it changes ONLY when a real
// option is chosen — never as a side effect of typing. Losing focus (blur, Escape, or
// submitting with the list still open) reverts the visible text to whatever is
// currently selected, so the input can never show a string that does not match the
// value the form will actually submit.
//
// SCOPE (recorded here so the next reader does not have to reconstruct it from the
// diff): this ships the primitive and wires it into `EscalationEditor`'s five pickers —
// the case the report was filed against. `PartnerEditor`, `ProjectMetaHeader`'s owner
// picker, `PhaseInvolvementEditor` and `PersonEditor` still use bare `<select>`s; folding
// them in is the same "add a prop, never fork it" move once someone is next in those
// files. The `DataTable` column-funnel half of the original report (open the funnel,
// type to narrow the checklist) is DELIBERATELY NOT attempted here — it is a genuinely
// different UI shape (a multi-select checklist with OR-together semantics, not a single
// committed value) and touches the highest-blast-radius shared component in the app;
// see the follow-up issue for the open design question that has to be answered first
// (whether the funnel needs its own `multiple`-aware variant of this component, or a
// text filter bolted onto the existing checklist).

export interface ComboboxOption {
  /** The value posted under `name` when this option is chosen — a stable id, never a
   *  display string (the option a row filters TO must be the same option however it was
   *  found: typed, arrowed to, or already selected on page load). */
  value: string;
  label: string;
}

export interface ComboboxProps {
  id: string;
  /** The form field name — this is a drop-in replacement for `<select name=… >`, so a
   *  server action reading `formData.get(name)` sees no difference. */
  name: string;
  options: ComboboxOption[];
  /** The option's `value` to start selected, or '' for none — same contract as a native
   *  `<select defaultValue>`. */
  defaultValue?: string;
  /** Shown when nothing is selected: as the input's placeholder AND as the first,
   *  always-offered choice (the native `<select>`'s `<option value="">…</option>` row) —
   *  typing part of this word finds it exactly like any other option. */
  emptyLabel: string;
  'aria-label'?: string;
  className?: string;
}

/** Case-insensitive substring, matching `DataTable`'s own key-column filter — the same
 *  rule this component exists to bring to entity pickers. */
function matches(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase());
}

export default function Combobox({
  id,
  name,
  options,
  defaultValue = '',
  emptyLabel,
  'aria-label': ariaLabel,
  className,
}: ComboboxProps) {
  const labelOf = (value: string): string => options.find((o) => o.value === value)?.label ?? '';

  const [selectedId, setSelectedId] = useState(defaultValue);
  const [query, setQuery] = useState(defaultValue ? labelOf(defaultValue) : '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Whether the visible text has been EDITED since the last commit. Opening a populated
  // field (focus, arrow keys) must show the FULL list — including "Unassigned" — the
  // same thing a native `<select>` does when you open it on an existing value; filtering
  // by the committed label itself would hide every other option (and the empty one) the
  // moment something is already selected. Filtering only starts once the reader has
  // actually typed something new.
  const [editing, setEditing] = useState(false);
  // Bumped whenever a choice should return focus to the input. The refocus itself
  // happens in an EFFECT below, never inline in the handler that makes the choice — an
  // inline JSX handler calling `inputRef.current.focus()` directly is flagged by this
  // repo's ref-safety lint as a possible read-during-render, and the fix the codebase
  // already uses elsewhere (AnchoredPopover's own focus restoration) is to do the actual
  // ref read inside a `useEffect`, which is an unambiguously post-render moment.
  const [focusToken, setFocusToken] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // The empty choice is a real row in the list, always first, filtered by the same rule
  // as everything else once editing — so typing "una" surfaces "Unassigned" exactly like
  // any option.
  const allOptions: ComboboxOption[] = [{ value: '', label: emptyLabel }, ...options];
  const filtered: ComboboxOption[] = editing
    ? allOptions.filter((o) => matches(o.label, query))
    : allOptions;

  /** THE GUARANTEE: whatever is visible reverts to whatever is actually selected. Called
   *  on blur, Escape and outside-click — every path that leaves the field without an
   *  explicit choice. Declared before the effects that reference it. */
  const revertAndClose = (): void => {
    setQuery(labelOf(selectedId));
    setEditing(false);
    setOpen(false);
  };

  const choose = (option: ComboboxOption): void => {
    setSelectedId(option.value);
    // `labelOf`, not `option.label` directly: the synthetic empty option's label is the
    // human-readable "Unassigned", but the field's RESTING text for "nothing selected"
    // is blank-with-placeholder, the same as the initial unselected state — `labelOf('')`
    // already resolves to '' because the empty row is not one of the caller's `options`,
    // so routing through it keeps both paths honest about what "" displays as.
    setQuery(labelOf(option.value));
    setEditing(false);
    setOpen(false);
    setFocusToken((t) => t + 1);
  };

  // Position the list while open, and keep it anchored as the trigger scrolls/resizes —
  // the same responsibilities `AnchoredPopover` carries for its own panel, done here with
  // the same pure `anchoredPosition` math since this is not that component (see header).
  // `query` is a dependency too, not just `open`: filtering changes how many rows render,
  // which changes `panel.offsetHeight` — without recomputing here, a filtered-down list
  // would keep the taller unfiltered list's placement.
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = inputRef.current;
      const panel = listRef.current;
      if (!trigger || !panel) return;
      const t = trigger.getBoundingClientRect();
      const { left, top } = anchoredPosition({
        trigger: { top: t.top, right: t.right, bottom: t.bottom, left: t.left },
        panel: { width: Math.max(panel.offsetWidth, t.right - t.left), height: panel.offsetHeight },
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        align: 'start',
        margin: 8,
      });
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.minWidth = `${t.right - t.left}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, query]);

  // Outside-click dismiss: this is NOT a native top-layer popover (see the file header),
  // so it manages its own light-dismiss rather than getting it from the browser.
  // `revertAndClose` is intentionally left out of the dependency array. It closes over
  // `selectedId`, which WOULD go stale if this effect re-ran on every keystroke instead
  // of only on `open` transitions — but `selectedId` has exactly one setter (`choose`),
  // and `choose` always flips `open` to `false` in the same update. So every write this
  // listener could ever miss also tears the listener down in the same tick; there is no
  // window where a stale `selectedId` is still reachable through it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target) || listRef.current?.contains(target)) return;
      revertAndClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The refocus side effect for `choose` — see `focusToken`'s own comment for why this
  // is not inline in the click/keydown handler that calls `choose`.
  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus();
  }, [focusToken]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); setActiveIndex(0); return; }
      setActiveIndex((i) => rovingIndex(i, 1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActiveIndex(filtered.length - 1); return; }
      setActiveIndex((i) => rovingIndex(i, -1, filtered.length));
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIndex]) {
        e.preventDefault();
        choose(filtered[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        revertAndClose();
      }
    }
  };

  return (
    <div className={styles.wrap}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={emptyLabel}
        value={query}
        className={`${dash.textInput} ${className ?? ''}`}
        onFocus={(e) => {
          setOpen(true);
          setActiveIndex(0);
          // Select the existing text so the reader can just start typing to replace it —
          // the text-field equivalent of a native `<select>` needing no delete keystroke
          // before you pick something else.
          e.target.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setEditing(true);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
        // A pick via mouse never reaches here: each option's `onMouseDown` calls
        // `preventDefault`, which is what stops the browser from shifting focus (and
        // therefore firing blur) in the first place — `choose` runs with focus still on
        // the input. What DOES reach here is Tab-away or a click landing outside both
        // the input and the list, which the outside-pointerdown handler above already
        // treats the same way; this is the keyboard/Tab path for the identical rule.
        onBlur={revertAndClose}
      />
      {/* The value the form actually submits — the ONLY writer of `name`, so the visible
          text above can never disagree with what gets posted. */}
      <input type="hidden" name={name} value={selectedId} />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        className={styles.list}
        style={{ display: open ? 'block' : 'none' }}
      >
        {filtered.length === 0 ? (
          <li className={styles.empty} role="presentation">{emptyLabel}</li>
        ) : (
          filtered.map((o, i) => (
            <li
              key={o.value || '(empty)'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === selectedId}
              className={`${styles.option} ${i === activeIndex ? styles.active : ''}`}
              // mousedown, not click: fires before the input's blur, so `choose` runs
              // before `revertAndClose` would otherwise have a chance to.
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {o.label}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
