const port = process.env.PORT || 3000;
const host = `http://localhost:${port}`;

async function api(path, data = null) {
  const url = `${host}${path}`;
  const options = {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  if (data) {
    options.body = JSON.stringify(data);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed call to ${path}: ${res.status} - ${txt}`);
  }
  return res.json();
}

async function run() {
  console.log('Seeding mock data via REST APIs...');
  
  // 1. Create Partners (OEMs and Suppliers)
  const oemNames = [
    { name: 'Rivian', region: 'AMER' },
    { name: 'BMW Group', region: 'EMEA' },
    { name: 'Honda', region: 'APAC' },
    { name: 'General Motors', region: 'AMER' },
    { name: 'Hyundai Motor', region: 'APAC' },
    { name: 'Tesla Motors', region: 'AMER' },
    { name: 'Volvo Cars', region: 'EMEA' },
    { name: 'Polestar', region: 'EMEA' },
    { name: 'Porsche AG', region: 'EMEA' },
    { name: 'Audi AG', region: 'EMEA' }
  ];

  const supplierNames = [
    { name: 'Qualcomm Technologies', region: 'AMER' },
    { name: 'Bosch Mobility', region: 'EMEA' },
    { name: 'Continental AG', region: 'EMEA' },
    { name: 'Harman International', region: 'AMER' },
    { name: 'LG Electronics', region: 'APAC' },
    { name: 'Denso Corp', region: 'APAC' },
    { name: 'Valeo', region: 'EMEA' },
    { name: 'Aptiv Services', region: 'AMER' },
    { name: 'Hyundai Mobis', region: 'APAC' },
    { name: 'Pioneer Corporation', region: 'APAC' }
  ];

  const partners = [];

  for (const p of oemNames) {
    const ret = await api('/api/partners', { name: p.name, type: 'OEM', region: p.region });
    partners.push(ret.partner);
    console.log(`Created OEM: ${ret.partner.name} (${ret.partner.id})`);
  }

  for (const p of supplierNames) {
    const ret = await api('/api/partners', { name: p.name, type: 'Supplier', region: p.region });
    partners.push(ret.partner);
    console.log(`Created Supplier: ${ret.partner.name} (${ret.partner.id})`);
  }

  // 2. Create People
  const authors = [
    { name: 'Dylan', email: 'dylan@google.com' },
    { name: 'Sarah Miller', email: 'smiller@google.com' },
    { name: 'John Doe', email: 'jdoe@google.com' },
    { name: 'Alice Chen', email: 'achen@google.com' },
    { name: 'Bob Smith', email: 'bsmith@google.com' }
  ];

  const people = [];
  const googlePartner = partners.find(p => p.name === 'Qualcomm Technologies') || partners[0];

  for (const auth of authors) {
    const ret = await api('/api/people', {
      name: auth.name,
      email: auth.email,
      currentPartnerId: googlePartner.id,
      notes: 'Developer accountable for integrations'
    });
    people.push(ret.person);
    console.log(`Created Person: ${ret.person.name} (${ret.person.id})`);
  }

  // 3. Create 50 Projects across partners
  const projectTemplates = [
    'AAOS Integration',
    'GAS Services Bundle',
    'Digital Key Standard',
    'VHAL Core implementation',
    'BSP Linux kernel support',
    'Instrument Cluster interface',
    'HeadUnit customization',
    'EV Battery Management screen',
    'Adas safety integration',
    'Connectivity Module'
  ];

  const riskPool = ['Low', 'Medium', 'High', 'Critical'];
  const today = new Date();

  let projectCount = 0;
  for (let i = 0; i < 50; i++) {
    const oem = partners[i % oemNames.length]; // Cycle OEMs
    const templateName = projectTemplates[i % projectTemplates.length];
    const projectName = `${templateName} - ${oem.name}`;
    const owner = authors[i % authors.length].email;

    // Anchor SOP target date around today
    const sopDate = new Date(today);
    sopDate.setDate(today.getDate() + 90 + (i * 5));

    const ret = await api('/api/projects', {
      name: projectName,
      partnerId: oem.id,
      ownerName: owner,
      sopDate: sopDate.toISOString(),
      volumeFirstYear: 50000 + (i * 12300)
    });

    const project = ret.project;
    projectCount++;
    console.log(`Created Project [${projectCount}/50]: ${project.name} (${project.id})`);

    // Create 3 phases for each project
    const phaseNames = ['Requirement Kickoff', 'Active BSP Bring-up', 'CTS Certification'];
    for (let pidx = 0; pidx < phaseNames.length; pidx++) {
      const phRet = await api(`/api/projects/${project.id}/phases`, {
        name: phaseNames[pidx],
        forecastedDuration: 20 + (pidx * 10)
      });
      const phase = phRet.phase;

      // Log phase states (CTS Certification has Active WIP status for some projects,Finished for others)
      let phaseStatus = 'Not Started';
      if (pidx === 0) phaseStatus = 'Finished';
      else if (pidx === 1) phaseStatus = 'Active WIP';

      const progressVal = pidx === 0 ? 100 : (pidx === 1 ? 40 + (i % 5) * 10 : 0);
      const needleRisk = riskPool[(i + pidx) % riskPool.length];

      await api(`/api/projects/${project.id}/phases/${phase.id}/state`, {
        status: phaseStatus,
        theNeedle: needleRisk,
        hillChartProgress: progressVal,
        notes: `Phase transition logs for ${phase.name}`,
        source: owner
      });

      // Add one warning action item
      await api(`/api/projects/${project.id}/phases/${phase.id}/action-items`, {
        description: `Resolve build errors in ${phase.name} dependency libraries`,
        assignedTo: owner,
        status: 'Pending',
        nextStep: 'Googler',
        linkUrl: 'https://buganizer.corp.google.com/issues/998127312'
      });
    }

    // Set overall project needle and progress
    const overallRisk = riskPool[i % riskPool.length];
    const overallProgress = 30 + (i % 6) * 10;
    
    await api(`/api/projects/${project.id}/needle`, {
      theNeedle: overallRisk,
      hillChartProgress: overallProgress,
      notes: `TEL milestone status logs for ${projectName}`,
      source: owner
    });
  }

  console.log('Programmatic API seeding completed successfully!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
