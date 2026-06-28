export const TEMPLATES = {
  AAOS: {
    phases: [
      { name: 'BSP & power-on', dependsOn: [], forecastedDuration: 14 },
      { name: 'VHAL Integration', dependsOn: ['BSP & power-on'], forecastedDuration: 30 },
      { name: 'Audio HAL', dependsOn: ['BSP & power-on'], forecastedDuration: 45 },
      { name: 'Car Service Integration', dependsOn: ['VHAL Integration'], forecastedDuration: 35 },
      { name: 'Compliance Testing', dependsOn: ['Car Service Integration'], forecastedDuration: 54 }
    ]
  },
  GAS: {
    phases: [
      { name: 'GMS Core Integration', dependsOn: [], forecastedDuration: 21 },
      { name: 'Play Store configuration', dependsOn: [], forecastedDuration: 15 },
      { name: 'GAS Compliance', dependsOn: ['GMS Core Integration', 'Play Store configuration'], forecastedDuration: 40 }
    ]
  },
  'Digital Key': {
    phases: [
      { name: 'NFC Driver bring-up', dependsOn: [], forecastedDuration: 15 },
      { name: 'Secure Element configuration', dependsOn: [], forecastedDuration: 25 },
      { name: 'CCC Spec Compliance', dependsOn: ['NFC Driver bring-up', 'Secure Element configuration'], forecastedDuration: 45 }
    ]
  }
};
