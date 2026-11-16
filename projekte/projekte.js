// Liste aller Projekte. Aus ihr entstehen die Karten auf der Startseite
// und der Link "Nächstes Projekt" auf jeder Projektseite.
//
// Neues Projekt hinzufügen:
//   1. Ordner projekte/_vorlage kopieren und umbenennen (z.B. projekte/mein-projekt)
//   2. Texte und Medien in der neuen index.html eintragen
//   3. Hier unten einen Eintrag ergänzen (slug = Ordnername)
window.PROJEKTE = [
  {
    slug: 'tsp-road-solver',
    titel: 'TSP Road Solver',
    farbe: '#2f5bff',
    slogan: {
      de: 'Kürzeste Route über echte Straßen, in Millisekunden.',
      en: 'The shortest route over real streets, in milliseconds.'
    },
    zahl: {
      wert: { de: '0,26 s', en: '0.26 s' },
      text: { de: 'für eine Route über 200 Ziele', en: 'for a route across 200 stops' }
    },
    tags: ['Reinforcement Learning', 'OpenStreetMap', 'Attention'],
    vorschau: null // null = animiertes Straßennetz statt Video
  },
  {
    slug: 'droptour',
    titel: 'DropTour',
    farbe: '#f2600c',
    slogan: {
      de: 'Nicht jedes Haus anfahren: Abholpunkte, die jeden Tag woanders stehen.',
      en: 'Skip the doorstep: pickup points that move every single day.'
    },
    zahl: {
      wert: { de: '18 Dörfer', en: '18 villages' },
      text: { de: 'und 60 selbstfahrende Paketbusse', en: 'and 60 self-driving parcel buses' }
    },
    tags: ['Logistik', 'OpenStreetMap', 'RL + Optimierung'],
    vorschau: { video: 'media/vorschau.mp4', poster: 'media/vorschau.webp' }
  },
  {
    slug: 'couch-movers',
    titel: 'Couch Movers',
    farbe: '#0f9d63',
    slogan: {
      de: 'Zwei Agenten, ein Sofa, und Türen, die zu schmal sind.',
      en: 'Two agents, one sofa, and doors that are too narrow.'
    },
    zahl: {
      wert: { de: '78,1 %', en: '78.1%' },
      text: { de: 'Erfolg in nie gesehenen Wohnungen', en: 'success in apartments never seen before' }
    },
    tags: ['Multi-Agent RL', 'MuJoCo', 'JAX'],
    vorschau: { video: 'media/vorschau.mp4', poster: 'media/raster.webp' }
  },
  {
    slug: 'omninav',
    titel: 'OmniNav',
    farbe: '#8b3dff',
    slogan: {
      de: 'Ein Transformer, der auf die ganze Karte schaut.',
      en: 'A transformer that looks at the whole map.'
    },
    zahl: {
      wert: { de: '4,75 Mio.', en: '4.75M' },
      text: { de: 'Parameter, kein Planer, kein A*', en: 'parameters, no planner, no A*' }
    },
    tags: ['Transformer', 'Navigation', 'PPO'],
    vorschau: { video: 'media/vorschau.mp4', poster: 'media/episoden.webp' }
  }
];
