// bot brain. called every few seconds per bot faction (interval = faction.think).
// personality: { build: chance to build per think, risk: troop safety margin,
//                actions: max moves per think (build, attack or reinforce, shared budget
//                so a big empire doesn't act faster than a small one),
//                grudge: extra value for player segments }
import { rules, buildings, effects } from './config.js?v=32';
import { hops } from './mapgen.js?v=32';

export const personalities = {
  aggressive: { build: 0.25, risk: 1.15, actions: 2, grudge: 0.3 },
  builder:    { build: 0.7,  risk: 1.35, actions: 1, grudge: 0 },
  turtle:     { build: 0.5,  risk: 1.6,  actions: 1, grudge: -0.2 },
};

export function think(b, f) {
  const p = f.personality, me = f.id, segs = b.segs;
  const mine = segs.filter((s) => s.owner === me);
  if (!mine.length) return;

  // front distance: 0 = touches a non-own segment, 1 = one step behind the front, ...
  const front = hops(b.map, mine.filter((s) => s.adj.some((a) => segs[a].owner !== me)).map((s) => s.id));

  let budget = p.actions;

  // 1. build: at most one building per think
  if (b.rand() < p.build) {
    const reserve = 4;
    for (const s of shuffle(mine, b.rand)) {
      if (s.building) continue;
      const type = pickBuilding(b, s, front[s.id], mine.length);
      if (s.troops >= b.costOf(me, type) + reserve && b.build(me, s.id, type)) { budget--; break; }
    }
  }
  if (budget <= 0) return;

  // 2. attack: rank adjacent targets by value per troop needed
  const options = [];
  for (const s of mine) {
    if (s.troops < 3) continue;
    for (const tid of s.adj) {
      const t = segs[tid];
      if (t.owner === me) continue;
      const travel = Math.hypot(t.x - s.x, t.y - s.y) / rules.armySpeed;
      const def = (t.troops + t.growth * travel) * b.defMult(t);
      // count own armies already heading there
      const coming = b.armies.filter((a) => a.owner === me && a.to === tid).reduce((v, a) => v + a.n * a.atk, 0);
      const need = (def - coming) / b.atkMult(s);
      if (need <= 0) continue;
      const send = Math.ceil(need * p.risk + 2);
      if (send > s.troops - 1) continue;
      let value = t.cap / 50 + (t.building ? 0.6 : 0) + (t.relic ? 1.2 : 0) + (t.trait === 'river' || t.trait === 'lakeside' ? 0.4 : 0);
      if (t.owner === 0) value += p.grudge;
      if (t.owner < 0) value += 0.2;   // neutrals don't fight back
      options.push({ s, tid, send, score: value / send });
    }
  }
  options.sort((x, y) => y.score - x.score);
  const used = new Set();
  for (const o of options) {
    if (budget <= 0) return;
    if (used.has(o.s.id) || used.has('t' + o.tid)) continue;
    if (b.send(me, o.s.id, o.tid, o.send)) { used.add(o.s.id); used.add('t' + o.tid); budget--; }
  }

  // 3. reinforce with what's left: the fullest interior segment pushes troops one step toward the front
  const back = mine.filter((s) => !used.has(s.id) && front[s.id] >= 1 && s.troops >= s.cap * 0.5)
    .sort((x, y) => y.troops - x.troops);
  for (const s of back) {
    if (budget <= 0) return;
    const next = s.adj.map((a) => segs[a]).filter((n) => n.owner === me && front[n.id] < front[s.id]);
    if (!next.length) continue;
    next.sort((x, y) => x.troops - y.troops);
    if (b.send(me, s.id, next[0].id, s.troops * 0.7)) budget--;
  }
}

// choose a building that fits the segment's position
function pickBuilding(b, s, frontDist, count) {
  const me = s.owner, segs = b.segs;
  if (frontDist === 0) {
    // on the front: fort if a neighbour could take it, else barracks
    const threat = s.adj.some((a) => segs[a].owner >= 0 && segs[a].owner !== me && segs[a].troops > s.troops * 0.8);
    return threat ? 'fort' : 'barracks';
  }
  const hasLab = segs.some((x) => x.owner === me && x.building === 'lab');
  if (count >= 6 && !hasLab) return 'lab';
  const ownNbrs = s.adj.filter((a) => segs[a].owner === me).length;
  if (ownNbrs >= 3 && ownNbrs * effects.hospitalGrowth > effects.farmGrowth) return 'hospital';
  return 'farm';
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
