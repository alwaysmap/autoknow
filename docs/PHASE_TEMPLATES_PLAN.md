# Program Phase Templates — Design Plan

Status: **Implemented** — DB-resident templates with seeded built-ins
(`lib/programTemplates`, `lib/builtinTemplates`), the `/templates` editor
(TemplateEditor + PhaseDagEditor), and template-driven program creation. This
doc remains the design rationale; approved decisions captured below.

## Goal

Let a user (a) **pick** a program template when creating a project, or (b) **create** a
new template by defining phase-templates. A phase-template has: 1:M hill-chart updates
(at runtime), a markdown **description** (typical activities), a markdown **Google Focus**
(what Googlers focus on), a **lead partner**, and a **potential duration in weeks**.
Phases form a **DAG** that converges on a **single end phase** — the final deliverable.

---

## 1. What already exists (autoknow)

Next.js 16 + Prisma/Postgres. Runtime primitives already present:

- `Phase` + `PhaseDependency` (self-referential DAG). ✅
- `PhaseState` — 1:M hill-chart updates per phase (progress 0–100; status derived). ✅
- `PhasePartner` — M:N phase↔partner with a `role` string. ⚠️ no single "lead".
- `Phase.forecastedDuration` — integer, **days** (default 30). ⚠️ requirement is weeks.
- `src/lib/templates.ts` — **hardcoded** TS constant `TEMPLATES` (AAOS/GAS/Digital Key),
  consumed by `src/app/projects/new/page.tsx` and referenced 8× in `src/lib/seed.ts`.

Gaps: no persisted/user-editable templates, no `description` / `googleFocus` fields, no
single lead partner, no convergence validation, and the AAOS template is a 5-phase stub
(the real program is 16 phases).

---

## 2. Approved decisions

1. **End phase = P14 "Launch Readiness & SOP (GBI)"** — the single sink. All branches
   converge there. **P15 Post-launch sustaining is NOT a DAG node**; it is a post-SOP
   lifecycle note on the template (keeps the "exactly one sink" rule clean).
2. **Duration:** templates store **weeks**; on instantiation convert `durationWeeks × 7`
   → `Phase.forecastedDuration` (days) so `forecast.ts` / `criticalChain.ts` are untouched.
3. **Lead partner:** templates store a **role** (`leadRole`, reusable across OEMs); on
   instantiation map to a concrete `Phase.leadPartnerId` where unambiguous, else leave for
   the user. `PhasePartner` still holds the broader "who's involved" set.
4. **Scope:** this document is the plan; implementation is a later pass.

---

## 3. Data model (Prisma additions)

```prisma
model ProgramTemplate {
  id          Int             @id @default(autoincrement())
  name        String
  description String?         // markdown, program-level
  isBuiltIn   Boolean         @default(false)  // seeded; clone-only, not user-deletable
  createdBy   String?
  createdAt   DateTime        @default(now())
  phases      PhaseTemplate[]
}

model PhaseTemplate {
  id            Int                @id @default(autoincrement())
  templateId    Int
  template      ProgramTemplate    @relation(fields: [templateId], references: [id], onDelete: Cascade)
  name          String
  description   String?            // markdown — exit outcome + typical activities
  googleFocus   String?            // markdown — what Googlers/TSC focus on
  leadRole      String?            // "OEM" | "Silicon vendor" | "Tier 1" | "Google" | "3PL" | "Hypervisor vendor"
  durationWeeks Int                @default(4)
  isEndPhase    Boolean            @default(false)  // the single join/deliverable node
  sortOrder     Int                @default(0)      // stable display order
  dependsOn     PhaseTemplateDep[] @relation("PT_from")
  dependents    PhaseTemplateDep[] @relation("PT_to")
}

model PhaseTemplateDep {           // DAG among phase-templates (edge = "depends on upstream")
  id              Int           @id @default(autoincrement())
  phaseTemplateId Int
  phaseTemplate   PhaseTemplate @relation("PT_from", fields: [phaseTemplateId], references: [id], onDelete: Cascade)
  dependsOnId     Int
  dependsOn       PhaseTemplate @relation("PT_to", fields: [dependsOnId], references: [id], onDelete: Cascade)
  @@unique([phaseTemplateId, dependsOnId])
}
```

Extend the **live** `Phase` so instantiated phases carry the rich content:

```prisma
// added to model Phase
description   String?   // markdown, copied from template, then editable per-project
googleFocus   String?   // markdown
leadPartnerId Int?      // concrete partner mapped from template leadRole
isEndPhase    Boolean   @default(false)
```

---

## 4. DAG + convergence validation — `src/lib/templateDag.ts` (new)

One pure function, reused by the editor, the save action, and project instantiation.
Input: nodes + edges (`dependsOn`). Returns `{ ok, errors[] }` with the offending node id
so the UI can highlight it. Rules:

- **Acyclic** — topological sort succeeds.
- **Exactly one sink** — exactly one node that nothing depends on; it must be the
  `isEndPhase` node (and vice versa).
- **Full convergence** — every node has a directed path to the sink (no orphan branch).
  This is the "all upstream phases join for a final deliverable" guarantee.

Add jest unit tests (jest is already configured). Retrofit the same check into
`projects/new` creation before the `$transaction` commits.

---

## 5. First template — AAOS Bring-up (chipset → GBI)

Seeded as a built-in `ProgramTemplate` (`isBuiltIn = true`), derived from the Part 4
bring-up doc. 15 DAG phases (P0–P14); **P15 sustaining** captured as a program-level note
only. Durations = month-range midpoint × ~4.3, rounded. `leadRole` = primary accountable
lead (co-leads noted in the description).

### 5.1 Program-level fields

- **name:** `AAOS Bring-up (chipset → GBI)`
- **description (markdown):**
  > A ~30–40 month new-platform AAOS program from architecture lock to Start of Production,
  > run as a relay across silicon vendor → Tier 1 → OEM → Google, with a 3PL and hypervisor
  > vendor entering at specific gates. Critical path: **P0 → P1 → P2 → P6 → P12 → P13 → P14**.
  > Long poles: BSP stabilization (P2), VHAL/signal-catalog convergence (P6), and the
  > compliance-triage loop (P12).
  >
  > **Post-SOP (not in the DAG):** *Sustaining* — security patches + Android-version upgrades
  > delivered OTA across the 10–15yr vehicle lifecycle; the canonical TSC home. Model as a
  > standing track once the program reaches SOP.

### 5.2 Phase-template rows

Durations in weeks; `dependsOn` by phase key; `sortOrder` = ordinal. **End phase = P14.**

| Key | name | leadRole | weeks | dependsOn |
|-----|------|----------|-------|-----------|
| P0 | Architecture lock | OEM | 8 | — |
| P1 | Silicon & dev environment | OEM | 6 | P0 |
| P2 | BSP & power-on | Silicon vendor | 18 | P1 |
| P3 | Display & graphics | Tier 1 | 6 | P2 |
| P4 | Audio | Tier 1 | 8 | P2 |
| P5 | Connectivity | Tier 1 | 12 | P2 |
| P6 | Vehicle sensors & VHAL | OEM | 24 | P2 |
| P7 | Camera & ADAS surfaces (EVS) | Tier 1 | 10 | P2 |
| P8 | Hypervisor & mixed-criticality | Hypervisor vendor | 18 | P2 |
| P9 | App platform & Google services | OEM | 12 | P5 |
| P10 | Rich media | Tier 1 | 6 | P3, P4, P9 |
| P11 | OTA & A/B updates | OEM | 12 | P2 |
| P12 | Compliance gates | OEM | 18 | P3, P4, P5, P6, P7, P8, P10, P11 |
| P13 | GAS / GBI certification | 3PL | 6 | P12 |
| **P14** | **Launch readiness & SOP (GBI)** ⟵ end | OEM | 6 | P13 |

Convergence check (by hand): single sink = P14; acyclic; every node reaches P14 via
`… → P12 → P13 → P14` (P9 reaches via P10). ✅

### 5.3 Per-phase `description` (markdown) + `googleFocus`

`description` = exit outcome + typical activities. `googleFocus` = the TSC column.

- **P0 Architecture lock**
  - description:
    ```
    **Exit outcome:** Platform architecture frozen — SoC, hypervisor topology, partition
    map, OTA strategy, and AAOS/GAS scope agreed; responsibility matrix signed.
    **Co-leads:** OEM (with Tier 1 + silicon vendor).
    **Typical activities:** early architecture review; VINTF posture; hypervisor topology;
    OTA design; Android-version/BSP schedule risk assessment.
    ```
  - googleFocus: `Run the early architecture review; push VINTF-compliant posture, sane hypervisor topology and OTA design; flag the Android-version/BSP schedule risk before it's baked in.`

- **P1 Silicon & dev environment**
  - description:
    ```
    **Exit outcome:** SoC selected; physical dev kits and/or virtual SoC available to every
    party; toolchains and source access stood up.
    **Co-leads:** OEM selects, silicon vendor supplies.
    **Typical activities:** SoC down-select; dev-kit / vSoC provisioning; toolchain + source access.
    ```
  - googleFocus: `Advise on AAOS support maturity of candidate SoCs; point teams to Cuttlefish/Trout and the Snapdragon vSoC cloud path so integration starts before hardware lands.`

- **P2 BSP & power-on**
  - description:
    ```
    **Exit outcome:** Board powers on; bootloader and kernel boot to console; RAM, storage
    (UFS/eMMC) and core peripherals enumerate.
    **Co-leads:** Silicon vendor (reference BSP) → Tier 1 (board port).
    **Typical activities:** reference BSP delivery; board port; bootloader/kernel bring-up;
    peripheral enumeration. #1 schedule slip.
    ```
  - googleFocus: `Mostly observing; track BSP delivery against the target Android version because this is the #1 schedule slip. Own the escalation path into Core Engineering for genuinely upstream defects.`

- **P3 Display & graphics**
  - description:
    ```
    **Exit outcome:** Screens light up; SurfaceFlinger composites; AAOS home screen renders
    at target resolution/refresh; multi-display works.
    **Co-leads:** Tier 1 (Display HAL) + silicon vendor (GPU driver).
    **Typical activities:** Display HAL bring-up; GPU driver integration; HWC/compositor validation.
    ```
  - googleFocus: `Triage compositor/HWC defects that only appear when AAOS runs atop the vendor BSP; route true AOSP bugs to Google eng.`

- **P4 Audio**
  - description:
    ```
    **Exit outcome:** Audio routes to all zones; mics capture; AAOS audio focus and zones
    behave; chimes/alerts meet latency.
    **Co-leads:** Tier 1 (Audio HAL, amp).
    **Typical activities:** Audio HAL + amp integration; zone routing; audio-focus policy; alert latency.
    ```
  - googleFocus: `Validate the Android audio policy and zone config against real automotive routing (driver alerts over media, etc.).`

- **P5 Connectivity**
  - description:
    ```
    **Exit outcome:** Wi-Fi, Bluetooth, cellular modem and GNSS all connect and pass; Android
    Auto phone projection pairs and casts.
    **Co-leads:** Tier 1 + modem vendor.
    **Typical activities:** Wi-Fi/BT/modem/GNSS bring-up; Android Auto projection conformance.
    ```
  - googleFocus: `Confirm Android Auto projection conformance; triage BT/Wi-Fi stack issues against AOSP behaviour.`

- **P6 Vehicle sensors & VHAL**
  - description:
    ```
    **Exit outcome:** Speed, gear, HVAC, doors, seats, lighting, energy and ADAS state flow
    into Android as VehiclePropValues; system (Google-defined) and vendor (OEM-defined)
    properties verified against the signal catalog.
    **Co-leads:** OEM + Tier 1 (CAN/Ethernet → VHAL).
    **Typical activities:** CAN/Ethernet → VHAL mapping; signal-catalog alignment; system vs
    vendor property verification. Heaviest TSC engagement.
    ```
  - googleFocus: `Drive VHAL and signal-catalog alignment; adopt the standard AAOS SDV catalog and reuse vendor-property definitions to kill custom-property churn. COVESA VHAL workshop is the venue.`

- **P7 Camera & ADAS surfaces (EVS)**
  - description:
    ```
    **Exit outcome:** Rearview/surround-view camera renders within the regulatory
    boot-to-image latency budget; the EVS (Exterior View System) path is validated.
    **Co-leads:** Tier 1 + silicon vendor.
    **Typical activities:** Camera HAL + EVS bring-up; backup-camera boot-to-image timing.
    ```
  - googleFocus: `Triage EVS/Camera-HAL issues; check backup-camera timing against the FMVSS-111 boot-to-image requirement.`

- **P8 Hypervisor & mixed-criticality**
  - description:
    ```
    **Exit outcome:** AAOS (IVI VM) and the cluster/safety VM coexist on one SoC;
    freedom-from-interference proven — an IVI crash cannot disturb the cluster.
    **Co-leads:** Hypervisor vendor + Tier 1.
    **Typical activities:** guest-VM bring-up; boot orchestration; resource partitioning; FFI proof.
    ```
  - googleFocus: `Ensure AAOS behaves correctly as a guest; work boot-orchestration and resource-partition issues with the hypervisor vendor.`

- **P9 App platform & Google services**
  - description:
    ```
    **Exit outcome:** (GAS path) Play Store, Google Maps and Assistant/Gemini run on device;
    Distraction-Optimized apps are correctly gated by driving state.
    **Co-leads:** OEM + Google.
    **Typical activities:** GAS enablement; Parked/Idling/Driving gating; app review + driver-distraction approvals.
    ```
  - googleFocus: `Shepherd GAS enablement; validate driving-state gating; coordinate app review and driver-distraction approvals; route Maps integration to the Geo/Maps team.`

- **P10 Rich media**
  - description:
    ```
    **Exit outcome:** HD video while parked, Dolby Atmos, and immersive 3D nav render to
    spec; video correctly blocked in motion.
    **Co-leads:** Tier 1 + OEM.
    **Typical activities:** media/DRM validation; driving-state gating of video and text entry.
    ```
  - googleFocus: `Validate media/DRM and confirm driving-state gating of video and text entry.`

- **P11 OTA & A/B updates**
  - description:
    ```
    **Exit outcome:** End-to-end OTA delivers; A/B seamless update applies and rolls back
    cleanly; granular SDV per-module update works where in scope.
    **Co-leads:** OEM + Tier 1.
    **Typical activities:** OTA pipeline; A/B seamless update; rollback; per-module SDV update.
    ```
  - googleFocus: `Coordinate framework patch backports; validate the A/B and rollback paths against AOSP expectations.`

- **P12 Compliance gates**
  - description:
    ```
    **Exit outcome:** CDD automotive addendum met; VTS, CTS and CTS-on-GSI pass; GTS passes
    on the GAS path.
    **Co-leads:** OEM/Tier 1 run the suites; Google owns them.
    **Typical activities:** run xTS (CDD/VTS/CTS/CTS-on-GSI/GTS); failure triage; waiver
    handling. Shift testing left into CI. The dominant loop.
    ```
  - googleFocus: `Core TSC triage work: classify each failure as an AOSP defect, a BSP bug, or a test-infra problem; route real AOSP issues to Google eng; unblock waivers where defensible.`

- **P13 GAS / GBI certification**
  - description:
    ```
    **Exit outcome:** GBI certified through the 3PL; Play, Maps and Assistant/Gemini licensed
    and signed off.
    **Co-leads:** 3PL + Google licensing.
    **Typical activities:** 3PL campaign (~4-week clean run); licensing sign-off; late-finding burndown.
    ```
  - googleFocus: `Shepherd the 3PL engagement; reserve the lab slot before P12 is clean; dry-run GTS internally; keep the ~4-week clean-run campaign on track.`

- **P14 Launch readiness & SOP (GBI)** — **end phase**
  - description:
    ```
    **Exit outcome:** Launch-readiness review passed; open-bug burndown complete; sign-off
    granted for Start of Production. This is the program's single convergence point / final
    deliverable.
    **Co-leads:** OEM, with Google sign-off.
    **Typical activities:** launch-readiness review; open-defect burndown; go/no-go decision.
    ```
  - googleFocus: `Run the final readiness review; own the open-defect list and the go/no-go technical recommendation.`

### 5.4 Also migrate the existing stubs

Seed `GAS` (3 phases) and `Digital Key` (3 phases) from `src/lib/templates.ts` as built-in
`ProgramTemplate` rows too, so the hardcoded constant can be retired. Keep the typed
constant in code as the **seed source of truth** (the seeder writes it into the tables);
`seed.ts`'s 8 references keep reading from that constant with no behavior change.

---

## 6. Management UI (CRUD)

- **`/templates`** — list built-in + user templates; New / Clone / Delete (built-ins are
  clone-only).
- **`/templates/[id]/edit`** — add/edit/delete phase-templates via `<dialog>` (matches
  `design.md` §5): name, markdown description, markdown Google Focus, lead-role select,
  duration (weeks), dependency multiselect. Live DAG preview reusing `PhaseGraph.tsx` +
  an inline validation banner from `templateDag.ts`. Borderless/Tufte per `design.md`.
- Server actions in `src/app/actions/templates.ts`.

---

## 7. Wire into project creation

Refactor `src/app/projects/new/page.tsx` and `src/app/admin/page.tsx` to read templates
from the DB instead of the `TEMPLATES` constant. On instantiation, copy
`description` / `googleFocus` / `durationWeeks×7` / `isEndPhase` onto each `Phase`, rebuild
the dependency graph, map `leadRole → leadPartnerId` where possible, and re-run
`templateDag` validation inside the existing `$transaction`.

---

## 8. Suggested build sequence

1. Schema + migration + `src/lib/templateDag.ts` (+ jest tests).
2. Seed refactor: built-in rows + the full 16-row AAOS template above.
3. Point `projects/new` + `admin` at DB templates (backward-compatible).
4. Authoring UI (`/templates`).

Steps 1–3 deliver "pick a richer template"; step 4 delivers "create your own".
