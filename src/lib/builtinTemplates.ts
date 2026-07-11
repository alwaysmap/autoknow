// Built-in program templates (PHASE_TEMPLATES_PLAN §5). This constant is the seed
// source of truth: ensureBuiltinTemplates (lib/programTemplates) writes it into the
// ProgramTemplate tables. Client-safe pure data — validated by tests/builtinTemplates.
//
// The AAOS bring-up is the full 15-phase DAG (P0–P14) from the Part 4 bring-up doc;
// P15 post-launch sustaining is deliberately NOT a DAG node — it lives in the
// program-level description as a post-SOP lifecycle note, keeping the single-sink rule
// clean. GAS and Digital Key migrate the old hardcoded stubs (lib/templates.ts keeps
// feeding the sample-data seeder unchanged).

export interface BuiltinPhaseTemplate {
  key: string; // stable key for dependsOn references (e.g. "P2")
  name: string;
  description: string; // markdown — exit outcome + typical activities
  googleFocus: string; // markdown — what Googlers/TSC focus on
  leadRole: string; // primary accountable lead (co-leads noted in description)
  durationWeeks: number;
  isEndPhase?: boolean;
  dependsOn: string[]; // keys
}

export interface BuiltinTemplate {
  name: string;
  description: string; // markdown, program-level
  phases: BuiltinPhaseTemplate[];
}

export const LEAD_ROLES = ['OEM', 'Silicon vendor', 'Tier 1', 'Google', '3PL', 'Hypervisor vendor'] as const;

const AAOS: BuiltinTemplate = {
  name: 'AAOS Bring-up (chipset → GBI)',
  description: `A ~30–40 month new-platform AAOS program from architecture lock to Start of Production, run as a relay across silicon vendor → Tier 1 → OEM → Google, with a 3PL and hypervisor vendor entering at specific gates. Critical path: **P0 → P1 → P2 → P6 → P12 → P13 → P14**. Long poles: BSP stabilization (P2), VHAL/signal-catalog convergence (P6), and the compliance-triage loop (P12).

**Post-SOP (not in the DAG):** *Sustaining* — security patches + Android-version upgrades delivered OTA across the 10–15yr vehicle lifecycle; the canonical TSC home. Model as a standing track once the program reaches SOP.`,
  phases: [
    {
      key: 'P0',
      name: 'Architecture lock',
      leadRole: 'OEM',
      durationWeeks: 8,
      dependsOn: [],
      description: `**Exit outcome:** Platform architecture frozen — SoC, hypervisor topology, partition map, OTA strategy, and AAOS/GAS scope agreed; responsibility matrix signed.
**Co-leads:** OEM (with Tier 1 + silicon vendor).
**Typical activities:** early architecture review; VINTF posture; hypervisor topology; OTA design; Android-version/BSP schedule risk assessment.`,
      googleFocus: `Run the early architecture review; push VINTF-compliant posture, sane hypervisor topology and OTA design; flag the Android-version/BSP schedule risk before it's baked in.`,
    },
    {
      key: 'P1',
      name: 'Silicon & dev environment',
      leadRole: 'OEM',
      durationWeeks: 6,
      dependsOn: ['P0'],
      description: `**Exit outcome:** SoC selected; physical dev kits and/or virtual SoC available to every party; toolchains and source access stood up.
**Co-leads:** OEM selects, silicon vendor supplies.
**Typical activities:** SoC down-select; dev-kit / vSoC provisioning; toolchain + source access.`,
      googleFocus: `Advise on AAOS support maturity of candidate SoCs; point teams to Cuttlefish/Trout and the Snapdragon vSoC cloud path so integration starts before hardware lands.`,
    },
    {
      key: 'P2',
      name: 'BSP & power-on',
      leadRole: 'Silicon vendor',
      durationWeeks: 18,
      dependsOn: ['P1'],
      description: `**Exit outcome:** Board powers on; bootloader and kernel boot to console; RAM, storage (UFS/eMMC) and core peripherals enumerate.
**Co-leads:** Silicon vendor (reference BSP) → Tier 1 (board port).
**Typical activities:** reference BSP delivery; board port; bootloader/kernel bring-up; peripheral enumeration. #1 schedule slip.`,
      googleFocus: `Mostly observing; track BSP delivery against the target Android version because this is the #1 schedule slip. Own the escalation path into Core Engineering for genuinely upstream defects.`,
    },
    {
      key: 'P3',
      name: 'Display & graphics',
      leadRole: 'Tier 1',
      durationWeeks: 6,
      dependsOn: ['P2'],
      description: `**Exit outcome:** Screens light up; SurfaceFlinger composites; AAOS home screen renders at target resolution/refresh; multi-display works.
**Co-leads:** Tier 1 (Display HAL) + silicon vendor (GPU driver).
**Typical activities:** Display HAL bring-up; GPU driver integration; HWC/compositor validation.`,
      googleFocus: `Triage compositor/HWC defects that only appear when AAOS runs atop the vendor BSP; route true AOSP bugs to Google eng.`,
    },
    {
      key: 'P4',
      name: 'Audio',
      leadRole: 'Tier 1',
      durationWeeks: 8,
      dependsOn: ['P2'],
      description: `**Exit outcome:** Audio routes to all zones; mics capture; AAOS audio focus and zones behave; chimes/alerts meet latency.
**Co-leads:** Tier 1 (Audio HAL, amp).
**Typical activities:** Audio HAL + amp integration; zone routing; audio-focus policy; alert latency.`,
      googleFocus: `Validate the Android audio policy and zone config against real automotive routing (driver alerts over media, etc.).`,
    },
    {
      key: 'P5',
      name: 'Connectivity',
      leadRole: 'Tier 1',
      durationWeeks: 12,
      dependsOn: ['P2'],
      description: `**Exit outcome:** Wi-Fi, Bluetooth, cellular modem and GNSS all connect and pass; Android Auto phone projection pairs and casts.
**Co-leads:** Tier 1 + modem vendor.
**Typical activities:** Wi-Fi/BT/modem/GNSS bring-up; Android Auto projection conformance.`,
      googleFocus: `Confirm Android Auto projection conformance; triage BT/Wi-Fi stack issues against AOSP behaviour.`,
    },
    {
      key: 'P6',
      name: 'Vehicle sensors & VHAL',
      leadRole: 'OEM',
      durationWeeks: 24,
      dependsOn: ['P2'],
      description: `**Exit outcome:** Speed, gear, HVAC, doors, seats, lighting, energy and ADAS state flow into Android as VehiclePropValues; system (Google-defined) and vendor (OEM-defined) properties verified against the signal catalog.
**Co-leads:** OEM + Tier 1 (CAN/Ethernet → VHAL).
**Typical activities:** CAN/Ethernet → VHAL mapping; signal-catalog alignment; system vs vendor property verification. Heaviest TSC engagement.`,
      googleFocus: `Drive VHAL and signal-catalog alignment; adopt the standard AAOS SDV catalog and reuse vendor-property definitions to kill custom-property churn. COVESA VHAL workshop is the venue.`,
    },
    {
      key: 'P7',
      name: 'Camera & ADAS surfaces (EVS)',
      leadRole: 'Tier 1',
      durationWeeks: 10,
      dependsOn: ['P2'],
      description: `**Exit outcome:** Rearview/surround-view camera renders within the regulatory boot-to-image latency budget; the EVS (Exterior View System) path is validated.
**Co-leads:** Tier 1 + silicon vendor.
**Typical activities:** Camera HAL + EVS bring-up; backup-camera boot-to-image timing.`,
      googleFocus: `Triage EVS/Camera-HAL issues; check backup-camera timing against the FMVSS-111 boot-to-image requirement.`,
    },
    {
      key: 'P8',
      name: 'Hypervisor & mixed-criticality',
      leadRole: 'Hypervisor vendor',
      durationWeeks: 18,
      dependsOn: ['P2'],
      description: `**Exit outcome:** AAOS (IVI VM) and the cluster/safety VM coexist on one SoC; freedom-from-interference proven — an IVI crash cannot disturb the cluster.
**Co-leads:** Hypervisor vendor + Tier 1.
**Typical activities:** guest-VM bring-up; boot orchestration; resource partitioning; FFI proof.`,
      googleFocus: `Ensure AAOS behaves correctly as a guest; work boot-orchestration and resource-partition issues with the hypervisor vendor.`,
    },
    {
      key: 'P9',
      name: 'App platform & Google services',
      leadRole: 'OEM',
      durationWeeks: 12,
      dependsOn: ['P5'],
      description: `**Exit outcome:** (GAS path) Play Store, Google Maps and Assistant/Gemini run on device; Distraction-Optimized apps are correctly gated by driving state.
**Co-leads:** OEM + Google.
**Typical activities:** GAS enablement; Parked/Idling/Driving gating; app review + driver-distraction approvals.`,
      googleFocus: `Shepherd GAS enablement; validate driving-state gating; coordinate app review and driver-distraction approvals; route Maps integration to the Geo/Maps team.`,
    },
    {
      key: 'P10',
      name: 'Rich media',
      leadRole: 'Tier 1',
      durationWeeks: 6,
      dependsOn: ['P3', 'P4', 'P9'],
      description: `**Exit outcome:** HD video while parked, Dolby Atmos, and immersive 3D nav render to spec; video correctly blocked in motion.
**Co-leads:** Tier 1 + OEM.
**Typical activities:** media/DRM validation; driving-state gating of video and text entry.`,
      googleFocus: `Validate media/DRM and confirm driving-state gating of video and text entry.`,
    },
    {
      key: 'P11',
      name: 'OTA & A/B updates',
      leadRole: 'OEM',
      durationWeeks: 12,
      dependsOn: ['P2'],
      description: `**Exit outcome:** End-to-end OTA delivers; A/B seamless update applies and rolls back cleanly; granular SDV per-module update works where in scope.
**Co-leads:** OEM + Tier 1.
**Typical activities:** OTA pipeline; A/B seamless update; rollback; per-module SDV update.`,
      googleFocus: `Coordinate framework patch backports; validate the A/B and rollback paths against AOSP expectations.`,
    },
    {
      key: 'P12',
      name: 'Compliance gates',
      leadRole: 'OEM',
      durationWeeks: 18,
      dependsOn: ['P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P10', 'P11'],
      description: `**Exit outcome:** CDD automotive addendum met; VTS, CTS and CTS-on-GSI pass; GTS passes on the GAS path.
**Co-leads:** OEM/Tier 1 run the suites; Google owns them.
**Typical activities:** run xTS (CDD/VTS/CTS/CTS-on-GSI/GTS); failure triage; waiver handling. Shift testing left into CI. The dominant loop.`,
      googleFocus: `Core TSC triage work: classify each failure as an AOSP defect, a BSP bug, or a test-infra problem; route real AOSP issues to Google eng; unblock waivers where defensible.`,
    },
    {
      key: 'P13',
      name: 'GAS / GBI certification',
      leadRole: '3PL',
      durationWeeks: 6,
      dependsOn: ['P12'],
      description: `**Exit outcome:** GBI certified through the 3PL; Play, Maps and Assistant/Gemini licensed and signed off.
**Co-leads:** 3PL + Google licensing.
**Typical activities:** 3PL campaign (~4-week clean run); licensing sign-off; late-finding burndown.`,
      googleFocus: `Shepherd the 3PL engagement; reserve the lab slot before P12 is clean; dry-run GTS internally; keep the ~4-week clean-run campaign on track.`,
    },
    {
      key: 'P14',
      name: 'Launch readiness & SOP (GBI)',
      leadRole: 'OEM',
      durationWeeks: 6,
      isEndPhase: true,
      dependsOn: ['P13'],
      description: `**Exit outcome:** Launch-readiness review passed; open-bug burndown complete; sign-off granted for Start of Production. This is the program's single convergence point / final deliverable.
**Co-leads:** OEM, with Google sign-off.
**Typical activities:** launch-readiness review; open-defect burndown; go/no-go decision.`,
      googleFocus: `Run the final readiness review; own the open-defect list and the go/no-go technical recommendation.`,
    },
  ],
};

// Migrated from the old hardcoded stubs (lib/templates.ts). Durations: days ÷ 7,
// rounded. The final phase of each is the converging end phase.
const GAS: BuiltinTemplate = {
  name: 'GAS',
  description: 'Google Automotive Services integration: GMS core + Play Store configuration converging on GAS compliance.',
  phases: [
    {
      key: 'G0',
      name: 'GMS Core Integration',
      leadRole: 'OEM',
      durationWeeks: 3,
      dependsOn: [],
      description: '**Exit outcome:** GMS core packages integrate and boot on the target build.\n**Typical activities:** GMS package integration; boot validation.',
      googleFocus: 'Support GMS package integration; triage boot-time integration failures.',
    },
    {
      key: 'G1',
      name: 'Play Store configuration',
      leadRole: 'Google',
      durationWeeks: 2,
      dependsOn: [],
      description: '**Exit outcome:** Play Store configured for the device fingerprint; app availability verified.\n**Typical activities:** device fingerprint registration; store configuration.',
      googleFocus: 'Drive device fingerprint registration and store configuration.',
    },
    {
      key: 'G2',
      name: 'GAS Compliance',
      leadRole: 'OEM',
      durationWeeks: 6,
      isEndPhase: true,
      dependsOn: ['G0', 'G1'],
      description: '**Exit outcome:** GAS compliance suites pass; licensing sign-off granted.\n**Typical activities:** GTS runs; failure triage; licensing sign-off.',
      googleFocus: 'Own the compliance suites; route real AOSP issues to Google eng; manage sign-off.',
    },
  ],
};

const DIGITAL_KEY: BuiltinTemplate = {
  name: 'Digital Key',
  description: 'Digital Key bring-up: NFC and Secure Element tracks converging on CCC spec compliance.',
  phases: [
    {
      key: 'D0',
      name: 'NFC Driver bring-up',
      leadRole: 'Tier 1',
      durationWeeks: 2,
      dependsOn: [],
      description: '**Exit outcome:** NFC controller enumerates and reads; driver stable under the target kernel.\n**Typical activities:** NFC driver port; antenna tuning validation.',
      googleFocus: 'Triage NFC stack issues against AOSP behaviour.',
    },
    {
      key: 'D1',
      name: 'Secure Element configuration',
      leadRole: 'Tier 1',
      durationWeeks: 4,
      dependsOn: [],
      description: '**Exit outcome:** Secure Element provisioned; applet lifecycle management works end to end.\n**Typical activities:** SE provisioning; applet lifecycle validation.',
      googleFocus: 'Advise on SE provisioning flows and applet lifecycle expectations.',
    },
    {
      key: 'D2',
      name: 'CCC Spec Compliance',
      leadRole: 'OEM',
      durationWeeks: 6,
      isEndPhase: true,
      dependsOn: ['D0', 'D1'],
      description: '**Exit outcome:** CCC digital-key certification passes; interoperability verified with target phones.\n**Typical activities:** CCC conformance runs; cross-device interop matrix.',
      googleFocus: 'Coordinate CCC conformance; validate Android-side key provisioning and sharing flows.',
    },
  ],
};

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [AAOS, GAS, DIGITAL_KEY];
