import { BUILTIN_TEMPLATES } from '../src/lib/builtinTemplates';
import { validateTemplateDag } from '../src/lib/templateDag';

// The built-in program templates (PHASE_TEMPLATES_PLAN §5): the full 15-phase AAOS
// bring-up (P0–P14, end phase = Launch readiness & SOP) plus the migrated GAS and
// Digital Key stubs. Every built-in must be a valid converging DAG.

const byName = (name: string) => BUILTIN_TEMPLATES.find((t) => t.name === name);

describe('BUILTIN_TEMPLATES', () => {
  it('ships AAOS Bring-up, GAS, and Digital Key', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.name)).toEqual(
      expect.arrayContaining(['AAOS Bring-up (chipset → GBI)', 'GAS', 'Digital Key']),
    );
  });

  it('every built-in validates as a converging DAG', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const result = validateTemplateDag(
        t.phases.map((p) => ({ id: p.key, isEndPhase: !!p.isEndPhase })),
        t.phases.flatMap((p) => p.dependsOn.map((d) => ({ nodeId: p.key, dependsOnId: d }))),
      );
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  describe('AAOS Bring-up (chipset → GBI)', () => {
    const aaos = byName('AAOS Bring-up (chipset → GBI)')!;

    it('has the 15 DAG phases P0–P14', () => {
      expect(aaos.phases).toHaveLength(15);
      expect(aaos.phases.map((p) => p.key)).toEqual(
        Array.from({ length: 15 }, (_, i) => `P${i}`),
      );
    });

    it('ends (only) at P14 Launch readiness & SOP', () => {
      const ends = aaos.phases.filter((p) => p.isEndPhase);
      expect(ends).toHaveLength(1);
      expect(ends[0].key).toBe('P14');
      expect(ends[0].name).toMatch(/Launch readiness & SOP/);
    });

    it('captures post-SOP sustaining as a program note, not a phase', () => {
      expect(aaos.description).toMatch(/Sustaining/);
      expect(aaos.phases.some((p) => /sustain/i.test(p.name))).toBe(false);
    });

    it('every phase carries description, googleFocus, leadRole, and positive weeks', () => {
      for (const p of aaos.phases) {
        expect(p.description.length).toBeGreaterThan(20);
        expect(p.googleFocus.length).toBeGreaterThan(20);
        expect(p.leadRole).toBeTruthy();
        expect(p.durationWeeks).toBeGreaterThan(0);
      }
    });

    it('every description is a Goal plus a provable Done-when checklist', () => {
      // The DoD contract: one goal line, then binary pass/fail criteria as list
      // items — never activity prose or "mostly working" language.
      for (const t of BUILTIN_TEMPLATES) {
        for (const p of t.phases) {
          expect(p.description).toMatch(/\*\*Goal:\*\*/);
          expect(p.description).toMatch(/\*\*Done when:\*\*/);
          const checklist = p.description.split('**Done when:**')[1];
          expect(checklist.trim().split('\n').filter((l) => l.startsWith('- ')).length).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('encodes the plan durations and leads (spot checks)', () => {
      const p2 = aaos.phases.find((p) => p.key === 'P2')!;
      expect(p2.name).toBe('BSP & power-on');
      expect(p2.leadRole).toBe('Silicon vendor');
      expect(p2.durationWeeks).toBe(18);

      const p6 = aaos.phases.find((p) => p.key === 'P6')!;
      expect(p6.durationWeeks).toBe(24);
      expect(p6.dependsOn).toEqual(['P2']);
    });

    it('P12 compliance gates joins the eight upstream tracks', () => {
      const p12 = aaos.phases.find((p) => p.key === 'P12')!;
      expect(p12.dependsOn.sort()).toEqual(
        ['P10', 'P11', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].sort(),
      );
    });
  });

  it('migrates the GAS and Digital Key stubs with converging end phases', () => {
    const gas = byName('GAS')!;
    expect(gas.phases).toHaveLength(3);
    expect(gas.phases.filter((p) => p.isEndPhase).map((p) => p.name)).toEqual(['GAS Compliance']);

    const dk = byName('Digital Key')!;
    expect(dk.phases).toHaveLength(3);
    expect(dk.phases.filter((p) => p.isEndPhase).map((p) => p.name)).toEqual(['CCC Spec Compliance']);
  });
});
