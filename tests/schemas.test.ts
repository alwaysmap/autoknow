import {
  parseBody,
  parseForm,
  partnerApiSchema,
  partnerFieldsSchema,
  phasePartnerAssignSchema,
  phasePersonAssignSchema,
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

  // The two involvement forms are twins and must stay twins: lib/phaseInvolvement no
  // longer re-checks the shape, so a non-id that got past HERE would reach prisma. One
  // shared body is what makes that mechanical — a field added to one schema and not the
  // other fails right here.
  test.each([
    ['personId', phasePersonAssignSchema],
    ['partnerId', phasePartnerAssignSchema],
  ] as const)('phase involvement (%s): ids must be positive integers, blank role becomes null', (idField, schema) => {
    const good = { [idField]: '4', projectId: '2', phaseId: '9', role: '  ' };
    expect(parseForm(schema, fd(good))).toEqual({ [idField]: 4, projectId: 2, phaseId: 9, role: null });

    // Named per field, so a refusal that blames the WRONG field still fails — which is
    // the whole value of the message to someone staring at the form.
    for (const field of [idField, 'projectId', 'phaseId']) {
      expect(() => parseForm(schema, fd({ ...good, [field]: 'nope' }))).toThrow(new RegExp(field));
      expect(() => parseForm(schema, fd({ ...good, [field]: '0' }))).toThrow(new RegExp(field));
    }

    // …and readable. `guarded` forwards on `startsWith('Invalid input') || includes(' — ')`;
    // parseForm's prefix satisfies both, so pinning it once pins the whole contract — a
    // rewording that missed BOTH branches would reach the user as "Something went wrong".
    expect(() => parseForm(schema, fd({ ...good, phaseId: 'nope' }))).toThrow(/^Invalid input — /);
  });

  test('API bodies: readable refusals, not exceptions', () => {
    const bad = parseBody(partnerApiSchema, { name: 'Scania', type: 'OEM' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/region/);

    const good = parseBody(partnerApiSchema, { name: 'Scania', type: 'OEM', region: 'EMEA' });
    expect(good.ok).toBe(true);
  });
});
