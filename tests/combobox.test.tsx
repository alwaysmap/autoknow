/** @jest-environment jsdom */
// The type-to-filter entity picker (gh-269). The property this file exists to prove is
// the one the report was filed to fix without breaking: substring matching that finds
// BOTH "Volvo Cars" and "Involved" on "vol" — and the one AGENTS lesson 3 demands of
// every entity input: the component must NEVER post a string the reader merely typed.
// The hidden `<input name>` is the only thing a server action reads, so every assertion
// here checks THAT field, not the visible text, for the guarantee that actually matters.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import Combobox from '../src/components/Combobox';

const OPTIONS = [
  { value: '1', label: 'Volvo Cars' },
  { value: '2', label: 'Involved Systems Inc' },
  { value: '3', label: 'Bosch' },
];

function renderCombobox(defaultValue = '') {
  render(
    <Combobox
      id="cb" name="partnerId" options={OPTIONS} defaultValue={defaultValue}
      emptyLabel="Unassigned" aria-label="Partner"
    />,
  );
  return {
    input: screen.getByRole('combobox') as HTMLInputElement,
    hidden: document.querySelector('input[name="partnerId"][type="hidden"]') as HTMLInputElement,
  };
}

describe('substring matching', () => {
  it('matches BOTH "Volvo Cars" and "Involved…" on "vol" — the reported case', () => {
    const { input } = renderCombobox();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'vol' } });
    expect(screen.getByRole('option', { name: 'Volvo Cars' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Involved Systems Inc' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bosch' })).not.toBeInTheDocument();
  });

  it('is case-insensitive', () => {
    const { input } = renderCombobox();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'VOL' } });
    expect(screen.getByRole('option', { name: 'Volvo Cars' })).toBeInTheDocument();
  });

  it('offers the empty/unassigned choice through the SAME filter, not unconditionally', () => {
    const { input } = renderCombobox();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'una' } });
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Volvo Cars' })).not.toBeInTheDocument();
  });
});

describe('the one guarantee: never posts unmatched text', () => {
  it('reverts the visible text on blur, and never wrote the typed text to the hidden field', () => {
    const { input, hidden } = renderCombobox();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'this matches nothing at all' } });
    expect(hidden.value).toBe(''); // never touched by typing
    fireEvent.blur(input);
    expect(input.value).toBe(''); // reverted — nothing was ever selected
    expect(hidden.value).toBe('');
  });

  it('reverts to the PREVIOUSLY selected option, not to blank, when a later edit is abandoned', () => {
    const { input, hidden } = renderCombobox('1'); // starts on Volvo Cars
    expect(input.value).toBe('Volvo Cars');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'garbled' } });
    fireEvent.blur(input);
    expect(input.value).toBe('Volvo Cars');
    expect(hidden.value).toBe('1'); // the field was never touched by the abandoned edit
  });

  it('Escape reverts the same way blur does', () => {
    const { input, hidden } = renderCombobox('1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'garbled' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Volvo Cars');
    expect(hidden.value).toBe('1');
  });
});

describe('choosing an option', () => {
  it('a click commits the value to the hidden field and the label to the input', () => {
    const { input, hidden } = renderCombobox();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'invol' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Involved Systems Inc' }));
    expect(hidden.value).toBe('2');
    expect(input.value).toBe('Involved Systems Inc');
  });

  it('choosing the empty option CLEARS the field, rather than leaving the old value', () => {
    const { input, hidden } = renderCombobox('1');
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Unassigned' }));
    expect(hidden.value).toBe('');
    expect(input.value).toBe('');
  });

  it('ArrowDown then Enter selects the first filtered option — the keyboard path', () => {
    const { input, hidden } = renderCombobox();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bosch' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(hidden.value).toBe('3');
    expect(input.value).toBe('Bosch');
  });
});

describe('a11y wiring', () => {
  it('carries the combobox role and the listbox association', () => {
    const { input } = renderCombobox();
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    const listboxId = input.getAttribute('aria-controls');
    expect(listboxId).toBeTruthy();
    expect(document.getElementById(listboxId!)).toHaveAttribute('role', 'listbox');
  });

  it('is collapsed (aria-expanded=false) until focused', () => {
    const { input } = renderCombobox();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });
});

// The props the picker grew when it went from one call site to every entity picker in the
// app (`ProjectMetaHeader`, `PersonEditor`, `PhaseInvolvementEditor`). Each is here
// because a bare `<select>` gave it for free and dropping it would have been a silent
// regression on a form that already worked.

describe('required', () => {
  it('validates through the VISIBLE input, so the browser can focus what it complains about', () => {
    render(
      <Combobox id="cb" name="partnerId" options={OPTIONS} emptyLabel="Unassigned"
        required aria-label="Partner" />,
    );
    const input = screen.getByRole('combobox') as HTMLInputElement;
    // A `type="hidden"` control is barred from constraint validation and a `display:none`
    // one cannot be focused to report it — hence the visible input carrying the attribute.
    expect(input).toBeRequired();
    expect(input.checkValidity()).toBe(false);

    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Bosch' }));
    expect(input.checkValidity()).toBe(true);
  });

  it('Enter on a query matching NOTHING reverts instead of submitting a field that lies', () => {
    const onSubmit = jest.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Combobox id="cb" name="partnerId" options={OPTIONS} emptyLabel="Unassigned"
          required aria-label="Partner" />
      </form>,
    );
    const input = screen.getByRole('combobox') as HTMLInputElement;
    const hidden = document.querySelector('input[name="partnerId"][type="hidden"]') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The visible text is back to what the field actually holds — nothing — so `required`
    // is now read against the truth rather than against 'zzz'.
    expect(input.value).toBe('');
    expect(hidden.value).toBe('');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('onChange', () => {
  it('fires on an explicit choice — the dependent-picker case', () => {
    const onChange = jest.fn();
    render(
      <Combobox id="cb" name="partnerId" options={OPTIONS} emptyLabel="Unassigned"
        onChange={onChange} aria-label="Partner" />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Volvo Cars' }));
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('does NOT fire while typing — a caller never sees an uncommitted value', () => {
    const onChange = jest.fn();
    render(
      <Combobox id="cb" name="partnerId" options={OPTIONS} emptyLabel="Unassigned"
        onChange={onChange} aria-label="Partner" />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Volvo' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
