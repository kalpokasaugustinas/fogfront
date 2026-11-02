// map renderer in a soft "island diorama" style:
// misty sea, foam at the waterline, cliffs under the island edge, natural ground colours,
// owner colours as glowing segment borders, low-poly trees on top.
// layers: under (sea, shadow, foam, cliff; display-res, cached) -> top (ground + owner tint,
// grid-res raster, repainted on ownership change) -> over (trees; display-res, cached)
import { themes } from './config.js?v=9';

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

export class MapView {
  constructor(canvas, map, theme) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setMap(map, theme);
    // follow the container size (screen rotation, panel changes)
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  setMap(map, theme = 'summer') {
    this.map = map;
    this.theme = themes[theme] ?? themes.summer;
    const g = map.grid;
    this.k = g / 480;   // feature sizes are tuned for a 480 grid
    this.top = document.createElement('canvas');
    this.top.width = this.top.height = g;
    this.tctx = this.top.getContext('2d');
    this.img = this.tctx.createImageData(g, g);
    this.buildGround();
    this.buildSilhouette();
    this.placeTrees();
    // sea + soft light around the island live on the container, so there's no square edge
    const sl = this.theme.seaLight;
    this.canvas.parentElement.style.background =
      `radial-gradient(circle at 50% 50%, rgb(${sl}) 0%, ${this.theme.sea} 65%)`;
    this.under = this.over = null;   // cached layers belong to the old map
    this.resize();
  }

  // fit a square canvas into the parent element; cached display-res layers are rebuilt lazily
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.max(50, Math.floor(Math.min(r.width, r.height)));
    const dpr = window.devicePixelRatio || 1;
    if (size === this.size && dpr === this.dpr && this.under) return;
    this.size = size;
    this.dpr = dpr;
    this.scale = size / this.map.grid;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = this.canvas.style.height = size + 'px';
    this.under = this.over = null;
  }

  // per-cell ground colour (land + mountains), independent of owners
  buildGround() {
    const { ids, terrain, relief, near, nearType, grid: g, segs } = this.map, t = this.theme;
    const seed = (this.seed = (segs.length * 7919 + Math.round(segs[0].x * 31)) | 0);
    const gr = (this.ground = new Uint8ClampedArray(g * g * 4));
    const isMtn = (c) => terrain && terrain[c] === 2;
    const solid = (c) => c >= 0 && c < g * g && (ids[c] >= 0 || isMtn(c));
    const h = (c) => (c >= 0 && c < g * g && isMtn(c) ? relief[c] : 0);
    for (let c = 0; c < g * g; c++) {
      const x = c % g, y = Math.floor(c / g), o = c * 4;
      let col;
      if (ids[c] >= 0) {
        // grass/earth patches from two noise octaves
        const n = vnoise(x / (22 * this.k), y / (22 * this.k), seed) * 0.7 + vnoise(x / (6 * this.k), y / (6 * this.k), seed + 1) * 0.3;
        col = mix(t.groundA, t.groundB, n);
        if (near && near[c]) col = mix(col, nearType[c] === 1 ? t.shore : t.scree, 0.5 * (1 - (near[c] - 1) / 10) ** 1.5);
        // light lip along the cliff edge (land next to sea or lake)
        const edge = !solid(x > 0 ? c - 1 : -1) || !solid(x < g - 1 ? c + 1 : -1) || !solid(c - g) || !solid(c + g);
        if (edge) col = mix(col, t.lip, 0.55);
      } else if (isMtn(c)) {
        // rock: dark base -> light top, caps on the highest points, lit from the north-west
        const k = relief[c];
        col = k > t.capAt ? t.cap : mix(t.rockDark, t.rockLight, Math.min(1, k / t.capAt));
        const dx = h(x < g - 1 ? c + 1 : c) - h(x > 0 ? c - 1 : c), dy = h(c + g) - h(c - g);
        col = shade(col, Math.max(-0.35, Math.min(0.25, (dx + dy) * 2.4 / this.k)));
      } else continue;
      gr[o] = col[0]; gr[o + 1] = col[1]; gr[o + 2] = col[2]; gr[o + 3] = 255;
    }
  }

  // white masks: sil = land + mountains (lakes are holes, for cliffs), outer = sil + lakes
  // (for shadow and foam, so foam stays outside the coast), lakes = lake water only
  buildSilhouette() {
    const { grid: g, terrain } = this.map;
    const mask = (test) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = g;
      const x = cv.getContext('2d'), im = x.createImageData(g, g);
      for (let c = 0; c < g * g; c++) if (test(c)) { const o = c * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = im.data[o + 3] = 255; }
      x.putImageData(im, 0, 0);
      return cv;
    };
    const lake = (c) => terrain && terrain[c] === 1;
    this.sil = mask((c) => this.ground[c * 4 + 3]);
    this.outer = mask((c) => this.ground[c * 4 + 3] || lake(c));
    this.lakes = mask(lake);
  }

  // copy of a mask (default: the island silhouette) in one colour
  tint(col, src = this.sil) {
    const c = document.createElement('canvas');
    c.width = c.height = this.map.grid;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = css(col);
    x.fillRect(0, 0, c.width, c.height);
    return c;
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
    const clusters = Math.round((land / (g * g)) * 45 * t.trees);
    let i = 0;
    for (let n = 0, tries = 0; n < clusters && tries < clusters * 30; tries++) {
      const cx = hash(i++, 1, this.seed) * g, cy = hash(i++, 2, this.seed) * g;
      if (!ok(cx, cy)) continue;
      n++;
      // a cluster = a small wood: 6-17 trees packed together
      const count = 6 + Math.floor(hash(i++, 3, this.seed) * 12);
      for (let j = 0; j < count; j++) {
        const a = hash(i++, 4, this.seed) * Math.PI * 2, d = Math.sqrt(hash(i++, 5, this.seed)) * 14 * k;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (ok(x, y)) this.trees.push({ x, y, r: (3.4 + hash(i++, 6, this.seed) * 2.2) * k });
      }
    }
    this.trees.sort((a, b) => a.y - b.y);   // draw back to front
  }

  newLayer() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const x = c.getContext('2d');
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.imageSmoothingQuality = 'high';
    return [c, x];
  }

  // sea glow, drop shadow, foam rings and the cliff face
  buildUnder() {
    const [c, x] = this.newLayer(), t = this.theme, s = this.size;
    const ch = Math.max(3, s * 0.018);   // cliff height in css px
    this.ch = ch;
    // soft shadow in the water
    x.filter = `blur(${s * 0.02}px)`;
    x.globalAlpha = 0.35;
    x.drawImage(this.tint(t.shadow, this.outer), s * 0.01, ch + s * 0.02, s, s);
    // wide faint foam halo, then a crisp foam rim at the waterline (outline dilated by offsets)
    x.globalAlpha = 0.35;
    x.filter = `blur(${s * 0.025}px)`;
    const foam = this.tint(t.foam, this.outer);
    x.drawImage(foam, 0, ch, s, s);
    x.filter = `blur(${Math.max(0.6, s * 0.0025)}px)`;
    x.globalAlpha = 0.9;
    const e = Math.max(1.5, s * 0.006);
    for (let a = 0; a < 8; a++) x.drawImage(foam, Math.cos(a * Math.PI / 4) * e, ch + Math.sin(a * Math.PI / 4) * e, s, s);
    x.filter = 'none';
    x.globalAlpha = 1;
    // lakes: water back in (sea colour, a bit deeper), with a light rim along the shore
    const sea = hexToRgb(t.sea);
    x.filter = `blur(${Math.max(0.6, s * 0.003)}px)`;
    x.drawImage(this.tint(t.foam, this.lakes), 0, ch * 0.6, s, s);
    x.filter = 'none';
    x.drawImage(this.tint(shade(sea, -0.08), this.lakes), 0, ch + e * 0.8, s, s);
    // cliff: dark at the waterline, lighter toward the top edge
    const dark = this.tint(t.cliffDark), light = this.tint(t.cliffLight);
    x.drawImage(dark, 0, ch, s, s);
    for (let i = ch - 1; i >= 1; i -= 0.5) x.drawImage(i > ch * 0.45 ? dark : light, 0, i, s, s);
    this.under = c;
  }

  // trees: round crowns or low-poly pines, with a small shadow
  buildOver() {
    const [c, x] = this.newLayer(), t = this.theme, sc = this.scale;
    for (const tr of this.trees) {
      const px = tr.x * sc, py = tr.y * sc, r = Math.max(1.6, tr.r * sc);
      x.fillStyle = 'rgba(20,30,30,0.22)';
      x.beginPath(); x.ellipse(px + r * 0.45, py + r * 0.35, r * 1.05, r * 0.55, 0, 0, Math.PI * 2); x.fill();
      if (t.tree === 'pine') {
        const top = py - r * 2.4, base = py + r * 0.3, hw = r * 0.95;
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
        x.beginPath(); x.arc(px, py - r * 0.4, r, 0, Math.PI * 2); x.fill();
        x.fillStyle = css(t.treeLight);
        x.beginPath(); x.arc(px - r * 0.3, py - r * 0.75, r * 0.55, 0, Math.PI * 2); x.fill();
      }
    }
    this.over = c;
  }

  // styleOf(segId) -> { color: [r,g,b] | null, fill: 0..1 }
  //   color = owner colour: thin dark border, strong colour band, glow fading inward, light fill
  //   null  = neutral: ground with a soft line; fill > 0 = whitish highlight (e.g. a valid target)
  paint(styleOf) {
    const { ids, bdist, grid: g, segs } = this.map, d = this.img.data, gr = this.ground, t = this.theme;
    const st = segs.map((s) => styleOf(s.id));
    const band = 2.2 * this.k, fade = 9 * this.k;
    for (let c = 0; c < g * g; c++) {
      const o = c * 4;
      if (!gr[o + 3]) { d[o + 3] = 0; continue; }
      let col = [gr[o], gr[o + 1], gr[o + 2]];
      const id = ids[c];
      if (id >= 0) {
        const s = st[id], b = bdist ? bdist[c] : 9;
        if (s.color) {
          if (b < 1) col = mix(col, shade(s.color, -0.35), 0.9);
          else if (b <= band) col = mix(col, s.color, 0.88);
          else col = mix(col, s.color, s.fill + (0.6 - s.fill) * Math.max(0, 1 - (b - band) / fade));
        } else {
          if (b < 1) col = mix(col, t.lineNeutral, 0.5);
          else if (b < 2) col = mix(col, t.lineNeutral, 0.15);
          if (s.fill) col = mix(col, [255, 255, 255], s.fill * (b <= band ? 1.6 : 1));
        }
      }
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
    this.tctx.putImageData(this.img, 0, 0);
  }

  // clear and draw all layers; returns ctx in css-pixel units
  drawBase() {
    if (!this.under) this.buildUnder();
    if (!this.over) this.buildOver();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(this.under, 0, 0, this.size, this.size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.top, 0, 0, this.size, this.size);
    ctx.drawImage(this.over, 0, 0, this.size, this.size);
    return ctx;
  }

  // grid coords -> css pixels
  px(v) { return v * this.scale; }

  // segment under a screen point (-1 for sea)
  segAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const g = this.map.grid;
    const x = Math.floor(((clientX - r.left) / r.width) * g);
    const y = Math.floor(((clientY - r.top) / r.height) * g);
    if (x < 0 || y < 0 || x >= g || y >= g) return -1;
    const id = this.map.ids[y * g + x];
    if (id >= 0) return id;
    // tapped the sea right next to the coast: take the nearest segment label within reach
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
