import {
  parseBody,
  parseForm,
  partnerApiSchema,
  partnerFieldsSchema,
  relationshipUpdateSchema,
  statusUpdateSchema,
} from '../src/lib/schemas';

// The zod gate (lib/schemas): the invariants the UI promises are enforced at the
// boundary — required region, required trimmed notes, bounded scores/progress,
// URL shape — and empty-string form fields normalize to null, not ''.

const fd = (obj: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
};

describe('schemas', () => {
  test('partner form: region required, empty optionals become null', () => {
    const parsed = parseForm(
      partnerFieldsSchema,
      fd({ name: '  Volvo ', typeId: '', regionId: '3', website: '', internalDetailsUrl: '', summary: '' }),
    );
    expect(parsed).toEqual({
      name: 'Volvo',
      typeId: null,
      regionId: 3,
      website: null,
      internalDetailsUrl: null,
      summary: null,
    });

    expect(() => parseForm(partnerFieldsSchema, fd({ name: 'Volvo', regionId: '' }))).toThrow(/regionId/);
    expect(() => parseForm(partnerFieldsSchema, fd({ name: 'Volvo', regionId: '2', website: 'nope' }))).toThrow(/website/);
  });

  test('relationship update: score bounded 1..5, note required', () => {
    expect(parseForm(relationshipUpdateSchema, fd({ partnerId: '7', score: '4', notes: ' solid quarter ' }))).toEqual({
      partnerId: 7,
      score: 4,
      notes: 'solid quarter',
    });
    expect(() => parseForm(relationshipUpdateSchema, fd({ partnerId: '7', score: '9', notes: 'x' }))).toThrow(/score/);
    expect(() => parseForm(relationshipUpdateSchema, fd({ partnerId: '7', score: '3', notes: '   ' }))).toThrow(/notes/);
  });

  test('status update: note required, progress bounded, blank progress allowed', () => {
    const parsed = parseForm(
      statusUpdateSchema,
      fd({ scope: 'project', targetId: '12', theNeedle: 'On Track', notes: 'shipping', hillChartProgress: '' }),
    );
    expect(parsed.hillChartProgress).toBeNull();
    expect(() =>
      parseForm(statusUpdateSchema, fd({ scope: 'project', targetId: '12', theNeedle: 'On Track', notes: '', hillChartProgress: '50' })),
    ).toThrow(/notes/);
    expect(() =>
      parseForm(statusUpdateSchema, fd({ scope: 'project', targetId: '12', theNeedle: 'On Track', notes: 'x', hillChartProgress: '250' })),
    ).toThrow(/hillChartProgress/);
  });

  test('API bodies: readable refusals, not exceptions', () => {
    const bad = parseBody(partnerApiSchema, { name: 'Scania', type: 'OEM' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/region/);

    const good = parseBody(partnerApiSchema, { name: 'Scania', type: 'OEM', region: 'EMEA' });
    expect(good.ok).toBe(true);
  });
});
