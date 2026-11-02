// map renderer in a soft "island diorama" style:
// misty sea, foam at the waterline, cliffs under the island edge, natural ground colours,
// owner colours as glowing segment borders, low-poly trees on top.
// all edges (coast, lakes, mountains, segment borders) are smooth vector outlines traced from the
// map grid with marching squares + chaikin smoothing, so nothing looks pixelated at any size.
// layers (display resolution, cached): under (fog, cliff) -> top (ground, building scenes, owner
// overlays, borders, rocks, trees; repainted when owners, buildings or the selection change)
import { themes } from './config.js?v=17';
import * as structures from './structures.js?v=17';

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// mix colour toward white (k > 0) or black (k < 0)
export function shade([r, g, b], k) {
  const t = k > 0 ? 255 : 0, a = Math.abs(k);
  return [r + (t - r) * a, g + (t - g) * a, b + (t - b) * a];
}

// linear mix of two rgb colours, t in [0, 1]
export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// deterministic hash + smooth value noise (ground patches, tree placement)
function hash(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---------- outline tracing ----------

// marching squares over a 0/1 test on grid cells (sampled at cell centres) inside a bounding box.
// returns a Path2D (grid units) of all closed outlines, smoothed; fill it with 'evenodd' for holes.
// lab(c) labels every cell (segment id, sea, lake, ...): each outline point remembers the pair of
// labels it separates, so a border shared by two outlines is smoothed the same way in both and
// points where 3 areas meet stay pinned (no gaps or overlaps between neighbours).
// angular = low-poly look (mountains): straight edges instead of smooth curves
function outline(test, lab, g, x0 = 0, y0 = 0, x1 = g - 1, y1 = g - 1, angular = false) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < g && y < g && test(y * g + x);
  const label = (x, y) => (x >= 0 && y >= 0 && x < g && y < g ? lab(y * g + x) : -1);
  // point keys use doubled coordinates so every edge midpoint is an integer
  const links = new Map(), pair = new Map();
  const link = (a, b) => {
    (links.get(a) ?? links.set(a, []).get(a)).push(b);
    (links.get(b) ?? links.set(b, []).get(b)).push(a);
  };
  const key = (x2, y2) => x2 * 4096 + y2;
  // remember which two cell labels a crossing point separates (unordered)
  const mark = (k, ax, ay, bx, by) => {
    const p = label(ax, ay), q = label(bx, by);
    pair.set(k, Math.min(p, q) * 100000 + Math.max(p, q));
  };
  for (let y = y0 - 1; y <= y1; y++) {
    for (let x = x0 - 1; x <= x1; x++) {
      const a = inside(x, y), b = inside(x + 1, y), c = inside(x + 1, y + 1), d = inside(x, y + 1);
      if (a === b && b === c && c === d) continue;
      // crossing midpoints of the square's edges (doubled coords)
      const top = key(2 * x + 2, 2 * y + 1), right = key(2 * x + 3, 2 * y + 2);
      const bottom = key(2 * x + 2, 2 * y + 3), left = key(2 * x + 1, 2 * y + 2);
      const cross = [];
      if (a !== b) { cross.push(top); mark(top, x, y, x + 1, y); }
      if (b !== c) { cross.push(right); mark(right, x + 1, y, x + 1, y + 1); }
      if (c !== d) { cross.push(bottom); mark(bottom, x, y + 1, x + 1, y + 1); }
      if (d !== a) { cross.push(left); mark(left, x, y, x, y + 1); }
      if (cross.length === 2) link(cross[0], cross[1]);
      else if (a) { link(top, left); link(right, bottom); }   // saddle: cut off the inside corners
      else { link(top, right); link(bottom, left); }
    }
  }
  const path = new Path2D(), seen = new Set();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    // walk the loop
    const loop = [], codes = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push([Math.floor(cur / 4096) / 2, (cur % 4096) / 2]);
      codes.push(pair.get(cur));
      const nb = links.get(cur);
      const next = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = next;
    }
    if (loop.length < 3) continue;
    const pts = angular ? rdp(relax(loop, codes), 2.2 * g / 480) : chaikin(relax(relax(loop, codes), codes));
    if (pts.length < 3) continue;
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
  }
  return path;
}

// moving-average smoothing along a closed loop, done separately on each run of points that
// separate the same two areas; the window shrinks toward the run ends, so junctions stay fixed
// and the result doesn't depend on loop direction or start point
const relax_window = 7;
function relax(p, codes) {
  const n = p.length, out = p.map((q) => [q[0], q[1]]);
  let start = codes.findIndex((c, i) => c !== codes[(i - 1 + n) % n]);
  if (start < 0) {
    // one run around the whole loop (e.g. a lake inside a single segment): plain cyclic average
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0;
      for (let j = -relax_window; j <= relax_window; j++) { const q = p[(((i + j) % n) + n) % n]; sx += q[0]; sy += q[1]; }
      out[i] = [sx / (2 * relax_window + 1), sy / (2 * relax_window + 1)];
    }
    return out;
  }
  for (let done = 0; done < n;) {
    // run = consecutive points with the same pair code
    let len = 1;
    while (len < n && codes[(start + len) % n] === codes[start]) len++;
    for (let j = 0; j < len; j++) {
      const w = Math.min(relax_window, j, len - 1 - j);
      let sx = 0, sy = 0;
      for (let k = -w; k <= w; k++) { const q = p[(start + j + k) % n]; sx += q[0]; sy += q[1]; }
      out[(start + j) % n] = [sx / (2 * w + 1), sy / (2 * w + 1)];
    }
    start = (start + len) % n;
    done += len;
  }
  return out;
}

// ramer-douglas-peucker simplification of a closed loop (eps in grid units)
function rdp(p, eps) {
  const simplify = (pts) => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    let far = 0, fi = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / len;
      if (d > far) { far = d; fi = i; }
    }
    if (far <= eps) return [a, b];
    return [...simplify(pts.slice(0, fi + 1)).slice(0, -1), ...simplify(pts.slice(fi))];
  };
  // split the loop at its two farthest-apart points so both halves are open polylines
  let j = 0, best = 0;
  for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > best) { best = d; j = i; } }
  return [...simplify(p.slice(0, j + 1)).slice(0, -1), ...simplify([...p.slice(j), p[0]]).slice(0, -1)];
}

// one round of chaikin corner cutting on a closed loop (rounds the 45° marching-squares steps)
function chaikin(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}

export class MapView {
  // segThemes (optional): theme name per segment, e.g. campaign regions with their own climate
  constructor(canvas, map, theme, segThemes) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setMap(map, theme, segThemes);
    // follow the container size (screen rotation, panel changes)
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  setMap(map, theme = 'summer', segThemes = null) {
    this.map = map;
    this.theme = themes[theme] ?? themes.summer;
    this.segTheme = segThemes ? segThemes.map((n) => themes[n] ?? this.theme) : null;
    this.k = map.grid / 480;   // feature sizes are tuned for a 480 grid
    this.buildGround();
    this.buildOutlines();
    this.placeTrees();
    // fog around the island lives on the container, so there's no square edge
    const { fogA, fogB } = this.theme;
    this.canvas.parentElement.style.background =
      `radial-gradient(circle at 50% 45%, rgb(${fogA}) 0%, rgb(${fogB}) 75%)`;
    this.styleOf = this.st = null;
    this.bkey = this.okey = null;
    this.size = 0;   // forces resize() to rebuild every cached layer for the new map
    this.resize();
  }

  // fit the canvas into the parent: width = map width, height = squashed map + room for cliffs
  // below and buildings/rocks above. cached layers are rebuilt lazily
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.tilt = 0.8;
    const pad = 0.12;   // extra height (as a share of width): cliffs + raised objects
    const size = Math.max(50, Math.floor(Math.min(r.width, r.height / (this.tilt + pad))));
    const dpr = window.devicePixelRatio || 1;
    if (size === this.size && dpr === this.dpr && this.under) return;
    this.size = size;
    this.dpr = dpr;
    this.scale = size / this.map.grid;
    this.oy = size * pad * 0.5;
    const h = Math.round(size * (this.tilt + pad));
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = h + 'px';
    this.under = this.base = this.rocks = this.layerGround = this.layerOwner = this.layerObjects = null;
    this.sprites = new Map();
    this.ofsX = this.ofsY = 0;
    this.u = Math.max(3.5, size / 92);   // building scale unit in css px
    this.spotCache = new Map();
  }

  // grid-res ground texture (grass/earth noise, shore and scree tints). it is only seen through the
  // smooth island outline, so its pixel edges never show
  buildGround() {
    const { ids, terrain, relief, near, nearType, grid: g, segs } = this.map, t = this.theme;
    const seed = (this.seed = (segs.length * 7919 + Math.round(segs[0].x * 31)) | 0);
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = g; return c; };
    this.groundC = mk();
    const gi = this.groundC.getContext('2d').createImageData(g, g);
    const isMtn = (c) => terrain && terrain[c] === 2;
    const h = (c) => (c >= 0 && c < g * g && isMtn(c) ? relief[c] : 0);
    for (let c = 0; c < g * g; c++) {
      const x = c % g, y = Math.floor(c / g), o = c * 4;
      // ground everywhere (also under mountains and a bit into the sea, so edges never fade out)
      const n = vnoise(x / (22 * this.k), y / (22 * this.k), seed) * 0.7 + vnoise(x / (6 * this.k), y / (6 * this.k), seed + 1) * 0.3;
      const tc = this.segTheme && ids[c] >= 0 ? this.segTheme[ids[c]] : t;   // this cell's climate
      let col = mix(tc.groundA, tc.groundB, n);
      if (near && near[c]) col = mix(col, nearType[c] === 1 ? tc.shore : tc.scree, 0.5 * (1 - (near[c] - 1) / 10) ** 1.5);
      gi.data[o] = col[0]; gi.data[o + 1] = col[1]; gi.data[o + 2] = col[2]; gi.data[o + 3] = 255;
    }
    this.groundC.getContext('2d').putImageData(gi, 0, 0);
  }

  // smooth outlines: island (land + mountains, lakes as holes), outer (incl. lakes), lakes,
  // mountains and one per segment
  buildOutlines() {
    const { ids, terrain, grid: g, segs } = this.map;
    const lake = (c) => terrain && terrain[c] === 1, mtn = (c) => terrain && terrain[c] === 2;
    // cell label: segment id, or -1 sea / -2 lake / -3 mountain
    const lab = (c) => (ids[c] >= 0 ? ids[c] : -1 - (terrain ? terrain[c] : 0));
    this.islandP = outline((c) => ids[c] >= 0 || mtn(c), lab, g);
    this.outerP = outline((c) => ids[c] >= 0 || mtn(c) || lake(c), lab, g);
    this.lakesP = outline(lake, lab, g);
    this.mtnP = outline(mtn, lab, g, 0, 0, g - 1, g - 1, true);
    // cracks on the rock tops: short kinked lines starting on random mountain cells
    const rockCells = [];
    for (let c = 0; c < g * g; c++) if (mtn(c)) rockCells.push(c);
    this.cracks = [];
    const k = this.k, count = Math.round(rockCells.length / (450 * k * k));
    for (let i = 0; i < count; i++) {
      const c0 = rockCells[Math.floor(hash(i, 11, this.seed) * rockCells.length)];
      let x0 = c0 % g, y0 = Math.floor(c0 / g), a = hash(i, 12, this.seed) * Math.PI * 2;
      const line = [[x0, y0]];
      for (let s = 0; s < 2 + Math.floor(hash(i, 13, this.seed) * 2); s++) {
        a += (hash(i, 14 + s, this.seed) - 0.5) * 1.6;
        const len = (5 + hash(i, 20 + s, this.seed) * 8) * k;
        x0 += Math.cos(a) * len; y0 += Math.sin(a) * len;
        line.push([x0, y0]);
      }
      this.cracks.push(line);
    }
    // per-segment bounding boxes keep the tracing fast
    const box = segs.map(() => [g, g, -1, -1]);
    for (let c = 0; c < g * g; c++) {
      const id = ids[c];
      if (id < 0) continue;
      const b = box[id], x = c % g, y = Math.floor(c / g);
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    }
    this.segP = segs.map((s) => outline((c) => ids[c] === s.id, lab, g, ...box[s.id]));
    this.boxes = box;
    this.segCells = segs.map(() => []);
    for (let c = 0; c < g * g; c++) if (ids[c] >= 0) this.segCells[ids[c]].push(c);
  }

  // tree clusters inside segments, away from borders and number labels
  placeTrees() {
    const { ids, bdist, grid: g, segs } = this.map, t = this.theme, k = this.k;
    this.trees = [];
    if (!bdist || !t.trees) return;
    const clear = 26 * k;   // keep label areas free
    const ok = (x, y) => {
      const c = Math.floor(y) * g + Math.floor(x);
      if (x < 0 || y < 0 || x >= g || y >= g || ids[c] < 0 || bdist[c] < 4 * k) return false;
      const s = segs[ids[c]];
      return Math.hypot(s.x - x, s.y - y) > clear;
    };
    let land = 0;
    for (let c = 0; c < g * g; c++) if (ids[c] >= 0) land++;
    const dt = this.map.detail ?? 1;   // zoomed-out maps: smaller trees, more woods
    const clusters = Math.round((land / (g * g)) * 45 * t.trees / Math.sqrt(dt));
    let i = 0;
    for (let n = 0, tries = 0; n < clusters && tries < clusters * 30; tries++) {
      const cx = hash(i++, 1, this.seed) * g, cy = hash(i++, 2, this.seed) * g;
      if (!ok(cx, cy)) continue;
      n++;
      // a cluster = a small wood: 6-17 trees packed together
      const count = 6 + Math.floor(hash(i++, 3, this.seed) * 12);
      for (let j = 0; j < count; j++) {
        const a = hash(i++, 4, this.seed) * Math.PI * 2, d = Math.sqrt(hash(i++, 5, this.seed)) * 14 * k * Math.max(0.5, dt);
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (ok(x, y)) this.trees.push({ x, y, r: (3.4 + hash(i++, 6, this.seed) * 2.2) * k * Math.max(0.45, dt), seg: ids[Math.floor(y) * g + Math.floor(x)] });
      }
    }
    this.trees.sort((a, b) => a.y - b.y);   // draw back to front
  }

  // ---------- camera: slight tilt ----------
  // the ground plane is squashed vertically (tilt) so the map is seen at an angle; heights
  // (cliffs, rocks, buildings, trees) stay upright, which gives the 2.5d diorama look.
  // grid -> css: x * scale, y * scale * tilt + oy

  sx(gx) { return gx * this.scale; }
  sy(gy) { return gy * this.scale * this.tilt + this.oy; }
  px(v) { return v * this.scale; }   // grid length -> css px (sizes)

  // ctx transforms: grid units (with tilt) or css px. ofsX/ofsY shift the origin (device px) while
  // drawing into a small sprite canvas, so the same drawing code works for sprites and full layers
  gridT(x) { x.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale * this.tilt, -this.ofsX, this.dpr * this.oy - this.ofsY); }
  cssT(x) { x.setTransform(this.dpr, 0, 0, this.dpr, -this.ofsX, -this.ofsY); }

  // display-res canvas, ctx in grid units
  newLayer() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const x = c.getContext('2d');
    this.gridT(x);
    x.imageSmoothingQuality = 'high';
    return [c, x];
  }

  // fog shadow, lake water, cliff face and mist (static per map and size)
  buildUnder() {
    const [c, x] = this.newLayer(), t = this.theme, g = this.map.grid, px = 1 / this.scale, py = px / this.tilt;
    const ch = Math.max(4, this.size * 0.022) * py;   // cliff height (css px -> grid y units)
    x.save();
    x.filter = `blur(${this.size * 0.035 * this.dpr}px)`;
    x.translate(g * 0.015, ch + g * 0.05);
    x.fillStyle = css(t.shadow, 0.16);
    x.fill(this.outerP);
    x.restore();
    x.save();
    x.translate(0, ch);
    // lakes: water (a bit deeper than the old sea colour), light rim along the shore
    x.fillStyle = css(shade(hexToRgb(t.sea), -0.08));
    x.fill(this.lakesP);
    x.lineWidth = Math.max(1.5, this.size * 0.004) * px;
    x.strokeStyle = css(t.foam, 0.8);
    x.stroke(this.lakesP);
    x.restore();
    // cliff: island shape stacked downward, dark at the foot, lighter toward the top edge
    for (let i = ch; i >= py * 0.5; i -= py * 0.5) {
      x.save();
      x.translate(0, i);
      x.fillStyle = css(i > ch * 0.45 ? t.cliffDark : t.cliffLight);
      x.fill(this.islandP, 'evenodd');
      x.restore();
    }
    // mist banks around the island and mist along the cliff foot
    x.save();
    x.filter = `blur(${this.size * 0.03 * this.dpr}px)`;
    const fogc = shade(t.fogA, 0.4);
    for (let i = 0; i < 26; i++) {
      const a = hash(i, 31, this.seed) * Math.PI * 2, rr = g * (0.42 + hash(i, 32, this.seed) * 0.14);
      const fx = g / 2 + Math.cos(a) * rr, fy = g / 2 + Math.sin(a) * rr + ch;
      x.fillStyle = css(fogc, 0.45 + hash(i, 33, this.seed) * 0.35);
      x.beginPath();
      x.ellipse(fx, fy, g * (0.06 + hash(i, 34, this.seed) * 0.07), g * (0.03 + hash(i, 35, this.seed) * 0.03), 0, 0, Math.PI * 2);
      x.fill();
    }
    x.filter = `blur(${this.size * 0.012 * this.dpr}px)`;
    x.translate(0, ch * 1.4);
    x.lineWidth = g * 0.025;
    x.strokeStyle = css(fogc, 0.75);
    x.stroke(this.outerP);
    x.restore();
    // fade out toward the canvas edges (elliptical mask), so blurred fog never shows a hard edge
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.translate(c.width / 2, c.height / 2);
    x.scale(1, c.height / c.width);
    const fadeR = c.width / 2, mask = x.createRadialGradient(0, 0, fadeR * 0.7, 0, 0, fadeR);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = mask;
    x.fillRect(-fadeR, -fadeR, fadeR * 2, fadeR * 2);
    x.restore();
    this.under = c;
  }

  // ---------- layers ----------
  // static per map + size: under (fog, cliffs), base (ground, all borders, lip), rocks.
  // per segment sprites (cached small canvases): building ground scene, owner overlay, trees,
  // building top scene. the three composite layers below are rebuilt from sprites with a few
  // drawImage calls when buildings or owners change, so no frame ever re-renders the scenes.

  // small canvas covering segment id's box plus a margin (css px); draw(x) renders into it
  sprite(id, margin, draw) {
    const [bx0, by0, bx1, by1] = this.boxes[id], d = this.dpr;
    const left = Math.floor((this.sx(bx0) - margin) * d), top = Math.floor((this.sy(by0) - margin * 1.6) * d);
    const right = Math.ceil((this.sx(bx1 + 1) + margin) * d), bottom = Math.ceil((this.sy(by1 + 1) + margin * 0.6) * d);
    const c = document.createElement('canvas');
    c.width = Math.max(1, right - left);
    c.height = Math.max(1, bottom - top);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    this.ofsX = left;
    this.ofsY = top;
    try { this.gridT(x); draw(x); } finally { this.ofsX = this.ofsY = 0; }
    return { c, left, top };
  }

  cached(key, make) {
    let s = this.sprites.get(key);
    if (!s) { s = make(); this.sprites.set(key, s); }
    return s;
  }

  // owner overlay: light fill, blurred inner glow, strong colour band at the edge
  overlaySprite(id, color, fill) {
    return this.cached(`o${id}|${color}|${fill}`, () => this.sprite(id, 2, (x) => {
      const p = this.segP[id], px = 1 / this.scale;
      const band = Math.max(2.2, this.size * 0.007) * px, fade = 16 * this.k;
      x.clip(p);
      x.fillStyle = css(color, fill);
      x.fill(p);
      x.filter = `blur(${fade * 0.45 * this.scale * this.dpr}px)`;
      x.strokeStyle = css(color, 0.55);
      x.lineWidth = fade * 1.3;
      x.stroke(p);
      x.filter = 'none';
      x.lineWidth = band * 2;
      x.strokeStyle = css(color, 0.9);
      x.stroke(p);
    }));
  }

  groundSprite(id, type) {
    return this.cached(`g${id}|${type}`, () => this.sprite(id, 2, (x) => structures.ground(this, x, id, type)));
  }

  topSprite(id, type, color) {
    return this.cached(`t${id}|${type}|${color}`, () => this.sprite(id, this.u * 7, (x) => structures.top(this, x, id, type, color)));
  }

  treeSprite(id) {
    return this.cached(`r${id}`, () => this.sprite(id, this.u * 4, (x) => this.drawTreesOf(x, id)));
  }

  blit(x, sp) { x.drawImage(sp.c, sp.left, sp.top); }

  // pre-render sprites in small idle-time chunks (trees for every segment, overlays for every
  // faction colour), so a first capture or build never costs a frame
  prewarm(colors, fill) {
    const jobs = [];
    for (let id = 0; id < this.segP.length; id++) jobs.push(() => this.treeSprite(id));
    for (const col of colors) for (let id = 0; id < this.segP.length; id++) jobs.push(() => this.overlaySprite(id, col, fill));
    const map = this.map, size = this.size;
    const step = () => {
      if (this.map !== map || this.size !== size) return;   // map or size changed: stop
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < 4) jobs.shift()();
      if (jobs.length) setTimeout(step, 16);
    };
    setTimeout(step, 50);
  }

  // static: ground texture, every segment border, light lip along the cliff edge
  buildBase() {
    const [c, x] = this.newLayer(), t = this.theme, g = this.map.grid, px = 1 / this.scale;
    x.save();
    x.clip(this.islandP, 'evenodd');
    x.imageSmoothingEnabled = true;
    x.drawImage(this.groundC, 0, 0, g, g);
    this.drawRivers(x, px);
    x.lineJoin = 'round';
    x.lineWidth = Math.max(1, this.size * 0.0022) * px;
    x.strokeStyle = css(t.lineNeutral, 0.45);
    for (const p of this.segP) x.stroke(p);
    x.lineWidth = Math.max(2, this.size * 0.006) * px;
    x.strokeStyle = css(t.lip, 0.7);
    x.stroke(this.islandP);
    x.restore();
    this.base = c;
  }

  // rivers (visual only): smoothed polylines, drawn in pieces so they widen toward the mouth
  drawRivers(x, px) {
    // river blue (icy in winter), independent of the fog colour
    const t = this.theme, water = t.groundA[0] > 215 ? [128, 168, 196] : [84, 142, 190], dt = this.map.detail ?? 1;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    for (const raw of this.map.rivers ?? []) {
      const pts = chaikin(chaikin(raw)).slice(2, -2);   // open line: drop the wrap-around corner
      const pieces = 6, len = pts.length;
      for (const [col, extra] of [[t.shore, 1.6], [water, 0]]) {
        x.strokeStyle = css(col, extra ? 0.7 : 0.95);
        for (let k = 0; k < pieces; k++) {
          const a = Math.floor((k / pieces) * len), b = Math.min(len - 1, Math.floor(((k + 1) / pieces) * len) + 1);
          if (b - a < 2) continue;
          x.lineWidth = ((1.3 + 3.6 * ((k + 1) / pieces)) * (0.6 + 0.4 * dt) + extra) * Math.max(1, this.size / 700) * px;
          x.beginPath();
          x.moveTo(pts[a][0], pts[a][1]);
          for (let i = a + 1; i <= b; i++) x.lineTo(pts[i][0], pts[i][1]);
          x.stroke();
        }
      }
    }
  }

  // static: rock plateaus
  buildRocks() {
    const [c, x] = this.newLayer();
    this.drawRocks(x, 1 / this.scale);
    this.rocks = c;
  }

  // composite 1: base + flat building scenes
  buildGroundLayer() {
    if (!this.base) this.buildBase();
    const [c, x] = this.newLayer();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(this.base, 0, 0);
    this.st.forEach((s, id) => { if (s.building) this.blit(x, this.groundSprite(id, s.building)); });
    this.layerGround = c;
  }

  // composite 2: owner overlays
  buildOwnerLayer() {
    const [c, x] = this.newLayer();
    x.setTransform(1, 0, 0, 1, 0, 0);
    this.st.forEach((s, id) => { if (s.color) this.blit(x, this.overlaySprite(id, s.color, s.fill)); });
    this.layerOwner = c;
  }

  // composite 3: rocks, then trees or building scenes per segment, back to front
  buildObjectLayer() {
    if (!this.rocks) this.buildRocks();
    const [c, x] = this.newLayer();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(this.rocks, 0, 0);
    const order = this.map.segs.map((s) => s.id).sort((a, b) => this.map.segs[a].y - this.map.segs[b].y);
    for (const id of order) {
      const s = this.st[id];
      this.blit(x, s.building ? this.topSprite(id, s.building, s.color) : this.treeSprite(id));
    }
    this.layerObjects = c;
  }

  // mountains as flat low-poly rock plateaus: soft contact shadow, stacked slate side walls,
  // a light top face with a gentle gradient, dark cracks and outline
  drawRocks(x, px) {
    const t = this.theme, g = this.map.grid, hgt = (Math.max(4, this.size * 0.03) * px) / this.tilt;
    x.save();
    x.filter = `blur(${Math.max(1, this.size * 0.006) * this.dpr}px)`;
    x.fillStyle = 'rgba(25,30,35,0.3)';
    x.translate(hgt * 0.3, hgt * 0.15);
    x.fill(this.mtnP);
    x.restore();
    for (let i = 0; i <= hgt; i += (px * 0.5) / this.tilt) {
      x.save();
      x.translate(0, -i);
      x.fillStyle = css(i < hgt * 0.55 ? t.rockSideDark : t.rockSide);
      x.fill(this.mtnP);
      x.restore();
    }
    x.save();
    x.translate(0, -hgt);
    const grad = x.createLinearGradient(0, 0, g, g);
    grad.addColorStop(0, css(shade(t.rockTop, 0.06)));
    grad.addColorStop(1, css(shade(t.rockTop, -0.1)));
    x.fillStyle = grad;
    x.fill(this.mtnP);
    x.save();
    x.clip(this.mtnP);
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = css(t.rockSideDark, 0.9);
    x.lineWidth = Math.max(1.2, this.size * 0.003) * px;
    for (const line of this.cracks) {
      x.beginPath();
      x.moveTo(line[0][0], line[0][1]);
      for (let i = 1; i < line.length; i++) x.lineTo(line[i][0], line[i][1]);
      x.stroke();
    }
    x.restore();
    x.lineJoin = 'round';
    x.lineWidth = Math.max(1, this.size * 0.0025) * px;
    x.strokeStyle = css(t.rockSideDark, 0.85);
    x.stroke(this.mtnP);
    x.restore();
  }

  // trees of one segment: round crowns or low-poly pines with trunk and shadow
  drawTreesOf(x, id) {
    const t = this.segTheme ? this.segTheme[id] : this.theme, sc = this.scale;
    x.save();
    this.cssT(x);
    for (const tr of this.trees) {
      if (tr.seg !== id) continue;
      const px = this.sx(tr.x), py = this.sy(tr.y), r = Math.max(1.6, tr.r * sc);
      x.fillStyle = 'rgba(20,30,30,0.22)';
      x.beginPath(); x.ellipse(px + r * 0.45, py + r * 0.3, r * 1.05, r * 0.5, 0, 0, Math.PI * 2); x.fill();
      const tw = Math.max(1, r * 0.28);
      x.fillStyle = css(t.trunk ?? [96, 72, 54]);
      x.fillRect(px - tw / 2, py - r * 0.6, tw, r * 0.95);
      if (t.tree === 'pine') {
        const top = py - r * 2.7, base = py - r * 0.05, hw = r * 0.95;
        x.fillStyle = css(t.treeLight);
        x.beginPath(); x.moveTo(px, top); x.lineTo(px - hw, base); x.lineTo(px, base); x.fill();
        x.fillStyle = css(t.treeDark);
        x.beginPath(); x.moveTo(px, top); x.lineTo(px + hw, base); x.lineTo(px, base); x.fill();
        if (t.treeSnow) {
          x.fillStyle = css(t.treeSnow);
          x.beginPath(); x.moveTo(px, top); x.lineTo(px - hw * 0.4, top + r); x.lineTo(px + hw * 0.4, top + r); x.fill();
        }
      } else {
        x.fillStyle = css(t.treeDark);
        x.beginPath(); x.arc(px, py - r * 1.1, r, 0, Math.PI * 2); x.fill();
        x.fillStyle = css(t.treeLight);
        x.beginPath(); x.arc(px - r * 0.3, py - r * 1.45, r * 0.55, 0, Math.PI * 2); x.fill();
      }
    }
    x.restore();
  }

  // n building spots (css px) inside a segment: deep inside, away from the number label and not
  // just below it (buildings stand upward), at least sep css px apart
  spots(id, n, sep) {
    const key = `${id}:${n}:${Math.round(sep)}`;
    if (this.spotCache.has(key)) return this.spotCache.get(key);
    const { bdist, grid: g, segs } = this.map, s = segs[id], sc = this.scale, u = this.u / sc;
    const cand = [];
    const cells = this.segCells[id];
    for (let i = 0; i < cells.length; i += 2) {
      const c = cells[i], x = (c % g) + 0.5, y = Math.floor(c / g) + 0.5, dx = x - s.x, dy = (y - s.y) * this.tilt;
      if (Math.hypot(dx, dy) < u * 4.5 || (Math.abs(dx) < u * 4 && dy > 0 && dy < u * 7)) continue;
      cand.push([Math.min(bdist[c], 40 * this.k) + hash(c, 7, this.seed) * 3, x, y]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    const out = [];
    const take = (list, gap) => {
      for (const [, x, y] of list) {
        if (out.length >= n) break;
        if (out.every((p) => Math.hypot(this.sx(p[0]) - this.sx(x), this.sy(p[1]) - this.sy(y)) >= gap)) out.push([x, y]);
      }
    };
    take(cand, sep);
    // small segment: relax (closer together, label area allowed) so there is always at least one spot
    if (out.length < n) {
      take(cells.map((c) => [bdist[c], (c % g) + 0.5, Math.floor(c / g) + 0.5]).sort((a, b) => b[0] - a[0]), sep * 0.4);
    }
    const res = out.map((p) => [this.sx(p[0]), this.sy(p[1])]);
    this.spotCache.set(key, res);
    return res;
  }

  // spots along the inside of a segment's border (fort towers), sep css px apart
  edgeSpots(id, sep) {
    const key = `e${id}:${Math.round(sep)}`;
    if (this.spotCache.has(key)) return this.spotCache.get(key);
    const { bdist, grid: g, segs } = this.map, s = segs[id], ring = Math.round(2 * this.k + 1);
    const out = [], clear = this.u * 4;
    for (const c of this.segCells[id]) {
      if (bdist[c] !== ring) continue;
      const x = this.sx((c % g) + 0.5), y = this.sy(Math.floor(c / g) + 0.5);
      if (Math.hypot(x - this.sx(s.x), y - this.sy(s.y)) < clear) continue;
      if (out.every((p) => Math.hypot(p[0] - x, p[1] - y) >= sep)) out.push([x, y]);
    }
    this.spotCache.set(key, out);
    return out;
  }

  // selected segment: thick white outline with a soft pulsing glow plus the owner colour inside;
  // targets: moving dashed white outlines. drawn every frame on top of the cached layers
  highlight(ctx, id, color, targets, time, targetsOnly = false) {
    const px = 1 / this.scale, pulse = 0.5 + 0.5 * Math.sin(time * 4);
    ctx.save();
    this.gridT(ctx);
    ctx.lineJoin = 'round';
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.lineDashOffset = -time * 12 * px;
    ctx.lineWidth = 1.8 * px;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    for (const t of targets) ctx.stroke(this.segP[t]);
    ctx.setLineDash([]);
    if (targetsOnly) { ctx.restore(); return; }
    ctx.lineWidth = (7 + 4 * pulse) * px;
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.2 * pulse})`;
    ctx.stroke(this.segP[id]);
    ctx.lineWidth = 4.5 * px;
    ctx.strokeStyle = '#fff';
    ctx.stroke(this.segP[id]);
    ctx.lineWidth = 2.2 * px;
    ctx.strokeStyle = css(color);
    ctx.stroke(this.segP[id]);
    ctx.restore();
  }

  // styleOf(segId) -> { color: [r,g,b] | null, fill: 0..1, building?: type }
  // only the layers whose inputs changed are rebuilt on the next draw
  paint(styleOf) {
    this.styleOf = styleOf;
    this.st = this.map.segs.map((s) => styleOf(s.id));
    const bkey = this.st.map((s) => (s.building ? s.building + (s.color ?? '') : '')).join('|');
    const okey = this.st.map((s) => (s.color ? s.color.join(',') + ':' + s.fill : '')).join('|');
    if (bkey !== this.bkey) { this.bkey = bkey; this.layerGround = this.layerObjects = null; }
    if (okey !== this.okey) { this.okey = okey; this.layerOwner = null; }
  }

  // clear and draw all layers; returns ctx in css-pixel units
  drawBase() {
    if (!this.under) this.buildUnder();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.under, 0, 0);
    if (this.st) {
      if (!this.layerGround) this.buildGroundLayer();
      if (!this.layerOwner) this.buildOwnerLayer();
      if (!this.layerObjects) this.buildObjectLayer();
      ctx.drawImage(this.layerGround, 0, 0);
      ctx.drawImage(this.layerOwner, 0, 0);
      ctx.drawImage(this.layerObjects, 0, 0);
    }
    this.cssT(ctx);
    return ctx;
  }

  // segment under a screen point (-1 for sea)
  segAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const g = this.map.grid;
    const x = Math.floor((clientX - r.left) / this.scale);
    const y = Math.floor((clientY - r.top - this.oy) / (this.scale * this.tilt));
    if (x < 0 || y < 0 || x >= g || y >= g) return -1;
    const id = this.map.ids[y * g + x];
    if (id >= 0) return id;
    // tapped just off the coast: take the nearest segment label within reach
    let best = -1, bd = (g * 0.06) ** 2;
    for (const s of this.map.segs) {
      const dd = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (dd < bd) { bd = dd; best = s.id; }
    }
    return best;
  }
}

// outlined text, readable on any colour
export function label(ctx, text, x, y, size, color = '#fff', weight = 800) {
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size / 4);
  ctx.strokeStyle = 'rgba(25,35,40,0.6)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// troop count badge: white rounded pill with an owner-coloured rim and a soft drop shadow
export function pill(ctx, text, x, y, size, rim, ink) {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  const w = Math.max(size * 1.6, ctx.measureText(text).width + size * 0.9), h = size * 1.4;
  ctx.fillStyle = 'rgba(20,30,35,0.22)';
  roundRect(ctx, x - w / 2 + 1, y - h / 2 + 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.93)';
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.14);
  ctx.strokeStyle = rim;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + size * 0.04);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
