/** @jest-environment node */
// The escalation ZOD BOUNDARY (#245) — the three invariants no column can state, plus the
// drift guard `src/lib/schemas.ts` promises in its comment.
//
// Why each one is here rather than trusted to review: an escalation attached to neither a
// partner nor a program is a record about nothing that every surface still renders; a
// `duplicate` with no target is a close whose reason has been lost; and an open enum would
// let a typo'd severity land as a row the UI silently draws as untriaged.

import {
  escalationApiSchema,
  escalationFieldsSchema,
  escalationStatusSchema,
  escalationStatusUpdateSchema,
  escalationUpdateSchema,
} from '../src/lib/schemas';
import { ESCALATION_STATUSES, SEVERITIES, ORG_LEVELS } from '../src/lib/escalation';

const fields = {
  title: 'Certification slip was communicated late',
  summary: '',
  partnerId: '3',
  projectId: '',
  severity: 's1',
  orgLevel: 'director',
  ownerPersonId: '',
  decisionMakerPersonId: '',
  requestedOfPersonId: '',
  targetDate: '',
};

describe('the enums are closed at the boundary', () => {
  it('accepts exactly the statuses lib/escalation declares', () => {
    // The drift guard: schemas.ts spells the tuple out (zod needs a literal), so this is
    // what keeps that spelling and the domain module's list the same set.
    expect([...escalationStatusSchema.options].sort()).toEqual([...ESCALATION_STATUSES].sort());
  });

  it('rejects a value outside each scale', () => {
    expect(escalationStatusSchema.safeParse('closed').success).toBe(false);
    expect(escalationFieldsSchema.safeParse({ ...fields, severity: 's4' }).success).toBe(false);
    expect(escalationFieldsSchema.safeParse({ ...fields, orgLevel: 'ceo' }).success).toBe(false);
  });

  it('accepts every declared severity and org level', () => {
    for (const s of SEVERITIES) {
      expect(escalationFieldsSchema.safeParse({ ...fields, severity: s }).success).toBe(true);
    }
    for (const o of ORG_LEVELS) {
      expect(escalationFieldsSchema.safeParse({ ...fields, orgLevel: o }).success).toBe(true);
    }
  });
});

describe('an escalation is about a partner and/or a program', () => {
  it('accepts a partner alone, a program alone, or both', () => {
    expect(escalationFieldsSchema.safeParse({ ...fields, partnerId: '3', projectId: '' }).success).toBe(true);
    expect(escalationFieldsSchema.safeParse({ ...fields, partnerId: '', projectId: '7' }).success).toBe(true);
    expect(escalationFieldsSchema.safeParse({ ...fields, partnerId: '3', projectId: '7' }).success).toBe(true);
  });

  it('refuses neither, with a message a user can act on', () => {
    const result = escalationFieldsSchema.safeParse({ ...fields, partnerId: '', projectId: '' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toMatch(/at least one/i);
  });

  it('keeps that check when the schema is extended for update', () => {
    // `.safeExtend` on a refined object: the whole reason the update schema is spelled
    // that way. An edit must not be able to clear both associations that creation required.
    expect(
      escalationUpdateSchema.safeParse({ ...fields, escalationId: '4', partnerId: '', projectId: '' }).success,
    ).toBe(false);
    expect(
      escalationUpdateSchema.safeParse({ ...fields, escalationId: '4' }).success,
    ).toBe(true);
  });

  it('refuses an update with no escalation to target', () => {
    expect(escalationUpdateSchema.safeParse(fields).success).toBe(false);
  });
});

describe('triage is optional, and blank means untriaged rather than invalid', () => {
  it('normalizes an empty severity/org level to null', () => {
    const parsed = escalationFieldsSchema.parse({ ...fields, severity: '', orgLevel: '' });
    expect(parsed.severity).toBeNull();
    expect(parsed.orgLevel).toBeNull();
  });

  it('normalizes an empty person pick to null rather than dropping the field', () => {
    const parsed = escalationFieldsSchema.parse(fields);
    expect(parsed.ownerPersonId).toBeNull();
    expect(parsed.decisionMakerPersonId).toBeNull();
    expect(parsed.requestedOfPersonId).toBeNull();
  });
});

describe('target date', () => {
  it('accepts a date and normalizes a blank one to null', () => {
    expect(escalationFieldsSchema.parse({ ...fields, targetDate: '2026-09-01' }).targetDate)
      .toBeInstanceOf(Date);
    // Blank is a real answer — "no target set" — not a rejected value.
    expect(escalationFieldsSchema.parse({ ...fields, targetDate: '' }).targetDate).toBeNull();
    expect(escalationFieldsSchema.parse(fields).targetDate).toBeNull();
  });

  it('refuses something that is not a date at all', () => {
    expect(escalationFieldsSchema.safeParse({ ...fields, targetDate: 'next tuesday' }).success)
      .toBe(false);
  });
});

describe('closing as duplicate', () => {
  const base = { escalationId: '4', status: 'duplicate', duplicateOfId: '9' };

  it('accepts a duplicate that names what it duplicates', () => {
    expect(escalationStatusUpdateSchema.safeParse(base).success).toBe(true);
  });

  it('refuses a duplicate with no target', () => {
    const result = escalationStatusUpdateSchema.safeParse({ ...base, duplicateOfId: '' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toMatch(/duplicates/i);
  });

  it('refuses an escalation that is its own duplicate', () => {
    // The self-FK makes this expressible; the detail page would render it as an endless
    // "duplicate of →" chain.
    const result = escalationStatusUpdateSchema.safeParse({ ...base, duplicateOfId: '4' });
    expect(result.success).toBe(false);
  });

  it('lets every OTHER status close without a duplicate target', () => {
    for (const status of ESCALATION_STATUSES.filter((s) => s !== 'duplicate')) {
      expect(
        escalationStatusUpdateSchema.safeParse({ escalationId: '4', status, duplicateOfId: '' }).success,
      ).toBe(true);
    }
  });
});

describe('the JSON API schema', () => {
  const body = { title: 'Codec decision needed', partnerId: 3 };

  it('accepts the minimum an escalation can be', () => {
    expect(escalationApiSchema.safeParse(body).success).toBe(true);
  });

  it('carries the same two policies the form does', () => {
    expect(escalationApiSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(
      escalationApiSchema.safeParse({ ...body, status: 'duplicate' }).success,
    ).toBe(false);
  });

  it('accepts provenance the form schemas deliberately do not', () => {
    // originalRequest / raisedBy / sourceKind / contextUrlId are the chat path's to write,
    // and are absent from the editor schemas precisely so an edit cannot rewrite them.
    const parsed = escalationApiSchema.parse({
      ...body,
      originalRequest: 'escalate the cert slip',
      raisedBy: 'lena@continental.example',
      sourceKind: 'chat',
      contextUrlId: 12,
    });
    expect(parsed.originalRequest).toBe('escalate the cert slip');
    expect(parsed.sourceKind).toBe('chat');
    expect('originalRequest' in escalationFieldsSchema.parse(fields)).toBe(false);
    expect('raisedBy' in escalationFieldsSchema.parse(fields)).toBe(false);
  });

  it('refuses a source kind outside the two that exist today', () => {
    // 'bug' is RESERVED, not implemented — it must not be writable before the code that
    // knows what a bug-sourced escalation renders as.
    expect(escalationApiSchema.safeParse({ ...body, sourceKind: 'bug' }).success).toBe(false);
  });
});
