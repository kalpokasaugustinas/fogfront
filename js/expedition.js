// expedition: roguelite run that zooms out stage by stage (valley -> region -> country -> continent -> world).
// winning a stage collapses everything you hold into one capital on the next, bigger map:
//   - all your people come along (capital starts full, the rest is a reserve that flows in)
//   - buildings carry over as capital bonuses: effect x share of your segments that had it
//     (4 farms out of 10 segments -> +60% x 40% = +24% growth); the old capital's bonuses
//     count as 1 segment, so they dilute unless you build again
//   - pick 1 of 3 perks
// bots scale with you: base troops + 70% of your carried people, and capitals with the same
// total bonus strength in a random mix. losing a stage ends the run.
import { effects } from './config.js?v=19';
import { personalities } from './ai.js?v=19';
import { rng } from './mapgen.js?v=19';

export const stages = [
  { name: 'Valley', detail: 1, area: '5 km²', cells: 12, bots: 1, shape: 'random', neutral: [0.12, 0.3] },
  { name: 'Region', detail: 0.75, area: '800 km²', cells: 16, bots: 2, shape: 'random', neutral: [0.18, 0.38] },
  { name: 'Country', detail: 0.55, area: '90,000 km²', cells: 20, bots: 3, shape: 'random', neutral: [0.24, 0.46] },
  { name: 'Continent', detail: 0.42, area: '10 million km²', cells: 26, bots: 3, shape: 'world', neutral: [0.3, 0.55] },
  { name: 'World', detail: 0.32, area: '510 million km²', cells: 34, bots: 4, shape: 'world', neutral: [0.36, 0.64] },
];

export const botCarry = 0.7;   // share of the player's carried people each bot starts with

// perks: mods are multipliers unless noted (capitalDef, loot are added; fort replaces x1.5)
export const perks = [
  { id: 'march', icon: '🥾', name: 'Forced march', desc: 'Your armies move 30% faster', mods: { speed: 1.3 } },
  { id: 'veterans', icon: '🎖️', name: 'Veterans', desc: 'Your armies attack +20%', mods: { atk: 1.2 } },
  { id: 'granary', icon: '🌾', name: 'Granary', desc: 'Farms +50% stronger', mods: { farm: 1.5 } },
  { id: 'healers', icon: '➕', name: 'Healers', desc: 'Hospitals +50% stronger', mods: { hospital: 1.5 } },
  { id: 'scholars', icon: '🔬', name: 'Scholars', desc: 'Labs +50% stronger', mods: { lab: 1.5 } },
  { id: 'fertile', icon: '🌱', name: 'Fertile land', desc: '+12% growth everywhere', mods: { growth: 1.12 } },
  { id: 'engineers', icon: '🛠️', name: 'Engineers', desc: 'Buildings cost 30% less', mods: { cost: 0.7 } },
  { id: 'conscription', icon: '📜', name: 'Conscription', desc: 'Neutral segments defend at half strength against you', mods: { neutralDef: 0.5 } },
  { id: 'walls', icon: '🧱', name: 'Great walls', desc: 'Your capital defends +60%', mods: { capitalDef: 0.6 } },
  { id: 'recruiters', icon: '📯', name: 'Recruiters', desc: 'Your reserve flows into the capital 2x faster', mods: { reserve: 2 } },
  { id: 'plunder', icon: '💰', name: 'Plunder', desc: 'Taking an enemy segment adds 15% of its cap as troops', mods: { loot: 0.15 } },
  { id: 'masons', icon: '🛡️', name: 'Stonemasons', desc: 'Forts defend x1.8 instead of x1.5', mods: { fort: 1.8 } },
];

const best_key = 'frontlines.expedition.best';

export class Expedition {
  constructor(seed) {
    this.seed = seed;
    this.rand = rng(seed);
    this.stage = 0;
    this.perks = [];
    this.capital = null;   // { troops, bonus } carried into the next stage
    this.time = 0;         // total battle time
  }

  get current() { return stages[this.stage]; }
  done() { return this.stage >= stages.length; }

  // combined perk modifiers
  mods() {
    const m = {};
    for (const id of this.perks) {
      for (const [k, v] of Object.entries(perks.find((p) => p.id === id).mods)) {
        if (k === 'capitalDef' || k === 'loot') m[k] = (m[k] ?? 0) + v;
        else if (k === 'fort') m[k] = Math.max(m[k] ?? 0, v);
        else m[k] = (m[k] ?? 1) * v;
      }
    }
    return m;
  }

  // battle setup for the current stage
  setup() {
    const st = this.current, r = rng(this.seed + this.stage * 7919);
    const types = Object.keys(personalities), themes = ['summer', 'autumn', 'winter', 'moor'];
    const carried = this.capital?.troops ?? 0;
    const bots = [1, 2, 3, 4].slice(0, st.bots).map((color) => ({
      ai: true, color, think: Math.max(1.8, 3.2 - this.stage * 0.3),
      personality: personalities[types[Math.floor(r() * types.length)]],
      // from stage 2 on, bots get capitals scaled to the player
      capital: this.capital ? { troops: 10 + carried * botCarry, bonus: shuffleBonus(this.capital.bonus, r) } : undefined,
    }));
    return {
      seed: Math.floor(r() * 1e9),
      cells: st.cells,
      shape: st.shape,
      theme: themes[Math.floor(r() * themes.length)],
      neutral: st.neutral,
      detail: st.detail,
      stamp: this.shape,   // previous island outline -> shape of the new capital
      factions: [{ ai: false, color: 0, mods: this.mods(), capital: this.capital ?? undefined }, ...bots],
    };
  }

  // stage won: collapse the player's holdings into the next capital. returns a summary for the ui
  collapse(battle) {
    this.time += battle.time;
    const mine = battle.segs.filter((s) => s.owner === 0), n = Math.max(1, mine.length);
    const count = (type) => mine.filter((s) => s.building === type).length;
    const old = mine.filter((s) => s.capital).map((s) => s.bonus);
    const oldSum = (k) => old.reduce((v, b) => v + b[k], 0) / n;   // old capitals dilute: each is 1 of n
    const m = this.mods();
    const farms = count('farm'), hosp = count('hospital'), labs = count('lab'), forts = count('fort'), barracks = count('barracks');
    const bonus = {
      growth: effects.farmGrowth * (m.farm ?? 1) * (farms / n) + oldSum('growth'),
      hosp: effects.hospitalGrowth * (m.hospital ?? 1) * (hosp / n) + oldSum('hosp'),
      lab: effects.labGrowth * (m.lab ?? 1) * labs * (labs / n) + oldSum('lab'),
      def: ((m.fort ?? effects.fortDefense) - 1) * (forts / n) + oldSum('def'),
      atk: (effects.barracksAttack - 1) * (barracks / n) + oldSum('atk'),
    };
    const troops = Math.round(mine.reduce((v, s) => v + s.troops, 0)
      + battle.armies.filter((a) => a.owner === 0).reduce((v, a) => v + a.n, 0) + battle.factions[0].reserve);
    this.capital = { troops, bonus };
    // the island's outline (land, mountains, lakes), downsampled to 64 x 64, becomes the next capital's shape
    const g = battle.map.grid, N = 64, data = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = Math.floor(((y + 0.5) / N) * g) * g + Math.floor(((x + 0.5) / N) * g);
      data[y * N + x] = battle.map.ids[c] >= 0 || battle.map.terrain[c] ? 1 : 0;
    }
    this.shape = { n: N, data: cropShape(data, N) };
    this.stage++;
    return { segments: mine.length, farms, hosp, labs, forts, barracks, troops, bonus };
  }

  // 3 perks the player doesn't have yet
  choices() {
    const pool = perks.filter((p) => !this.perks.includes(p.id));
    const out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    return out;
  }

  // best run so far (stage reached, then total time)
  static best() {
    try { return JSON.parse(localStorage.getItem(best_key)); } catch { return null; }
  }

  saveBest(reached) {
    const b = Expedition.best(), cur = { stage: reached, time: Math.round(this.time) };
    if (!b || reached > b.stage || (reached === b.stage && cur.time < b.time)) {
      try { localStorage.setItem(best_key, JSON.stringify(cur)); } catch { /* storage blocked */ }
      return true;
    }
    return false;
  }
}

// crop an n x n outline to its bounding box and scale it back to n x n, so the stamp fills its square
function cropShape(d, n) {
  let x0 = n, y0 = n, x1 = -1, y1 = -1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (d[y * n + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return d;
  const w = Math.max(x1 - x0 + 1, y1 - y0 + 1), out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sx = x0 + Math.floor(((x + 0.5) / n) * w), sy = y0 + Math.floor(((y + 0.5) / n) * w);
    out[y * n + x] = sx < n && sy < n ? d[sy * n + sx] : 0;
  }
  return out;
}

// same total bonus strength, values shuffled between types (bots get a different mix)
function shuffleBonus(bonus, r) {
  const keys = Object.keys(bonus), vals = keys.map((k) => bonus[k]);
  for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
}
