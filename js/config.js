// all balance numbers live here, so tuning the game = editing this one file

export const rules = {
  grid: 240,          // battle map raster size (cells per side)
  step: 0.1,          // fixed simulation step in seconds
  armySpeed: 45,      // army travel speed in grid cells per second
  startTroops: 25,    // troops in each faction's starting segment
  overCapDecay: 1,    // troops/s lost while a segment is above its cap
  // segment size -> cap and growth (size ratio = area / average area, clamped)
  capBase: 20, capPerSize: 40,          // avg segment: cap 60
  growthBase: 0.3, growthPerSize: 0.5,  // avg segment: 0.8 troops/s
};

// one building per segment; building costs troops taken from that segment.
// a captured segment keeps its building (the new owner gets it).
export const buildings = {
  farm:     { name: 'Farm',     icon: '🌾', cost: 15, desc: '+100% growth in this segment' },
  barracks: { name: 'Barracks', icon: '⚔️', cost: 20, desc: 'troops sent from here attack x1.5' },
  fort:     { name: 'Fort',     icon: '🛡️', cost: 20, desc: 'defenders here count x1.5' },
  hospital: { name: 'Hospital', icon: '➕', cost: 25, desc: '+50% growth in your adjacent segments' },
  lab:      { name: 'Lab',      icon: '🔬', cost: 30, desc: '+10% growth in all your segments' },
};

export const effects = {
  farmGrowth: 1.0,      // +100% own growth
  hospitalGrowth: 0.5,  // +50% per adjacent own hospital
  labGrowth: 0.1,       // +10% per lab owned, everywhere
  barracksAttack: 1.5,  // attack multiplier of armies sent from barracks
  fortDefense: 1.5,     // defense multiplier of fort segments
};

// faction colours: index 0 = player
export const factionColors = ['#3b82f6', '#ef4444', '#f59e0b', '#a855f7', '#10b981'];
export const factionNames = ['You', 'Crimson', 'Amber', 'Violet', 'Jade'];
export const neutralColor = '#8b93a1';
