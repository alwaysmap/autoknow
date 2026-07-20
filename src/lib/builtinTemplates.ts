// Built-in program templates (PHASE_TEMPLATES_PLAN §5). This constant is the seed
// source of truth: ensureBuiltinTemplates (lib/programTemplates) writes it into the
// ProgramTemplate tables. Client-safe pure data — validated by tests/builtinTemplates.
//
// The AAOS bring-up is the full 15-phase DAG (P0–P14) from the Part 4 bring-up doc;
// P15 post-launch sustaining is deliberately NOT a DAG node — it lives in the
// program-level description as a post-SOP lifecycle note, keeping the single-sink rule
// clean. GAS and Digital Key migrate the old hardcoded stubs (lib/templates.ts keeps
// feeding the sample-data seeder unchanged).
//
// Every phase description is a **Goal** (why the phase exists, one sentence) plus a
// **Done when** checklist of binary, provable criteria — things a reviewer can verify
// pass/fail, never "mostly working" prose. Activities, co-lead colour and schedule
// folklore belong in googleFocus or the program description, not in the DoD.

export interface BuiltinPhaseTemplate {
  key: string; // stable key for dependsOn references (e.g. "P2")
  name: string;
  description: string; // markdown — **Goal:** + **Done when:** provable checklist
  googleFocus: string; // markdown — what Googlers/TSC focus on
  leadRole: string; // primary accountable lead
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
      description: `**Goal:** Freeze the platform architecture every party builds against.

**Done when:**
- SoC, hypervisor topology, partition map, OTA strategy and AAOS/GAS scope are recorded in the locked architecture document
- the responsibility matrix is signed by OEM, Tier 1 and silicon vendor
- no open architecture decision remains on the program risk register`,
      googleFocus: `Run the early architecture review; push VINTF-compliant posture, sane hypervisor topology and OTA design; flag the Android-version/BSP schedule risk before it's baked in.`,
    },
    {
      key: 'P1',
      name: 'Silicon & dev environment',
      leadRole: 'OEM',
      durationWeeks: 6,
      dependsOn: ['P0'],
      description: `**Goal:** Every party can build for and boot the selected silicon.

**Done when:**
- the SoC down-select decision is signed off
- each party holds a working dev kit or virtual-SoC instance
- a clean checkout builds and boots on it following the documented toolchain setup`,
      googleFocus: `Advise on AAOS support maturity of candidate SoCs; point teams to Cuttlefish/Trout and the Snapdragon vSoC cloud path so integration starts before hardware lands.`,
    },
    {
      key: 'P2',
      name: 'BSP & power-on',
      leadRole: 'Silicon vendor',
      durationWeeks: 18,
      dependsOn: ['P1'],
      description: `**Goal:** The target board runs the target-version kernel reliably enough to carry all downstream bring-up.

**Done when:**
- bootloader and kernel boot to console on the target board
- RAM, UFS/eMMC storage and all core peripherals enumerate in the boot log
- 20 consecutive cold boots succeed on at least two boards`,
      googleFocus: `Mostly observing; track BSP delivery against the target Android version because this is the #1 schedule slip. Own the escalation path into Core Engineering for genuinely upstream defects.`,
    },
    {
      key: 'P3',
      name: 'Display & graphics',
      leadRole: 'Tier 1',
      durationWeeks: 6,
      dependsOn: ['P2'],
      description: `**Goal:** AAOS renders on every vehicle display at production quality.

**Done when:**
- the AAOS home screen renders at target resolution and refresh rate on every display
- SurfaceFlinger/HWC composition passes the display validation suite
- all in-scope displays run simultaneously without artifacts`,
      googleFocus: `Triage compositor/HWC defects that only appear when AAOS runs atop the vendor BSP; route true AOSP bugs to Google eng.`,
    },
    {
      key: 'P4',
      name: 'Audio',
      leadRole: 'Tier 1',
      durationWeeks: 8,
      dependsOn: ['P2'],
      description: `**Goal:** Automotive audio routing behaves to spec in every zone.

**Done when:**
- audio plays and mic capture works in every configured zone
- every case in the audio-focus test list passes (e.g. driver alert ducks media)
- chime/alert latency measures inside the agreed budget`,
      googleFocus: `Validate the Android audio policy and zone config against real automotive routing (driver alerts over media, etc.).`,
    },
    {
      key: 'P5',
      name: 'Connectivity',
      leadRole: 'Tier 1',
      durationWeeks: 12,
      dependsOn: ['P2'],
      description: `**Goal:** Every radio connects and phone projection works.

**Done when:**
- Wi-Fi, Bluetooth, cellular modem and GNSS each pass their bring-up test suite
- Android Auto projection pairs and casts on every phone in the reference matrix`,
      googleFocus: `Confirm Android Auto projection conformance; triage BT/Wi-Fi stack issues against AOSP behaviour.`,
    },
    {
      key: 'P6',
      name: 'Vehicle sensors & VHAL',
      leadRole: 'OEM',
      durationWeeks: 24,
      dependsOn: ['P2'],
      description: `**Goal:** Vehicle state flows into Android exactly as the signal catalog defines.

**Done when:**
- every catalogued signal (speed, gear, HVAC, doors, seats, lighting, energy, ADAS state) arrives as a VehiclePropValue
- system (Google-defined) and vendor (OEM-defined) properties pass verification against the signal catalog
- zero in-scope signals remain unmapped`,
      googleFocus: `Drive VHAL and signal-catalog alignment; adopt the standard AAOS SDV catalog and reuse vendor-property definitions to kill custom-property churn. COVESA VHAL workshop is the venue.`,
    },
    {
      key: 'P7',
      name: 'Camera & ADAS surfaces (EVS)',
      leadRole: 'Tier 1',
      durationWeeks: 10,
      dependsOn: ['P2'],
      description: `**Goal:** Regulatory camera views render inside the latency budget.

**Done when:**
- rearview and surround-view render through the EVS path
- cold-boot-to-rearview-image time measures inside the FMVSS-111 budget, recorded and repeatable
- the EVS validation suite passes`,
      googleFocus: `Triage EVS/Camera-HAL issues; check backup-camera timing against the FMVSS-111 boot-to-image requirement.`,
    },
    {
      key: 'P8',
      name: 'Hypervisor & mixed-criticality',
      leadRole: 'Hypervisor vendor',
      durationWeeks: 18,
      dependsOn: ['P2'],
      description: `**Goal:** IVI and safety VMs provably coexist on one SoC.

**Done when:**
- AAOS (IVI VM) and the cluster/safety VM boot and run together on the target SoC
- the freedom-from-interference test passes: a forced IVI crash leaves the cluster VM running within its deadlines`,
      googleFocus: `Ensure AAOS behaves correctly as a guest; work boot-orchestration and resource-partition issues with the hypervisor vendor.`,
    },
    {
      key: 'P9',
      name: 'App platform & Google services',
      leadRole: 'OEM',
      durationWeeks: 12,
      dependsOn: ['P5'],
      description: `**Goal:** Google services run on device with driving-state gating enforced.

**Done when:**
- Play Store, Google Maps and Assistant/Gemini install, launch and sign in on device
- Distraction-Optimized gating verified in Parked, Idling and Driving states
- app review and driver-distraction approvals are granted and recorded`,
      googleFocus: `Shepherd GAS enablement; validate driving-state gating; coordinate app review and driver-distraction approvals; route Maps integration to the Geo/Maps team.`,
    },
    {
      key: 'P10',
      name: 'Rich media',
      leadRole: 'Tier 1',
      durationWeeks: 6,
      dependsOn: ['P3', 'P4', 'P9'],
      description: `**Goal:** Premium media works parked and is blocked in motion.

**Done when:**
- HD video plays while parked and Dolby Atmos output is verified
- immersive 3D navigation renders to spec
- video and text entry are blocked in motion in the gating test`,
      googleFocus: `Validate media/DRM and confirm driving-state gating of video and text entry.`,
    },
    {
      key: 'P11',
      name: 'OTA & A/B updates',
      leadRole: 'OEM',
      durationWeeks: 12,
      dependsOn: ['P2'],
      description: `**Goal:** The vehicle can be updated and recovered over the air.

**Done when:**
- an end-to-end OTA delivers and applies through the A/B slots
- a forced-failure update rolls back cleanly to the previous slot
- per-module SDV update verified where in scope`,
      googleFocus: `Coordinate framework patch backports; validate the A/B and rollback paths against AOSP expectations.`,
    },
    {
      key: 'P12',
      name: 'Compliance gates',
      leadRole: 'OEM',
      durationWeeks: 18,
      dependsOn: ['P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P10', 'P11'],
      description: `**Goal:** The build passes Android compatibility.

**Done when:**
- VTS, CTS and CTS-on-GSI pass; GTS passes on the GAS path
- the CDD automotive addendum checklist is met
- every remaining failure carries an approved waiver`,
      googleFocus: `Core TSC triage work: classify each failure as an AOSP defect, a BSP bug, or a test-infra problem; route real AOSP issues to Google eng; unblock waivers where defensible.`,
    },
    {
      key: 'P13',
      name: 'GAS / GBI certification',
      leadRole: '3PL',
      durationWeeks: 6,
      dependsOn: ['P12'],
      description: `**Goal:** GBI is certified and licensed to ship.

**Done when:**
- the 3PL certification campaign completes a clean run
- Play, Maps and Assistant/Gemini licensing sign-offs are recorded`,
      googleFocus: `Shepherd the 3PL engagement; reserve the lab slot before P12 is clean; dry-run GTS internally; keep the ~4-week clean-run campaign on track.`,
    },
    {
      key: 'P14',
      name: 'Launch readiness & SOP (GBI)',
      leadRole: 'OEM',
      durationWeeks: 6,
      isEndPhase: true,
      dependsOn: ['P13'],
      description: `**Goal:** The program is signed off to start production — the single convergence point and final deliverable.

**Done when:**
- the launch-readiness review passes
- the open-defect burndown reaches the agreed launch bar
- the go/no-go decision is recorded as GO with Google sign-off`,
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
      description: `**Goal:** GMS core runs on the target build.

**Done when:**
- GMS core packages integrate into the build
- the build boots with GMS enabled and passes the GMS smoke suite`,
      googleFocus: 'Support GMS package integration; triage boot-time integration failures.',
    },
    {
      key: 'G1',
      name: 'Play Store configuration',
      leadRole: 'Google',
      durationWeeks: 2,
      dependsOn: [],
      description: `**Goal:** Play serves apps to this device.

**Done when:**
- the device fingerprint is registered with Play
- Play Store lists and installs the reference app set on device`,
      googleFocus: 'Drive device fingerprint registration and store configuration.',
    },
    {
      key: 'G2',
      name: 'GAS Compliance',
      leadRole: 'OEM',
      durationWeeks: 6,
      isEndPhase: true,
      dependsOn: ['G0', 'G1'],
      description: `**Goal:** The device is certified to ship GAS.

**Done when:**
- GTS passes with zero unwaived failures
- GAS licensing sign-off is recorded`,
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
      description: `**Goal:** NFC hardware works under the target kernel.

**Done when:**
- the NFC controller enumerates and tag reads pass
- the driver completes the stability soak on the target kernel without faults`,
      googleFocus: 'Triage NFC stack issues against AOSP behaviour.',
    },
    {
      key: 'D1',
      name: 'Secure Element configuration',
      leadRole: 'Tier 1',
      durationWeeks: 4,
      dependsOn: [],
      description: `**Goal:** The Secure Element is ready to hold key applets.

**Done when:**
- the SE is provisioned on the target hardware
- applet install, update and delete each verify end to end`,
      googleFocus: 'Advise on SE provisioning flows and applet lifecycle expectations.',
    },
    {
      key: 'D2',
      name: 'CCC Spec Compliance',
      leadRole: 'OEM',
      durationWeeks: 6,
      isEndPhase: true,
      dependsOn: ['D0', 'D1'],
      description: `**Goal:** Digital key interop is certified.

**Done when:**
- CCC digital-key conformance passes
- interoperability verifies against every phone in the target matrix`,
      googleFocus: 'Coordinate CCC conformance; validate Android-side key provisioning and sharing flows.',
    },
  ],
};

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [AAOS, GAS, DIGITAL_KEY];
