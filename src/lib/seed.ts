import { prisma } from './db';
import { TEMPLATES } from './templates';
import { ingestRecord } from './vector';

export async function wipeAllData() {
  console.log('Wiping all database records...');
  await prisma.actionItem.deleteMany();
  await prisma.contextUrl.deleteMany();
  await prisma.phaseState.deleteMany();
  await prisma.phaseDependency.deleteMany();
  await prisma.phase.deleteMany();
  await prisma.projectState.deleteMany();
  await prisma.partnerState.deleteMany();
  await prisma.project.deleteMany();
  await prisma.personAffiliation.deleteMany();
  await prisma.person.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.region.deleteMany();
  await prisma.partnerType.deleteMany();
}

export async function seedCoreData() {
  console.log('Seeding core data only (Regions, Partner Types, Google)...');
  await wipeAllData();

  const typeOem = await prisma.partnerType.create({ data: { name: 'OEM' } });
  await prisma.partnerType.create({ data: { name: 'Supplier' } });

  const regAmer = await prisma.region.create({ data: { name: 'AMER' } });
  await prisma.region.create({ data: { name: 'APAC' } });
  await prisma.region.create({ data: { name: 'EMEA' } });
  await prisma.region.create({ data: { name: 'Other' } });

  // Create default Google partner so employees can be affiliated
  await prisma.partner.create({
    data: { name: 'Google LLC', typeId: typeOem.id, regionId: regAmer.id }
  });
}

interface SeedPhase {
  id: number;
  name: string;
  projectId: number;
}

export async function seedMockData() {
  console.log('Seeding full mock data...');
  await wipeAllData();

  console.log('Seeding lookup tables (Regions, Partner Types)...');
  const typeOem = await prisma.partnerType.create({ data: { name: 'OEM' } });
  const typeSupplier = await prisma.partnerType.create({ data: { name: 'Supplier' } });

  const regAmer = await prisma.region.create({ data: { name: 'AMER' } });
  const regApac = await prisma.region.create({ data: { name: 'APAC' } });
  const regEmea = await prisma.region.create({ data: { name: 'EMEA' } });
  const regOther = await prisma.region.create({ data: { name: 'Other' } });

  console.log('Seeding partners (Google self + external OEM & supplier)...');
  // First seed Google LLC as a partner to hold Googlers
  const googlePartner = await prisma.partner.create({
    data: {
      name: 'Google LLC',
      typeId: typeOem.id,
      website: 'https://www.google.com',
      internalDetailsUrl: 'https://drive.google.com/drive/folders/google-internal',
      summary: 'Internal Google team profiles and program manager affiliations.',
      phone: '+1-650-253-0000',
      regionId: regAmer.id,
      googleTeam: []
    }
  });

  const ford = await prisma.partner.create({
    data: {
      name: 'Ford',
      typeId: typeOem.id,
      website: 'https://www.ford.com',
      internalDetailsUrl: 'https://drive.google.com/drive/folders/ford-partnership',
      summary: 'Strategic OEM partnership focused on Ford Evos AAOS software stack, instrument cluster integration, and cockpit security features.',
      phone: '+1-313-322-3000',
      regionId: regAmer.id,
      googleTeam: [
        { email: 'dylan@google.com', role: 'Relationship Lead' },
        { email: 'bob@google.com', role: 'Cloud Account Manager' }
      ]
    }
  });

  const toyota = await prisma.partner.create({
    data: {
      name: 'Toyota',
      typeId: typeOem.id,
      website: 'https://www.toyota-global.com',
      internalDetailsUrl: 'https://drive.google.com/drive/folders/toyota-partnership',
      summary: 'Long-term OEM relationship for standardizing Android Automotive OS components on next-gen e-TNGA EV platform architectures.',
      phone: '+81-565-28-2121',
      regionId: regApac.id,
      googleTeam: [
        { email: 'alice@google.com', role: 'Partner Engineering Manager' }
      ]
    }
  });

  const bosch = await prisma.partner.create({
    data: {
      name: 'Bosch',
      typeId: typeSupplier.id,
      website: 'https://www.bosch.com',
      internalDetailsUrl: 'https://drive.google.com/drive/folders/bosch-partnership',
      summary: 'Tier-1 supplier collaboration delivering telematics control units (TCU) and ADAS sensor suite calibration protocols.',
      phone: '+49-711-400-40290',
      regionId: regEmea.id,
      googleTeam: [
        { email: 'clara@google.com', role: 'Supplier Operations Lead' }
      ]
    }
  });
  
  const qualcomm = await prisma.partner.create({
    data: {
      name: 'Qualcomm',
      typeId: typeSupplier.id,
      website: 'https://www.qualcomm.com',
      internalDetailsUrl: 'https://drive.google.com/drive/folders/qualcomm-partnership',
      summary: 'Silicon provider alignment for optimizing Snapdragon Cockpit platforms (SA8155P/SA8295P) with Google Automotive Services (GAS).',
      phone: '+1-858-587-1121',
      regionId: regAmer.id,
      googleTeam: [
        { email: 'dylan@google.com', role: 'Silicon Alignment Engineer' }
      ]
    }
  });

  console.log('Seeding people...');
  const dylan = await prisma.person.create({
    data: {
      name: 'Dylan PM',
      email: 'dylan@google.com',
      currentPartnerId: googlePartner.id,
      notes: 'Lead Program Manager for AutoKnow ecosystem and Ford relationship.'
    }
  });

  const bob = await prisma.person.create({
    data: {
      name: 'Bob AccountManager',
      email: 'bob@google.com',
      currentPartnerId: googlePartner.id,
      notes: 'Cloud Account Manager supervising OEM contract executions.'
    }
  });

  const kenji = await prisma.person.create({
    data: {
      name: 'Kenji Sato',
      email: 'kenji.sato@toyota.com',
      currentPartnerId: toyota.id,
      notes: 'VP of Software Engineering at Toyota Connected.'
    }
  });

  const dieter = await prisma.person.create({
    data: {
      name: 'Dieter Meyer',
      email: 'dieter.meyer@bosch.com',
      currentPartnerId: bosch.id,
      notes: 'Senior Lead ADAS architect at Bosch GmbH.'
    }
  });

  const sarah = await prisma.person.create({
    data: {
      name: 'Sarah Jenkins',
      email: 'sjenkins@qualcomm.com',
      currentPartnerId: qualcomm.id,
      notes: 'Qualcomm Snapdragon Cockpit product manager.'
    }
  });

  console.log('Seeding person affiliations...');
  await prisma.personAffiliation.create({
    data: {
      personId: dylan.id,
      partnerId: googlePartner.id,
      role: 'Lead Program Manager',
      startDate: new Date('2024-01-01')
    }
  });

  await prisma.personAffiliation.create({
    data: {
      personId: bob.id,
      partnerId: googlePartner.id,
      role: 'Cloud Account Manager',
      startDate: new Date('2024-03-15')
    }
  });

  await prisma.personAffiliation.create({
    data: {
      personId: kenji.id,
      partnerId: toyota.id,
      role: 'VP of Software Engineering',
      startDate: new Date('2022-06-01')
    }
  });

  await prisma.personAffiliation.create({
    data: {
      personId: dieter.id,
      partnerId: bosch.id,
      role: 'Senior ADAS Systems Lead',
      startDate: new Date('2023-01-10')
    }
  });

  await prisma.personAffiliation.create({
    data: {
      personId: sarah.id,
      partnerId: qualcomm.id,
      role: 'Snapdragon Automotive PM',
      startDate: new Date('2023-09-01')
    }
  });

  console.log('Seeding projects...');

  // 1. Ford Evos AAOS Bring-up
  const fordProject = await prisma.project.create({
    data: {
      name: 'Ford Evos AAOS Bring-up',
      partnerId: ford.id,
      ownerName: 'Dylan PM',
      sopDate: new Date('2026-10-01'),
      volumeFirstYear: 180000,
      theNeedle: 'Medium', // Medium Risk
      hillChartProgress: 40
    }
  });

  // Project states history logs for Ford
  await prisma.projectState.create({
    data: {
      projectId: fordProject.id,
      theNeedle: 'Low', // Low
      hillChartProgress: 20,
      notes: 'Initial blueprint kickoff complete.',
      source: 'Google Doc',
      sourceUrl: 'https://docs.google.com/document/d/ford-blueprint-kickoff',
      timestamp: new Date('2026-05-01')
    }
  });

  await prisma.projectState.create({
    data: {
      projectId: fordProject.id,
      theNeedle: 'Medium', // Medium
      hillChartProgress: 40,
      notes: 'Progressing on BSP, but VHAL wait times are elevated.',
      source: 'Google Chat',
      sourceUrl: 'https://chat.google.com/room/ford-evos-dev-talk',
      timestamp: new Date('2026-06-15')
    }
  });

  // Partner relationship state logs for Ford
  await prisma.partnerState.create({
    data: {
      partnerId: ford.id,
      theNeedle: 'Low', // Low
      hillChartProgress: 25,
      notes: 'Executive alignment calls are positive.',
      source: 'Google Chat',
      sourceUrl: 'https://chat.google.com/room/ford-exec-chat',
      timestamp: new Date('2026-05-10')
    }
  });

  await prisma.partnerState.create({
    data: {
      partnerId: ford.id,
      theNeedle: 'Medium', // Medium
      hillChartProgress: 35,
      notes: 'Medium risk due to supplier delivery timelines.',
      source: 'Google Doc',
      sourceUrl: 'https://docs.google.com/document/d/ford-partnership-status',
      timestamp: new Date('2026-06-20')
    }
  });

  // Phases for Ford Project
  const fordPhasesMap: Record<string, SeedPhase> = {};
  for (const p of TEMPLATES.AAOS.phases) {
    const phase = await prisma.phase.create({
      data: {
        name: p.name,
        projectId: fordProject.id,
        forecastedDuration: p.forecastedDuration
      }
    });
    fordPhasesMap[p.name] = phase;

    const isBsp = p.name === 'BSP & power-on';
    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: isBsp ? 'Active WIP' : 'Not Started',
        hillChartProgress: isBsp ? 40 : 0,
        theNeedle: isBsp ? 'Medium' : 'Low',
        isStagnant: false,
        notes: isBsp ? 'VHAL wait times are elevated.' : null,
        source: isBsp ? 'Buganizer' : null,
        sourceUrl: isBsp ? 'https://buganizer.corp.google.com/issues/889218' : null,
        timestamp: new Date('2026-06-10') // To give it some cycle time
      }
    });
  }

  // Dependencies for Ford
  for (const p of TEMPLATES.AAOS.phases) {
    const phase = fordPhasesMap[p.name];
    for (const depName of p.dependsOn) {
      const depPhase = fordPhasesMap[depName];
      await prisma.phaseDependency.create({
        data: {
          phaseId: phase.id,
          dependsOnPhaseId: depPhase.id
        }
      });
    }
  }

  // Action Items for Ford Project
  const bspPhase = fordPhasesMap['BSP & power-on'];
  await prisma.actionItem.create({
    data: {
      phaseId: bspPhase.id,
      description: 'Determine cause for VHAL wait time delay',
      assignedTo: '@dylan',
      assignedToPersonId: dylan.id,
      status: 'Pending',
      nextStep: 'Googler',
      linkUrl: 'https://buganizer.corp.google.com/issues/889218',
      source: 'Buganizer',
      sourceUrl: 'https://buganizer.corp.google.com/issues/889218'
    }
  });

  await prisma.actionItem.create({
    data: {
      phaseId: bspPhase.id,
      description: 'Verify cluster instrumentation panel interface specifications',
      assignedTo: '@ Kenji Sato',
      assignedToPersonId: kenji.id,
      status: 'Pending',
      nextStep: 'Partner',
      linkUrl: 'https://docs.google.com/document/d/cluster-specs-evos',
      source: 'Google Doc',
      sourceUrl: 'https://docs.google.com/document/d/cluster-specs-evos'
    }
  });


  // 2. Toyota Highlander Digital Key
  const toyotaProject = await prisma.project.create({
    data: {
      name: 'Toyota Highlander Digital Key',
      partnerId: toyota.id,
      ownerName: 'Alice PM',
      sopDate: new Date('2027-02-15'),
      volumeFirstYear: 250000,
      theNeedle: 'Low', // Low Risk
      hillChartProgress: 15
    }
  });

  // Project state logs for Toyota Digital Key
  await prisma.projectState.create({
    data: {
      projectId: toyotaProject.id,
      theNeedle: 'Low',
      hillChartProgress: 15,
      notes: 'Kickoff and initial threat modeling drafted.',
      source: 'Google Doc',
      sourceUrl: 'https://docs.google.com/document/d/toyota-digital-key-threat-model',
      timestamp: new Date('2026-06-01')
    }
  });

  const toyotaPhasesMap: Record<string, SeedPhase> = {};
  for (const p of TEMPLATES['Digital Key'].phases) {
    const phase = await prisma.phase.create({
      data: {
        name: p.name,
        projectId: toyotaProject.id,
        forecastedDuration: p.forecastedDuration
      }
    });
    toyotaPhasesMap[p.name] = phase;

    const isKickoff = p.name === 'Secure Element configuration';
    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: isKickoff ? 'Active WIP' : 'Not Started',
        hillChartProgress: isKickoff ? 15 : 0,
        theNeedle: 'Low',
        isStagnant: false,
        notes: isKickoff ? 'Threat modeling in review by partner teams.' : null,
        source: isKickoff ? 'Google Doc' : null,
        sourceUrl: isKickoff ? 'https://docs.google.com/document/d/toyota-digital-key-threat-model' : null,
        timestamp: new Date('2026-06-01')
      }
    });
  }

  for (const p of TEMPLATES['Digital Key'].phases) {
    const phase = toyotaPhasesMap[p.name];
    for (const depName of p.dependsOn) {
      const depPhase = toyotaPhasesMap[depName];
      await prisma.phaseDependency.create({
        data: {
          phaseId: phase.id,
          dependsOnPhaseId: depPhase.id
        }
      });
    }
  }

  // Action Items for Toyota
  const appPhase = toyotaPhasesMap['Secure Element configuration'];
  await prisma.actionItem.create({
    data: {
      phaseId: appPhase.id,
      description: 'Review security key exchange protocols for Highlander',
      assignedTo: '@ Kenji Sato',
      assignedToPersonId: kenji.id,
      status: 'Pending',
      nextStep: 'Partner',
      linkUrl: 'https://docs.google.com/document/d/security-key-toyota',
      source: 'Google Doc',
      sourceUrl: 'https://docs.google.com/document/d/security-key-toyota'
    }
  });


  // 3. Ford Explorer VHAL Integration (Bosch)
  const boschProject = await prisma.project.create({
    data: {
      name: 'Ford Explorer VHAL Integration (Bosch)',
      partnerId: bosch.id,
      ownerName: 'Clara Operations',
      sopDate: new Date('2026-11-20'),
      volumeFirstYear: 120000,
      theNeedle: 'High', // High Risk
      hillChartProgress: 60
    }
  });

  // Project state logs for Bosch Explorer
  await prisma.projectState.create({
    data: {
      projectId: boschProject.id,
      theNeedle: 'Medium', // Medium
      hillChartProgress: 50,
      notes: 'Initial integration testing succeeded.',
      source: 'Gerrit',
      sourceUrl: 'https://android-review.googlesource.com/c/platform/hardware/interfaces/+/12345',
      timestamp: new Date('2026-05-15')
    }
  });

  await prisma.projectState.create({
    data: {
      projectId: boschProject.id,
      theNeedle: 'High', // High
      hillChartProgress: 60,
      notes: 'Telemetry calibration failures reported in telemetry unit.',
      source: 'Buganizer',
      sourceUrl: 'https://buganizer.corp.google.com/issues/9987211',
      timestamp: new Date('2026-06-25')
    }
  });

  const boschPhasesMap: Record<string, SeedPhase> = {};
  for (const p of TEMPLATES.AAOS.phases) {
    const phase = await prisma.phase.create({
      data: {
        name: p.name,
        projectId: boschProject.id,
        forecastedDuration: p.forecastedDuration
      }
    });
    boschPhasesMap[p.name] = phase;

    const isBsp = p.name === 'BSP & power-on';
    
    if (isBsp) {
      await prisma.phaseState.create({
        data: {
          phaseId: phase.id,
          status: 'Active WIP',
          hillChartProgress: 50,
          theNeedle: 'Low',
          isStagnant: false,
          timestamp: new Date('2026-04-01')
        }
      });
    }
    
    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: isBsp ? 'Finished' : (p.name === 'VHAL Integration' ? 'Active WIP' : 'Not Started'),
        hillChartProgress: isBsp ? 100 : (p.name === 'VHAL Integration' ? 60 : 0),
        theNeedle: isBsp ? 'Low' : (p.name === 'VHAL Integration' ? 'High' : 'Low'),
        isStagnant: false,
        notes: p.name === 'VHAL Integration' ? 'Telemetry calibration failures reported.' : null,
        source: p.name === 'VHAL Integration' ? 'Buganizer' : null,
        sourceUrl: p.name === 'VHAL Integration' ? 'https://buganizer.corp.google.com/issues/9987211' : null,
        timestamp: isBsp ? new Date('2026-05-01') : new Date('2026-05-05')
      }
    });
  }

  // Dependencies for Bosch
  for (const p of TEMPLATES.AAOS.phases) {
    const phase = boschPhasesMap[p.name];
    for (const depName of p.dependsOn) {
      const depPhase = boschPhasesMap[depName];
      await prisma.phaseDependency.create({
        data: {
          phaseId: phase.id,
          dependsOnPhaseId: depPhase.id
        }
      });
    }
  }

  // Action Items for Bosch
  const boschAppPhase = boschPhasesMap['VHAL Integration'];
  await prisma.actionItem.create({
    data: {
      phaseId: boschAppPhase.id,
      description: 'Resolve CAN bus telemetry frame drop issues',
      assignedTo: '@ Dieter Meyer',
      assignedToPersonId: dieter.id,
      status: 'Pending',
      nextStep: 'Partner',
      linkUrl: 'https://buganizer.corp.google.com/issues/9987211',
      source: 'Buganizer',
      sourceUrl: 'https://buganizer.corp.google.com/issues/9987211'
    }
  });


  // 4. Qualcomm Snapdragon Support (SA8295P cockpit)
  const qualcommProject = await prisma.project.create({
    data: {
      name: 'Qualcomm Snapdragon Cockpit Support',
      partnerId: qualcomm.id,
      ownerName: 'Dylan PM',
      sopDate: new Date('2026-08-30'),
      volumeFirstYear: 500000,
      theNeedle: 'Critical', // Critical Risk
      hillChartProgress: 85
    }
  });

  // Project state logs for Qualcomm Snapdragon
  await prisma.projectState.create({
    data: {
      projectId: qualcommProject.id,
      theNeedle: 'Medium', // Medium
      hillChartProgress: 75,
      notes: 'Driver ports in progress, validation suite running.',
      source: 'Gerrit',
      sourceUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/99812',
      timestamp: new Date('2026-06-01')
    }
  });

  await prisma.projectState.create({
    data: {
      projectId: qualcommProject.id,
      theNeedle: 'Critical', // Critical
      hillChartProgress: 85,
      notes: 'Audio driver deadlock causes complete system freeze on cold boot.',
      source: 'Google Chat',
      sourceUrl: 'https://chat.google.com/room/qcom-audio-deadlocks',
      timestamp: new Date('2026-06-27')
    }
  });

  const qualcommPhasesMap: Record<string, SeedPhase> = {};
  for (const p of TEMPLATES.AAOS.phases) {
    const phase = await prisma.phase.create({
      data: {
        name: p.name,
        projectId: qualcommProject.id,
        forecastedDuration: p.forecastedDuration
      }
    });
    qualcommPhasesMap[p.name] = phase;

    const isApp = p.name === 'Audio HAL';
    
    if (isApp) {
      await prisma.phaseState.create({
        data: {
          phaseId: phase.id,
          status: 'Active WIP',
          hillChartProgress: 50,
          theNeedle: 'Low',
          isStagnant: false,
          timestamp: new Date('2026-04-15')
        }
      });
    }

    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: isApp ? 'Active WIP' : 'Finished',
        hillChartProgress: isApp ? 85 : 100,
        theNeedle: isApp ? 'Critical' : 'Low',
        isStagnant: false,
        notes: isApp ? 'Audio driver cold boot freeze deadlock.' : null,
        source: isApp ? 'Google Chat' : null,
        sourceUrl: isApp ? 'https://chat.google.com/room/qcom-audio-deadlocks' : null,
        timestamp: isApp ? new Date('2026-06-27') : new Date('2026-03-01')
      }
    });
  }

  // Dependencies for Qualcomm
  for (const p of TEMPLATES.AAOS.phases) {
    const phase = qualcommPhasesMap[p.name];
    for (const depName of p.dependsOn) {
      const depPhase = qualcommPhasesMap[depName];
      await prisma.phaseDependency.create({
        data: {
          phaseId: phase.id,
          dependsOnPhaseId: depPhase.id
        }
      });
    }
  }

  // Action Items for Qualcomm
  const qcomAppPhase = qualcommPhasesMap['Audio HAL'];
  await prisma.actionItem.create({
    data: {
      phaseId: qcomAppPhase.id,
      description: 'Debug audio HAL cold boot freeze issue',
      assignedTo: '@ Sarah Jenkins',
      assignedToPersonId: sarah.id,
      status: 'Pending',
      nextStep: 'Partner',
      linkUrl: 'https://chat.google.com/room/qcom-audio-deadlocks',
      source: 'Google Chat',
      sourceUrl: 'https://chat.google.com/room/qcom-audio-deadlocks'
    }
  });

  await prisma.actionItem.create({
    data: {
      phaseId: qcomAppPhase.id,
      description: 'Review Snapdragon SA8295 firmware registry patches',
      assignedTo: '@dylan',
      assignedToPersonId: dylan.id,
      status: 'Pending',
      nextStep: 'Googler',
      linkUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/99812',
      source: 'Gerrit',
      sourceUrl: 'https://android-review.googlesource.com/c/platform/hardware/qcom/+/99812'
    }
  });

  // Seed Context URLs for vector searches
  console.log('Seeding Context URLs for vector search mapping...');
  await ingestRecord(
    fordProject.id,
    'https://chat.google.com/room/ford-evos-dev-talk',
    'Chat',
    'Ford Evos AAOS Development Chat',
    'Ford Evos AAOS Bring-up project updates on VHAL sensor inputs and cluster panel configurations. We are diagnosing BSP power-on latencies and telemetry drops on cold boot.'
  );

  await ingestRecord(
    toyotaProject.id,
    'https://docs.google.com/document/d/toyota-digital-key-threat-model',
    'Doc',
    'Toyota Highlander Digital Key Threat Model',
    'Toyota Highlander Digital Key threat modeling document. Details cryptographic key exchanges, NFC antenna protocols on the e-TNGA chassis, and companion app verification procedures.'
  );

  await ingestRecord(
    boschProject.id,
    'https://buganizer.corp.google.com/issues/9987211',
    'Chat', // mock category
    'Bosch Explorer VHAL Telemetry Bug',
    'Bosch Explorer VHAL frame drops on telemetry unit. Dieter Meyer noted that telemetry drops occur when ADAS sensor calibrations start during active ignition sequences.'
  );

  await ingestRecord(
    qualcommProject.id,
    'https://chat.google.com/room/qcom-audio-deadlocks',
    'Chat',
    'Qualcomm Snapdragon Audio Drivers chat',
    'Snapdragon audio HAL driver deadlocks during system start. Cold boot freezes are caused by priority inversion in thread scheduling for hardware outputs.'
  );

  console.log('Seeding completed successfully!');
}
