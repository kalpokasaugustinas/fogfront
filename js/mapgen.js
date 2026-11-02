// procedural map generator: a noisy island split into voronoi-like segments.
// works on a square raster grid; every cell holds a segment id (-1 = sea).
// used for both battle maps (segments) and the campaign world (regions).

// seeded random generator (mulberry32): same seed -> same map
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// smooth value noise on a size x size lattice; input u, v in [0, 1]
function noise2(rand, size) {
  const v = Array.from({ length: (size + 1) * (size + 1) }, rand);
  const s = (t) => t * t * (3 - 2 * t);
  return (u, w) => {
    const fx = u * size, fy = w * size;
    const ix = Math.min(size - 1, Math.max(0, Math.floor(fx)));
    const iy = Math.min(size - 1, Math.max(0, Math.floor(fy)));
    const tx = s(fx - ix), ty = s(fy - iy), i = iy * (size + 1) + ix;
    const a = v[i], b = v[i + 1], c = v[i + size + 1], d = v[i + size + 2];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// island shapes as signed distance functions on x, y in [-0.5, 0.5] (negative = inside)
const shapes = {
  blob: (x, y) => Math.hypot(x, y) - 0.4,
  square: (x, y) => Math.max(Math.abs(x), Math.abs(y)) - 0.37,
  diamond: (x, y) => (Math.abs(x) + Math.abs(y) - 0.46) / Math.SQRT2,
  triangle: (x, y) => sdTriangle(x, -y + 0.127, 0.44),   // apex up, centred vertically
  peanut: (x, y) => Math.min(Math.hypot(x - 0.18, y + 0.06), Math.hypot(x + 0.18, y - 0.06)) - 0.26,
  ring: (x, y) => Math.abs(Math.hypot(x, y) - 0.3) - 0.14,
};
export const shapeNames = Object.keys(shapes);

// signed distance to an equilateral triangle with half-side r (inigo quilez), y up
function sdTriangle(px, py, r) {
  const k = Math.sqrt(3);
  px = Math.abs(px) - r;
  py = py + r / k;
  if (px + k * py > 0) [px, py] = [(px - k * py) / 2, (-k * px - py) / 2];
  px -= Math.min(Math.max(px, -2 * r), 0);
  return -Math.hypot(px, py) * Math.sign(py);
}

// terrain codes for cells that aren't land segments
export const terrainTypes = { sea: 0, lake: 1, mountain: 2 };

// shape: a key of shapes, or 'random' (picked from the seed). obstacles: carve lakes + mountain ranges
export function generateMap({ seed, cells: n, grid: g, shape = 'blob', obstacles = false }) {
  const rand = rng(seed);
  const na = noise2(rand, 3), nb = noise2(rand, 7);
  const wx = noise2(rand, 6), wy = noise2(rand, 6);
  const ids = new Int16Array(g * g).fill(-1);
  // separate generator for shape + obstacles, so the plain blob maps stay exactly as before
  const orand = rng(Math.imul(seed ^ 0x5bd1e995, 2654435761));   // hashed so neighbouring seeds differ
  if (shape === 'random') shape = shapeNames[Math.floor(orand() * shapeNames.length)];
  const sdf = shapes[shape] ?? shapes.blob;
  const sx = noise2(orand, 4), sy = noise2(orand, 4), tn = noise2(orand, 14);
  const squiggle = shape === 'blob' ? 0 : 0.07;   // domain warp makes straight edges wavy

  // 1. island mask: shape with a noisy coastline
  const mask = new Uint8Array(g * g);
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const u = (x + 0.5) / g, w = (y + 0.5) / g;
      const px = u - 0.5 + (sx(u, w) - 0.5) * squiggle, py = w - 0.5 + (sy(u, w) - 0.5) * squiggle;
      const wobble = (na(u, w) - 0.5) * 0.16 + (nb(u, w) - 0.5) * 0.07;
      if (sdf(px, py) < wobble) mask[y * g + x] = 1;
    }
  }

  // 1b. obstacles: round lakes and chains of mountain blobs, carved out of the land
  const terrain = new Uint8Array(g * g);
  if (obstacles) {
    const island = mask.slice(), cellsIn = [];
    for (let c = 0; c < g * g; c++) if (island[c]) cellsIn.push(c);
    let lakes = Math.floor(orand() * 3), ranges = Math.floor(orand() * 3);
    if (lakes + ranges === 0) lakes = 1;
    const blobs = [];
    const pick = () => { const c = cellsIn[Math.floor(orand() * cellsIn.length)]; return [c % g, Math.floor(c / g)]; };
    for (let i = 0; i < lakes; i++) {
      const [x, y] = pick();
      blobs.push({ x, y, r: g * (0.05 + orand() * 0.045), type: terrainTypes.lake });
    }
    for (let i = 0; i < ranges; i++) {
      let [x, y] = pick();
      const ang = orand() * Math.PI, steps = 3 + Math.floor(orand() * 4), r = g * (0.025 + orand() * 0.015);
      for (let k = 0; k < steps; k++) {
        blobs.push({ x, y, r: r * (0.8 + orand() * 0.5), type: terrainTypes.mountain });
        x += Math.cos(ang) * r * 1.5 + (orand() - 0.5) * r;
        y += Math.sin(ang) * r * 1.5 + (orand() - 0.5) * r;
      }
    }
    for (const c of cellsIn) {
      const x = c % g, y = Math.floor(c / g), wob = 0.75 + 0.5 * tn(x / g, y / g);
      for (const b of blobs) {
        if (Math.hypot(x - b.x, y - b.y) < b.r * wob) { terrain[c] = b.type; mask[c] = 0; break; }
      }
    }
    // land cut off by obstacles becomes mountain, so the playable land stays one piece
    const keepSet = new Uint8Array(g * g);
    for (const c of largestBlob(mask, g)) keepSet[c] = 1;
    for (const c of cellsIn) if (!keepSet[c] && !terrain[c]) { terrain[c] = terrainTypes.mountain; mask[c] = 0; }
  }
  // keep only the largest connected landmass, so every segment is reachable
  const land = largestBlob(mask, g);

  // 2. seed points spread out over the land (min distance rejection sampling)
  const minDist = Math.sqrt(land.length / n) * 0.8;
  const seeds = [];
  for (let tries = 0; seeds.length < n && tries < 20000; tries++) {
    const c = land[Math.floor(rand() * land.length)];
    const x = c % g, y = Math.floor(c / g);
    const d = tries < 15000 ? minDist : minDist * 0.6;   // relax if the island is crowded
    if (seeds.every((s) => Math.hypot(s.x - x, s.y - y) >= d)) seeds.push({ x, y });
  }

  // 3. each land cell goes to its nearest seed, measured from a noise-warped
  //    position so borders wiggle instead of being straight lines
  const warp = minDist * 0.35;
  for (const c of land) {
    const x = c % g, y = Math.floor(c / g), u = x / g, w = y / g;
    const px = x + (wx(u, w) - 0.5) * 2 * warp, py = y + (wy(u, w) - 0.5) * 2 * warp;
    let best = 0, bd = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const d = (seeds[i].x - px) ** 2 + (seeds[i].y - py) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    ids[c] = best;
  }

  // 4. warping can split a segment into pieces: keep its largest piece,
  //    hand the stray pieces to whatever neighbour touches them
  const nbrs = (c) => {
    const x = c % g, out = [];
    if (x > 0) out.push(c - 1);
    if (x < g - 1) out.push(c + 1);
    if (c >= g) out.push(c - g);
    if (c < g * g - g) out.push(c + g);
    return out;
  };
  const seen = new Uint8Array(g * g), keep = new Uint8Array(g * g);
  const bestPiece = new Map();
  for (const c of land) {
    if (seen[c]) continue;
    const id = ids[c], piece = [c];
    seen[c] = 1;
    for (let k = 0; k < piece.length; k++) {
      for (const m of nbrs(piece[k])) if (!seen[m] && ids[m] === id) { seen[m] = 1; piece.push(m); }
    }
    const prev = bestPiece.get(id);
    if (!prev || piece.length > prev.length) bestPiece.set(id, piece);
  }
  for (const piece of bestPiece.values()) for (const c of piece) keep[c] = 1;
  let orphans = land.filter((c) => !keep[c]);
  for (const c of orphans) ids[c] = -2;
  while (orphans.length) {
    const left = [];
    for (const c of orphans) {
      const m = nbrs(c).find((m) => ids[m] >= 0);
      if (m !== undefined) ids[c] = ids[m]; else left.push(c);
    }
    if (left.length === orphans.length) { for (const c of left) ids[c] = -1; break; }
    orphans = left;
  }

  // 5. renumber segments 0..k-1 (drop any seed that ended up with no cells)
  const remap = new Map();
  for (const c of land) if (ids[c] >= 0 && !remap.has(ids[c])) remap.set(ids[c], remap.size);
  for (const c of land) if (ids[c] >= 0) ids[c] = remap.get(ids[c]);
  const segs = Array.from({ length: remap.size }, (_, id) => ({ id, area: 0, sx: 0, sy: 0, adj: new Set() }));

  // 6. area, adjacency and edge cells (edge = differs from any 4-neighbour, so borders are 2 cells wide)
  const edge = new Uint8Array(g * g);
  for (let c = 0; c < g * g; c++) {
    const id = ids[c], x = c % g;
    if (id >= 0) { const s = segs[id]; s.area++; s.sx += x; s.sy += Math.floor(c / g); }
    const r = x < g - 1 ? ids[c + 1] : -1, d = c < g * g - g ? ids[c + g] : -1;
    const l = x > 0 ? ids[c - 1] : -1, u = c >= g ? ids[c - g] : -1;
    if (r !== id || d !== id || l !== id || u !== id) edge[c] = 1;
    if (id >= 0 && r >= 0 && r !== id) { segs[id].adj.add(r); segs[r].adj.add(id); }
    if (id >= 0 && d >= 0 && d !== id) { segs[id].adj.add(d); segs[d].adj.add(id); }
  }

  // 7. label position = the most "inner" cell (farthest from any border), via multi-source bfs
  const dist = new Int16Array(g * g).fill(-1), queue = [];
  for (const c of land) {
    if (ids[c] < 0) continue;
    if (nbrs(c).some((m) => ids[m] !== ids[c]) || nbrs(c).length < 4) { dist[c] = 0; queue.push(c); }
  }
  for (let k = 0; k < queue.length; k++) {
    const c = queue[k];
    for (const m of nbrs(c)) if (dist[m] < 0 && ids[m] === ids[c]) { dist[m] = dist[c] + 1; queue.push(m); }
  }
  for (const s of segs) { s.cx = s.sx / s.area; s.cy = s.sy / s.area; s.score = -1; }
  for (const c of land) {
    const id = ids[c];
    if (id < 0) continue;
    const s = segs[id], x = c % g, y = Math.floor(c / g);
    // prefer deep cells, small tie-break toward the centroid
    const score = dist[c] - Math.hypot(x - s.cx, y - s.cy) * 0.05;
    if (score > s.score) { s.score = score; s.x = x + 0.5; s.y = y + 0.5; }
  }

  const avgArea = segs.reduce((a, s) => a + s.area, 0) / segs.length;
  const rn = noise2(orand, 48);   // fine noise for mountain shading
  return {
    grid: g, ids, edge, avgArea, shape, terrain,
    // per-cell 0..1 noise, used to shade mountains
    relief: Float32Array.from({ length: g * g }, (_, c) => (terrain[c] ? rn((c % g) / g, Math.floor(c / g) / g) : 0)),
    segs: segs.map((s) => ({ id: s.id, area: s.area, x: s.x, y: s.y, adj: [...s.adj] })),
  };
}

// cells of the largest 4-connected blob in a 0/1 mask
function largestBlob(mask, g) {
  const seen = new Uint8Array(g * g);
  let best = [];
  for (let c0 = 0; c0 < g * g; c0++) {
    if (!mask[c0] || seen[c0]) continue;
    const blob = [c0];
    seen[c0] = 1;
    for (let k = 0; k < blob.length; k++) {
      const c = blob[k], x = c % g;
      for (const m of [x > 0 ? c - 1 : -1, x < g - 1 ? c + 1 : -1, c - g, c + g]) {
        if (m >= 0 && m < g * g && mask[m] && !seen[m]) { seen[m] = 1; blob.push(m); }
      }
    }
    if (blob.length > best.length) best = blob;
  }
  return best.sort((a, b) => a - b);
}

// graph distance (in hops) from a set of start segments to every segment
export function hops(map, starts) {
  const d = new Array(map.segs.length).fill(Infinity), q = [...starts];
  for (const s of starts) d[s] = 0;
  for (let k = 0; k < q.length; k++) {
    for (const m of map.segs[q[k]].adj) if (d[m] === Infinity) { d[m] = d[q[k]] + 1; q.push(m); }
  }
  return d;
}

// pick k segments far apart from each other (player first, then bots)
export function spreadStarts(map, k, rand) {
  const starts = [Math.floor(rand() * map.segs.length)];
  while (starts.length < k) {
    const d = hops(map, starts);
    let best = -1, bd = -1;
    for (let i = 0; i < d.length; i++) {
      const v = d[i] + rand() * 0.5;   // random tie-break
      if (!starts.includes(i) && v > bd) { bd = v; best = i; }
    }
    starts.push(best);
  }
  return starts;
}
