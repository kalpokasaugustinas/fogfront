// battle simulation: segments, troops, buildings, armies. no drawing here,
// so the same code runs in the browser and in headless tests.
import { rules, buildings, effects } from './config.js?v=10';
import { rng, spreadStarts } from './mapgen.js?v=10';
import { think } from './ai.js?v=10';

const round1 = (v) => Math.round(v * 10) / 10;

export class Battle {
  // map: from generateMap. opts: { seed, factions: [{ ai, personality, think }], neutral: [min, max] }
  constructor(map, opts) {
    this.map = map;
    this.rand = rng(opts.seed ?? 1);
    this.factions = opts.factions.map((f, id) => ({ id, ...f, timer: 1 + this.rand() * 2 }));
    this.time = 0;
    this.version = 0;          // bumps on ownership/building change (renderer repaints the map)
    this.state = 'running';    // running | won | lost
    this.armies = [];
    this.stats = { sent: 0, captured: 0, built: 0 };
    // auto-send routes: source segment id -> { to, keep }; keep = fraction of the source cap held back
    this.routes = new Map();
    this.routeTimer = rules.routeEvery;

    // segments: cap and base growth come from the segment's size
    const [nmin, nmax] = opts.neutral ?? [40, 150];
    const maxArea = Math.max(...map.segs.map((s) => s.area));
    this.segs = map.segs.map((s) => {
      const size = Math.min(2, Math.max(0.4, s.area / map.avgArea));
      return {
        ...s,
        owner: -1,
        troops: Math.round(nmin + this.rand() * (nmax - nmin)),
        cap: Math.round((rules.capMax * s.area) / maxArea / 5) * 5,   // largest segment = capMax
        baseGrowth: round1(rules.growthBase + rules.growthPerSize * size),
        building: null,
      };
    });
    spreadStarts(map, this.factions.length, this.rand).forEach((sid, f) => {
      this.segs[sid].owner = f;
      this.segs[sid].troops = rules.startTroops;
    });
    this.updateGrowth();
  }

  // growth multiplier per segment: farm (own), hospitals (adjacent own), labs (whole faction)
  updateGrowth() {
    const labs = this.factions.map((f) => this.segs.filter((s) => s.owner === f.id && s.building === 'lab').length);
    for (const s of this.segs) {
      if (s.owner < 0) { s.growth = 0; continue; }
      let mult = 1 + labs[s.owner] * effects.labGrowth;
      if (s.building === 'farm') mult += effects.farmGrowth;
      for (const a of s.adj) {
        const n = this.segs[a];
        if (n.owner === s.owner && n.building === 'hospital') mult += effects.hospitalGrowth;
      }
      s.growth = round1(s.baseGrowth * mult);
    }
  }

  defMult(s) { return s.building === 'fort' ? effects.fortDefense : 1; }
  atkMult(s) { return s.building === 'barracks' ? effects.barracksAttack : 1; }

  // faction f sends n troops from segment a to adjacent segment b
  send(f, a, b, n, auto = false) {
    const from = this.segs[a];
    n = Math.floor(Math.min(n, from.troops));
    if (this.state !== 'running' || from.owner !== f || !from.adj.includes(b) || n < 1) return false;
    from.troops -= n;
    const to = this.segs[b];
    const dur = Math.hypot(to.x - from.x, to.y - from.y) / rules.armySpeed;
    this.armies.push({ owner: f, n, atk: this.atkMult(from), from: a, to: b, t: 0, dur });
    if (f === 0 && !auto) this.stats.sent++;
    return true;
  }

  // faction f builds type in segment s, paid with troops from that segment
  build(f, sid, type) {
    const s = this.segs[sid], b = buildings[type];
    if (this.state !== 'running' || s.owner !== f || !b || s.building === type || s.troops < b.cost) return false;
    s.troops -= b.cost;
    s.building = type;
    this.version++;
    this.updateGrowth();
    if (f === 0) this.stats.built++;
    return true;
  }

  // army arrives: reinforce own segment or fight
  arrive(a) {
    const t = this.segs[a.to];
    if (t.owner === a.owner) { t.troops += a.n; return; }
    const atk = a.n * a.atk, def = t.troops * this.defMult(t);
    if (atk > def) {
      t.owner = a.owner;
      t.troops = (atk - def) / a.atk;
      this.version++;
      this.updateGrowth();
      if (a.owner === 0) this.stats.captured++;
    } else {
      t.troops = (def - atk) / this.defMult(t);
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
      if (s.owner < 0) continue;
      if (s.troops < s.cap) s.troops = Math.min(s.cap, s.troops + s.growth * dt);
      else s.troops = Math.max(s.cap, s.troops - rules.overCapDecay * dt);
    }
    for (const a of this.armies) {
      a.t += dt / a.dur;
      if (a.t >= 1) this.arrive(a);
    }
    this.armies = this.armies.filter((a) => a.t < 1);
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
