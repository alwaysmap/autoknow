// Initiative derivations + boundary (gh-286 part c). The status cases matter because
// memberStatus composes THREE authorities (deriveProgramStatus, sopBufferCategory,
// isSopFlagged) — a hand-rolled re-derivation on a surface is the drift these tests
// exist to make unnecessary.
import { copyCompletion, memberStatus, initiativeRollup } from '../src/lib/initiative';
import { initiativeAddPartnersSchema, initiativeFieldsSchema } from '../src/lib/schemas';

const NOW = Date.UTC(2026, 7, 8); // 2026-08-08
const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * day).toISOString();

const copy = (over: Partial<Parameters<typeof memberStatus>[0]> = {}) => ({
  isArchived: false,
  lifecycle: 'active',
  hillChartProgress: 40,
  sopDate: null as string | null,
  chainRemainingDays: 30,
  ...over,
});

describe('copyCompletion', () => {
  it('is the unweighted mean of phase positions, rounded', () => {
    expect(copyCompletion([100, 60, 0])).toBe(53);
    expect(copyCompletion([100, 100, 100])).toBe(100);
    expect(copyCompletion([])).toBe(0);
  });
});

describe('memberStatus', () => {
  it('complete beats everything, from either the lifecycle fact or full progress', () => {
    expect(memberStatus(copy({ lifecycle: 'complete' }), NOW)).toBe('complete');
    expect(memberStatus(copy({ hillChartProgress: 100 }), NOW)).toBe('complete');
  });
  it('cancelled and archived copies are inactive — never a progress reading', () => {
    expect(memberStatus(copy({ lifecycle: 'cancelled' }), NOW)).toBe('inactive');
    expect(memberStatus(copy({ isArchived: true }), NOW)).toBe('inactive');
  });
  it('a date-less active copy is no-date — never a defaulted on-track', () => {
    expect(memberStatus(copy(), NOW)).toBe('no-date');
  });
  it('a dated copy reads the SAME flagged set as the SOP tile', () => {
    // Comfortable buffer: 30 remaining vs a target ~1 year out.
    expect(memberStatus(copy({ sopDate: iso(365) }), NOW)).toBe('on-track');
    // Target already behind us: flagged (blown), so at-risk.
    expect(memberStatus(copy({ sopDate: iso(-10) }), NOW)).toBe('at-risk');
  });
});

describe('initiativeRollup', () => {
  it('counts the four member states and totals exactly the list it was given', () => {
    expect(initiativeRollup(['complete', 'on-track', 'on-track', 'at-risk', 'no-date'])).toEqual({
      complete: 1, onTrack: 2, atRisk: 1, noDate: 1, total: 5,
    });
  });
  it('refuses inactive rows rather than silently miscounting', () => {
    expect(() => initiativeRollup(['inactive'])).toThrow(/filtered out/);
  });
});

describe('initiative schemas (mutation boundary)', () => {
  it('parses comma-separated partner ids into ints', () => {
    const parsed = initiativeAddPartnersSchema.parse({ initiativeId: '3', partnerIds: ' 4, 17 ,42 ' });
    expect(parsed.partnerIds).toEqual([4, 17, 42]);
    expect(parsed.targetMonth).toBeNull();
  });
  it('rejects a batch containing anything that is not a positive int', () => {
    for (const bad of ['4,abc', '0', '-3', '4,,', 'BMW']) {
      expect(initiativeAddPartnersSchema.safeParse({ initiativeId: 1, partnerIds: bad }).success).toBe(false);
    }
  });
  it('create requires a name and a template; blank optionals normalize to null', () => {
    const parsed = initiativeFieldsSchema.parse({ name: 'EV APIs', description: '', targetMonth: '', templateId: '2' });
    expect(parsed).toEqual({ name: 'EV APIs', description: null, targetMonth: null, templateId: 2 });
    expect(initiativeFieldsSchema.safeParse({ name: '', templateId: 2 }).success).toBe(false);
    expect(initiativeFieldsSchema.safeParse({ name: 'X' }).success).toBe(false);
  });
});
