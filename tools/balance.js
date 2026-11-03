// balance harness: bot-vs-bot 1v1 matches run headless in the browser (tools/balance.py drives it).
// side 0 is the "variant" (a building rule, a perk, other prices), side 1 the normal bot; a variant
// that wins more than half its games is stronger than the normal mix.
// the game modules are imported with the same ?v= stamp the game uses, so config edits made here
// (prices, effects) reach battle.js and ai.js (a different ?v would load a second, separate copy)
const src = await (await fetch(new URL('../js/battle.js', import.meta.url))).text();
const v = src.match(/config\.js\?v=(\d+)/)?.[1] ?? '';
const q = v ? `?v=${v}` : '';
const { Battle } = await import(`../js/battle.js${q}`);
const { generateMap } = await import(`../js/mapgen.js${q}`);
const { personalities } = await import(`../js/ai.js${q}`);
const config = await import(`../js/config.js${q}`);
const { perks } = await import(`../js/expedition.js${q}`);

const pool = [];   // generated maps (battles reshape the start tiles, so every match gets a copy)

// build n maps of the given size (same seeds on every page, so all pages play the same maps)
export function makePool(n, cells, seed0 = 9000) {
  pool.length = 0;
  for (let i = 0; i < n; i++) pool.push(generateMap({ seed: seed0 + i * 31, cells, grid: config.rules.grid, shape: 'random', obstacles: true }));
  return pool.map((m) => m.segs.length);
}

// typical tile numbers of the pool, for the price-vs-impact table: tile caps (largest = capMax)
// and how much cap sits next to a tile
export function poolStats() {
  const caps = [], adjCap = [], adjN = [];
  for (const m of pool) {
    const max = Math.max(...m.segs.map((s) => s.area));
    const cap = m.segs.map((s) => Math.round((config.rules.capMax * s.area) / max / 5) * 5);
    m.segs.forEach((s, i) => { caps.push(cap[i]); adjN.push(s.adj.length); adjCap.push(s.adj.reduce((v, a) => v + cap[a], 0)); });
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { tiles: caps.length, capMedian: med(caps), capAvg: Math.round(avg(caps)), adjN: +avg(adjN).toFixed(2), adjCapMedian: med(adjCap) };
}

// apply { buildings: { farm: { cost } }, effects: {...}, rules: {...} } to the live config; returns undo
function override(o = {}) {
  const undo = [];
  const set = (obj, k, val) => { undo.push([obj, k, obj[k]]); obj[k] = val; };
  for (const [k, val] of Object.entries(o.buildings ?? {})) for (const [f, x] of Object.entries(val)) set(config.buildings[k], f, x);
  for (const [k, val] of Object.entries(o.effects ?? {})) set(config.effects, k, val);
  for (const [k, val] of Object.entries(o.rules ?? {})) set(config.rules, k, val);
  return () => { for (const [obj, k, val] of undo.reverse()) obj[k] = val; };
}

// one match. side = { pers: 'builder', allow?: [...], perk?: 'march' }; capital = troops each side
// starts with in a capital (conquest-like stage 2+, with camps), 0 = plain skirmish start
function match(mapIdx, seed, sides, capital, limit) {
  const map = structuredClone(pool[mapIdx]);
  const factions = sides.map((sd, i) => ({
    ai: true, color: i, think: 2.5,
    personality: { ...personalities[sd.pers], ...(sd.allow ? { allow: sd.allow } : {}) },
    mods: sd.perk ? { ...perks.find((p) => p.id === sd.perk).mods } : {},
    capital: capital ? { troops: capital, bonus: {} } : undefined,
  }));
  const opts = { seed, factions, neutral: [0.15, 0.35] };
  if (capital) opts.camps = { mult: Math.min(4, Math.max(1, Math.sqrt(capital / 150))), share: 0.3, boost: 1.5 };
  if (capital) opts.relics = 0;   // relic perks would blur a perk test
  const b = new Battle(map, opts);
  b.simulate(limit);
  // winner: the side left standing; on a timeout, the side holding more cap
  let win = b.state === 'won' ? 0 : b.state === 'lost' ? 1 : -1;
  const held = [0, 1].map((f) => b.segs.filter((s) => s.owner === f).reduce((v, s) => v + s.cap, 0));
  if (win < 0) win = held[0] > held[1] * 1.1 ? 0 : held[1] > held[0] * 1.1 ? 1 : 0.5;
  const built = [0, 1].map((f) => {
    const out = {};
    for (const s of b.segs) if (s.owner === f && s.building && s.building !== 'capital') out[s.building] = (out[s.building] ?? 0) + 1;
    return out;
  });
  return { win, time: Math.round(b.time), timeout: b.state === 'running', built };
}

// a batch: the variant plays every map x each personality (mirror match) x seeds against the normal bot.
// variant = { label, allow?, perk?, overrides?, capital? }. returns win share of the variant
export function run(variant, { pers = ['aggressive', 'builder', 'turtle'], seeds = 2, limit = 900 } = {}) {
  const undo = override(variant.overrides);
  const res = { label: variant.label, games: 0, score: 0, timeouts: 0, time: 0, built: {} };
  try {
    for (let m = 0; m < pool.length; m++) for (const p of pers) for (let s = 0; s < seeds; s++) for (const flip of [false, true]) {
      const seed = 1000 + m * 17 + s * 7919;
      // each game is played both ways round (variant as faction 0, then 1): faction 0 has a clear
      // first-mover edge between equal bots, and the pairing cancels it
      const me = { pers: p, allow: variant.allow, perk: variant.perk }, sides = flip ? [{ pers: p }, me] : [me, { pers: p }];
      const r = match(m, seed, sides, variant.capital ?? 0, limit);
      const w = r.win === 0.5 ? 0.5 : (r.win === (flip ? 1 : 0) ? 1 : 0);
      res.games++; res.score += w;
      res.timeouts += r.timeout ? 1 : 0; res.time += r.time;
      for (const [k, n] of Object.entries(r.built[flip ? 1 : 0])) res.built[k] = (res.built[k] ?? 0) + n;
    }
  } finally { undo(); }
  return res;
}
