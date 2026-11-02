// all balance numbers live here, so tuning the game = editing this one file

export const rules = {
  grid: 480,          // battle map raster size (cells per side)
  step: 0.1,          // fixed simulation step in seconds
  armySpeed: 90,      // army travel speed in grid cells per second (scale with grid)
  startTroops: 25,    // troops in each faction's starting segment
  overCapDecay: 1,    // troops/s lost while a segment is above its cap
  routeEvery: 1,      // auto-send routes forward troops every N seconds
  routeMin: 5,        // ...when at least this many troops are above the route's reserve
  // cap scales with segment area: the largest segment on the map holds capMax
  capMax: 1000,
  // growth from size ratio (area / average area, clamped)
  growthBase: 1.47, growthPerSize: 2.45,  // avg segment: 3.9 troops/s
};

// one building per segment; building costs troops taken from that segment.
// a captured segment keeps its building (the new owner gets it).
export const buildings = {
  farm:     { name: 'Farm',     icon: '🌾', cost: 75,  desc: '+60% growth in this segment' },
  barracks: { name: 'Barracks', icon: '⚔️', cost: 100, desc: 'troops sent from here attack x1.5' },
  fort:     { name: 'Fort',     icon: '🛡️', cost: 100, desc: 'defenders here count x1.5' },
  hospital: { name: 'Hospital', icon: '➕', cost: 125, desc: '+50% growth in your adjacent segments' },
  lab:      { name: 'Lab',      icon: '🔬', cost: 150, desc: '+10% growth in all your segments' },
};

export const effects = {
  farmGrowth: 0.6,      // +60% own growth
  hospitalGrowth: 0.5,  // +50% per adjacent own hospital
  labGrowth: 0.1,       // +10% per lab owned, everywhere
  barracksAttack: 1.5,  // attack multiplier of armies sent from barracks
  fortDefense: 1.5,     // defense multiplier of fort segments
};

// faction colours: index 0 = player
export const factionColors = ['#2f74d6', '#d1403a', '#e09a1a', '#8b55c9', '#23966a'];
export const factionNames = ['You', 'Crimson', 'Amber', 'Violet', 'Jade'];
export const neutralColor = '#7d8580';

// island climates (picked per battle). colours are [r, g, b] except sea (css)
export const themes = {
  summer: {
    rockTop: [214, 210, 192], rockSide: [102, 106, 112], rockSideDark: [74, 78, 86], fogA: [236, 239, 237], fogB: [196, 205, 203],
    sea: '#9fb6b7', seaLight: [196, 214, 212], foam: [244, 249, 248], shadow: [52, 78, 84],
    groundA: [150, 172, 116], groundB: [184, 196, 140], shore: [222, 214, 176], scree: [150, 146, 126], lip: [232, 232, 210],
    cliffLight: [238, 236, 228], cliffDark: [190, 190, 182],
    rockDark: [118, 122, 116], rockLight: [182, 184, 176], cap: [246, 246, 242], capAt: 0.82,
    tree: 'round', trees: 1, treeDark: [62, 96, 70], treeLight: [96, 132, 92], lineNeutral: [70, 84, 64],
  },
  autumn: {
    rockTop: [228, 204, 182], rockSide: [86, 78, 92], rockSideDark: [62, 56, 70], fogA: [238, 233, 229], fogB: [204, 196, 194],
    sea: '#93aaa8', seaLight: [190, 206, 202], foam: [240, 244, 242], shadow: [48, 62, 70],
    groundA: [206, 140, 116], groundB: [226, 170, 140], shore: [232, 206, 176], scree: [132, 110, 112], lip: [240, 214, 192],
    cliffLight: [104, 94, 108], cliffDark: [72, 64, 78],
    rockDark: [84, 76, 90], rockLight: [132, 120, 134], cap: [214, 196, 186], capAt: 0.85,
    tree: 'pine', trees: 1.2, treeDark: [52, 40, 58], treeLight: [86, 66, 88], lineNeutral: [110, 70, 64],
  },
  winter: {
    rockTop: [242, 244, 247], rockSide: [72, 72, 82], rockSideDark: [52, 52, 62], fogA: [242, 244, 246], fogB: [208, 213, 218],
    sea: '#c4cbc8', seaLight: [222, 228, 226], foam: [252, 253, 253], shadow: [70, 80, 86],
    groundA: [226, 230, 234], groundB: [242, 244, 246], shore: [204, 214, 220], scree: [170, 172, 180], lip: [252, 252, 254],
    cliffLight: [84, 82, 92], cliffDark: [58, 56, 66],
    rockDark: [70, 70, 80], rockLight: [112, 112, 122], cap: [250, 250, 252], capAt: 0.7,
    tree: 'pine', trees: 0.9, treeDark: [64, 78, 76], treeLight: [96, 112, 108], treeSnow: [250, 251, 252], lineNeutral: [120, 128, 140],
  },
  moor: {
    rockTop: [226, 212, 172], rockSide: [72, 70, 86], rockSideDark: [52, 50, 66], fogA: [230, 232, 226], fogB: [190, 195, 189],
    sea: '#a2aca5', seaLight: [200, 208, 200], foam: [238, 242, 236], shadow: [50, 56, 60],
    groundA: [168, 170, 132], groundB: [190, 188, 148], shore: [210, 204, 170], scree: [118, 116, 112], lip: [214, 210, 180],
    cliffLight: [80, 78, 92], cliffDark: [56, 54, 66],
    rockDark: [66, 64, 78], rockLight: [96, 94, 108], cap: [214, 200, 156], capAt: 0.6,
    tree: 'round', trees: 1.3, treeDark: [84, 98, 74], treeLight: [116, 128, 96], lineNeutral: [84, 86, 64],
  },
};
export const themeNames = Object.keys(themes);
