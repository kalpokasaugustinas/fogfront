// battle simulation: segments, troops, buildings, armies. no drawing here,
// so the same code runs in the browser and in headless tests.
import { rules, buildings, effects } from './config.js?v=18';
import { rng, spreadStarts } from './mapgen.js?v=18';
import { think } from './ai.js?v=18';

const round1 = (v) => Math.round(v * 10) / 10;

export class Battle {
  // map: from generateMap. opts: { seed, factions: [...], neutral: [min, max] share of each tile's cap }
  // faction: { ai, personality, think, mods?, capital? }
  //   mods    = perk modifiers (expedition): speed, atk, farm, hospital, lab, growth, cost, fort,
  //             neutralDef, capitalDef, reserve, loot (see expedition.js)
  //   capital = { troops, bonus }: the faction starts in a capital (no building allowed there) that
  //             holds up to capMax troops; the rest is a reserve that flows in over time.
  //             bonus = { growth, hosp, lab, def, atk } carried over from the previous stage
  constructor(map, opts) {
    this.map = map;
    this.rand = rng(opts.seed ?? 1);
    this.factions = opts.factions.map((f, id) => ({ id, mods: {}, reserve: 0, capitalSeg: -1, ...f, timer: 1 + this.rand() * 2 }));
    this.time = 0;
    this.version = 0;          // bumps on ownership/building change (renderer repaints the map)
    this.state = 'running';    // running | won | lost
    this.armies = [];
    this.stats = { sent: 0, captured: 0, built: 0 };
    // auto-send routes: source segment id -> { to, keep }; keep = fraction of the source cap held back
    this.routes = new Map();
    this.routeTimer = rules.routeEvery;

    // segments: cap from size (largest = capMax), growth = growthRate x cap,
    // neutral garrison = a random share of the cap (bigger tiles hold more)
    const [nmin, nmax] = opts.neutral ?? [0.15, 0.35];
    const maxArea = Math.max(...map.segs.map((s) => s.area));
    this.segs = map.segs.map((s) => {
      const cap = Math.round((rules.capMax * s.area) / maxArea / 5) * 5;
      const garrison = Math.round(cap * (nmin + this.rand() * (nmax - nmin)));
      return { ...s, owner: -1, troops: garrison, garrison, cap, baseGrowth: round1(cap * rules.growthRate), building: null };
    });
    // expedition: the player's capital is the stamped segment (previous island's shape)
    const first = this.factions[0].capital && map.stampSeg >= 0 ? map.stampSeg : -1;
    spreadStarts(map, this.factions.length, this.rand, first).forEach((sid, f) => {
      const s = this.segs[sid], fac = this.factions[f];
      s.owner = f;
      s.troops = rules.startTroops;
      if (fac.capital) {
        // capital: full at the start, the rest waits in the reserve
        s.capital = true;
        s.building = 'capital';
        s.cap = rules.capMax;
        s.baseGrowth = round1(s.cap * rules.growthRate);
        s.bonus = { growth: 0, hosp: 0, lab: 0, def: 0, atk: 0, ...fac.capital.bonus };
        s.troops = Math.min(s.cap, fac.capital.troops);
        fac.reserve = Math.max(0, fac.capital.troops - s.cap);
        fac.capitalSeg = sid;
      }
    });
    this.updateGrowth();
  }

  mods(f) { return f >= 0 ? this.factions[f].mods : {}; }

  // growth multiplier per segment: farm (own), hospitals (adjacent own), labs (whole faction),
  // capital bonuses (own growth, hospital-like aura, faction-wide lab part), perk modifiers
  updateGrowth() {
    const labBonus = this.factions.map((f) => {
      const labs = this.segs.filter((s) => s.owner === f.id && s.building === 'lab').length;
      const caps = this.segs.filter((s) => s.owner === f.id && s.capital).reduce((v, s) => v + s.bonus.lab, 0);
      return labs * effects.labGrowth * (f.mods.lab ?? 1) + caps;
    });
    for (const s of this.segs) {
      if (s.owner < 0) { s.growth = 0; continue; }
      const m = this.mods(s.owner);
      let mult = 1 + labBonus[s.owner];
      if (s.building === 'farm') mult += effects.farmGrowth * (m.farm ?? 1);
      if (s.capital) mult += s.bonus.growth;
      for (const a of s.adj) {
        const n = this.segs[a];
        if (n.owner !== s.owner) continue;
        if (n.building === 'hospital') mult += effects.hospitalGrowth * (m.hospital ?? 1);
        if (n.capital) mult += n.bonus.hosp;
      }
      s.growth = round1(s.baseGrowth * mult * (m.growth ?? 1));
    }
  }

  defMult(s) {
    const m = this.mods(s.owner);
    let d = s.building === 'fort' ? (m.fort ?? effects.fortDefense) : 1;
    if (s.capital) d += s.bonus.def + (m.capitalDef ?? 0);
    return d;
  }

  atkMult(s) {
    let a = s.building === 'barracks' ? effects.barracksAttack : 1;
    if (s.capital) a += s.bonus.atk;
    return a * (this.mods(s.owner).atk ?? 1);
  }

  // building price for faction f (perk: engineers)
  costOf(f, type) { return Math.round(buildings[type].cost * (this.mods(f).cost ?? 1)); }

  // faction f sends n troops from segment a to adjacent segment b
  send(f, a, b, n, auto = false) {
    const from = this.segs[a];
    n = Math.floor(Math.min(n, from.troops));
    if (this.state !== 'running' || from.owner !== f || !from.adj.includes(b) || n < 1) return false;
    from.troops -= n;
    const to = this.segs[b];
    const dur = Math.hypot(to.x - from.x, to.y - from.y) / (rules.armySpeed * (this.mods(f).speed ?? 1));
    // attacks stop near the border and fight there; moves to own tiles go all the way
    const stopAt = to.owner === f ? 1 : rules.fightAt;
    this.armies.push({ owner: f, n, atk: this.atkMult(from), from: a, to: b, t: 0, dur, stopAt, fight: null, done: false });
    if (f === 0 && !auto) this.stats.sent++;
    return true;
  }

  // faction f builds type in segment s, paid with troops from that segment
  build(f, sid, type) {
    const s = this.segs[sid], b = buildings[type];
    if (this.state !== 'running' || s.owner !== f || !b || s.capital || s.building === type) return false;
    const cost = this.costOf(f, type);
    if (s.troops < cost) return false;
    s.troops -= cost;
    s.building = type;
    this.version++;
    this.updateGrowth();
    if (f === 0) this.stats.built++;
    return true;
  }

  // defense multiplier of tile t against attacker f (perk: conscription weakens neutrals)
  fightDef(t, f) { return this.defMult(t) * (t.owner < 0 ? (this.mods(f).neutralDef ?? 1) : 1); }

  // army reached its stop point: reinforce an own tile, or start a fight at the border
  arrive(a) {
    const t = this.segs[a.to];
    if (t.owner === a.owner) {
      if (a.t < 1) { a.stopAt = 1; return; }   // became ours on the way: walk in
      t.troops += a.n;
      a.done = true;
      return;
    }
    // fight: both sides lose strength at the same rate k until one is gone, so the result equals
    // attack - defense like an instant fight, just spread over 1-3 s (bigger fights last longer)
    const A = a.n * a.atk, D = t.troops * this.fightDef(t, a.owner);
    const dur = Math.min(rules.fightMax, rules.fightMin + (rules.fightMax - rules.fightMin) * Math.min(1, Math.min(A, D) / rules.fightScale));
    a.fight = { k: Math.max(1, Math.min(A, D) / dur), time: 0 };
  }

  // one step of a running fight
  fightStep(a, dt) {
    const t = this.segs[a.to];
    if (t.owner === a.owner) { a.fight = null; a.stopAt = 1; return; }   // someone else took it for us: walk in
    a.fight.time += dt;
    const dm = this.fightDef(t, a.owner);
    const d = Math.min(a.fight.k * dt, a.n * a.atk, t.troops * dm);
    a.n -= d / a.atk;
    t.troops -= d / dm;
    if (t.troops <= 1e-6) {
      // defenders gone: capture with what's left of the army
      const prev = t.owner;
      t.owner = a.owner;
      t.troops = Math.max(0, a.n);
      // perk: plunder adds part of an enemy segment's cap when it's taken
      if (prev >= 0) t.troops += t.cap * (this.mods(a.owner).loot ?? 0);
      this.version++;
      this.updateGrowth();
      if (a.owner === 0) this.stats.captured++;
      a.done = true;
    } else if (a.n <= 1e-6) {
      a.done = true;   // attack beaten back
    }
  }

  alive(f) { return this.segs.some((s) => s.owner === f) || this.armies.some((a) => a.owner === f); }

  // faction f sets a standing route a -> b between two adjacent own segments
  setRoute(f, a, b, keep) {
    const s = this.segs[a], t = this.segs[b];
    if (s.owner !== f || t.owner !== f || !s.adj.includes(b)) return false;
    if (this.routes.get(b)?.to === a) this.routes.delete(b);   // no ping-pong between two segments
    this.routes.set(a, { to: b, keep });
    return true;
  }

  clearRoute(a) { this.routes.delete(a); }

  // forward everything above the reserve; drop routes whose segments changed owner
  runRoutes() {
    for (const [a, r] of this.routes) {
      const s = this.segs[a], t = this.segs[r.to];
      if (s.owner < 0 || s.owner !== t.owner) { this.routes.delete(a); continue; }
      const extra = s.troops - r.keep * s.cap;
      if (extra >= rules.routeMin) this.send(s.owner, a, r.to, extra, true);
    }
  }

  step(dt) {
    if (this.state !== 'running') return;
    this.time += dt;
    for (const s of this.segs) {
      if (s.owner < 0) {
        // neutrals regrow (same rate as owned tiles) but only back to their starting garrison
        if (s.troops < s.garrison) s.troops = Math.min(s.garrison, s.troops + s.baseGrowth * dt);
        continue;
      }
      if (s.troops < s.cap) s.troops = Math.min(s.cap, s.troops + s.growth * dt);
      else s.troops = Math.max(s.cap, s.troops - rules.overCapDecay * dt);
    }
    // reserves flow into each faction's capital while it has room (and is still theirs)
    for (const f of this.factions) {
      const s = this.segs[f.capitalSeg];
      if (!f.reserve || !s || s.owner !== f.id || s.troops >= s.cap) continue;
      const flow = Math.min(f.reserve, s.cap - s.troops, Math.max(5, f.reserve * 0.04) * (f.mods.reserve ?? 1) * dt);
      s.troops += flow;
      f.reserve -= flow;
    }
    for (const a of this.armies) {
      if (a.fight) { this.fightStep(a, dt); continue; }
      a.t = Math.min(a.stopAt, a.t + dt / a.dur);
      if (a.t >= a.stopAt) this.arrive(a);
    }
    this.armies = this.armies.filter((a) => !a.done);
    this.routeTimer -= dt;
    if (this.routeTimer <= 0) { this.routeTimer += rules.routeEvery; this.runRoutes(); }
    for (const f of this.factions) {
      if (!f.ai || !this.alive(f.id)) continue;
      f.timer -= dt;
      if (f.timer <= 0) {
        think(this, f);
        f.timer = f.think * (0.8 + this.rand() * 0.4);
      }
    }
    // end check: player gone = lost, every bot gone = won (neutral segments may remain)
    if (!this.alive(0)) this.state = 'lost';
    else if (this.factions.every((f) => f.id === 0 || !this.alive(f.id))) this.state = 'won';
  }

  // run the sim without drawing (tests, fast-forward)
  simulate(seconds) {
    for (let t = 0; t < seconds && this.state === 'running'; t += rules.step) this.step(rules.step);
    return this.state;
  }
}
