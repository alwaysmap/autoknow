import 'server-only';
import { prisma } from './db';

// Programs associated with a partner, from BOTH association kinds:
//  - OWNED:    Project.partnerId points at the partner (the program is theirs).
//  - INVOLVED: the partner appears on one or more phases via PhasePartner rows.
// A partner can be both (owns a program AND is involved in others').

export interface PartnerProgramPhase {
  id: number;
  name: string;
  progress: number; // 0..100 latest
  role: string | null; // this partner's role on the phase (involved programs only)
}

export interface PartnerProgram {
  id: number;
  name: string;
  isArchived: boolean;
  relationship: 'owner' | 'involved';
  ownerPartner: { id: number; name: string };
  progress: number; // 0..100 latest program progress
  health: string | null;
  previousProgress: number | null;
  previousHealth: string | null;
  updatedAt: string | null;
  phases: PartnerProgramPhase[]; // owned: all phases; involved: only the phases they're on
}

export async function getPartnerPrograms(partnerId: number): Promise<PartnerProgram[]> {
  const projectInclude = {
    partner: { select: { id: true, name: true } },
    states: { orderBy: { timestamp: 'desc' as const }, take: 2 },
    phases: {
      orderBy: { id: 'asc' as const },
      include: {
        states: { orderBy: { timestamp: 'desc' as const }, take: 1 },
        partners: { where: { partnerId }, select: { role: true } },
      },
    },
  };

  const [owned, involvements] = await Promise.all([
    prisma.project.findMany({ where: { partnerId }, include: projectInclude, orderBy: { name: 'asc' } }),
    prisma.phasePartner.findMany({
      where: { partnerId, phase: { project: { partnerId: { not: partnerId } } } },
      select: { phase: { select: { projectId: true } } },
    }),
  ]);

  const involvedProjectIds = [...new Set(involvements.map((i) => i.phase.projectId))];
  const involved = await prisma.project.findMany({
    where: { id: { in: involvedProjectIds } },
    include: projectInclude,
    orderBy: { name: 'asc' },
  });

  type Row = (typeof owned)[number];
  const toProgram = (p: Row, relationship: 'owner' | 'involved'): PartnerProgram => {
    // Owned programs list every phase. For involved programs, show ALL of the
    // program's in-flight phases (0 < progress < 100) — not just the one this
    // partner sits on — plus any phase they're on regardless of progress, so their
    // stake is always visible.
    const phases = p.phases
      .filter((ph) => {
        if (relationship === 'owner') return true;
        const progress = ph.states[0]?.hillChartProgress ?? 0;
        const inFlight = progress > 0 && progress < 100;
        return inFlight || ph.partners.length > 0;
      })
      .map((ph) => ({
        id: ph.id,
        name: ph.name,
        progress: ph.states[0]?.hillChartProgress ?? 0,
        role: ph.partners[0]?.role ?? null,
      }));
    return {
      id: p.id,
      name: p.name,
      isArchived: p.isArchived,
      relationship,
      ownerPartner: p.partner,
      progress: p.hillChartProgress,
      health: p.theNeedle,
      previousProgress: p.states[1]?.hillChartProgress ?? null,
      previousHealth: p.states[1]?.theNeedle ?? null,
      updatedAt: p.states[0]?.timestamp?.toISOString() ?? null,
      phases,
    };
  };

  return [
    ...owned.map((p) => toProgram(p, 'owner')),
    ...involved.map((p) => toProgram(p, 'involved')),
  ];
}
