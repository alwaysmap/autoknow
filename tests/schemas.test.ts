import { z } from 'zod';
import * as schemas from '../src/lib/schemas';
import {
  parseBody,
  parseForm,
  partnerApiSchema,
  partnerDeleteSchema,
  partnerFieldsSchema,
  partnerUpdateSchema,
  phaseHillSchema,
  phasePartnerAssignSchema,
  phasePersonAssignSchema,
  projectMetricsSchema,
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

  // A RATCHET, not a roll-call: the schemas are found by reflecting over the module, so a
  // new boundary that carries a hill position is tested the day it is written, without
  // anyone remembering to add it here. That is the whole failure autoknow-9l4 fixed —
  // `updatePhaseHill` wrote this column with no bound at all, and nothing said so, because
  // the bound lived in each writer separately and the hand-rolled writer had simply
  // omitted it. AGENTS lesson 2: the rule ships as software, not as a note.
  const hillFields = Object.entries(schemas).flatMap(([name, value]) =>
    value instanceof z.ZodObject && 'hillChartProgress' in value.shape
      ? ([[name, value.shape.hillChartProgress as z.ZodType]] as const)
      : [],
  );

  test('every schema carrying a hill position bounds it to 0..100', () => {
    // A reflection that matches nothing passes vacuously, which would make this test a
    // decoration — so assert it found the boundaries before asserting anything about them.
    expect(hillFields.length).toBeGreaterThanOrEqual(4);

    for (const [name, field] of hillFields) {
      // `name` rides in the assertion so a failure says WHICH schema lost its bound.
      expect({ name, ok: field.safeParse('101').success }).toEqual({ name, ok: false });
      expect({ name, ok: field.safeParse('-1').success }).toEqual({ name, ok: false });
      expect({ name, ok: field.safeParse('0').success }).toEqual({ name, ok: true });
      expect({ name, ok: field.safeParse('100').success }).toEqual({ name, ok: true });
    }
  });

  // The partner actions are the person actions' mirror, and the pairing is the point: an
  // id-only delete schema looks redundant until you notice its absence is what let the
  // partner side hand-parse `partnerId` twice (autoknow-9l4).
  test('partner update/delete: the id is validated like any other', () => {
    expect(parseForm(partnerUpdateSchema, fd({ partnerId: '8', name: 'Volvo', regionId: '3' }))).toEqual({
      partnerId: 8, name: 'Volvo', typeId: null, regionId: 3, website: null, internalDetailsUrl: null, summary: null,
    });
    expect(parseForm(partnerDeleteSchema, fd({ partnerId: '8' }))).toEqual({ partnerId: 8 });

    for (const schema of [partnerUpdateSchema, partnerDeleteSchema]) {
      for (const bad of ['', '0', '-3', 'nope', '7abc']) {
        expect(() => parseForm(schema, fd({ partnerId: bad, name: 'Volvo', regionId: '3' }))).toThrow(/partnerId/);
      }
    }
  });

  test('phase hill: a blank position is allowed, a note is not optional', () => {
    const good = { phaseId: '4', projectId: '2', hillChartProgress: '60', notes: ' moved ' };
    expect(parseForm(phaseHillSchema, fd(good))).toEqual({ phaseId: 4, projectId: 2, hillChartProgress: 60, notes: 'moved' });
    // Blank is "no movement", which the action turns into the previous position.
    expect(parseForm(phaseHillSchema, fd({ ...good, hillChartProgress: '' })).hillChartProgress).toBeNull();
    expect(() => parseForm(phaseHillSchema, fd({ ...good, notes: '   ' }))).toThrow(/notes/);
    // `projectId` only ever fed revalidatePath, which is exactly why it went unchecked.
    expect(() => parseForm(phaseHillSchema, fd({ ...good, projectId: 'nope' }))).toThrow(/projectId/);
  });

  test('program metrics: checkboxes, a blank volume, and an owner that must be someone', () => {
    const good = {
      projectId: '5', theNeedle: 'On Track', ownerName: 'ada@google.com', sopDate: '2027-03',
      volumeFirstYear: '', notes: '', hillChartProgress: '40', partnerId: '', hasGas: 'on',
    };
    // An unticked checkbox posts NOTHING, so the three absent flags must read false —
    // never undefined, which Prisma would take as "leave the column alone".
    expect(parseForm(projectMetricsSchema, fd(good))).toEqual({
      projectId: 5, theNeedle: 'On Track', ownerName: 'ada@google.com', sopDate: '2027-03',
      volumeFirstYear: null, notes: null, hillChartProgress: 40, partnerId: null,
      hasGas: true, hasGbi: false, hasDigitalKey: false, hasAap: false,
    });
    expect(() => parseForm(projectMetricsSchema, fd({ ...good, ownerName: '  ' }))).toThrow(/ownerName/);
    expect(() => parseForm(projectMetricsSchema, fd({ ...good, volumeFirstYear: '-5' }))).toThrow(/volumeFirstYear/);
    expect(() => parseForm(projectMetricsSchema, fd({ ...good, partnerId: 'nope' }))).toThrow(/partnerId/);
  });

  test('API bodies: readable refusals, not exceptions', () => {
    const bad = parseBody(partnerApiSchema, { name: 'Scania', type: 'OEM' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/region/);

    const good = parseBody(partnerApiSchema, { name: 'Scania', type: 'OEM', region: 'EMEA' });
    expect(good.ok).toBe(true);
  });
});
