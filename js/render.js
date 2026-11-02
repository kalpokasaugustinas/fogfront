// draws a generated map on a canvas. the map raster is painted once into a small
// offscreen canvas (only when colours change) and scaled up every frame.

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// mix colour toward white (k > 0) or black (k < 0)
export function shade([r, g, b], k) {
  const t = k > 0 ? 255 : 0, a = Math.abs(k);
  return [r + (t - r) * a, g + (t - g) * a, b + (t - b) * a];
}

export class MapView {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setMap(map);
    // follow the container size (screen rotation, panel changes)
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  setMap(map) {
    this.map = map;
    const g = map.grid;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = g;
    this.bctx = this.base.getContext('2d');
    this.img = this.bctx.createImageData(g, g);
    this.resize();
  }

  // fit a square canvas into the parent element
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.max(50, Math.floor(Math.min(r.width, r.height)));
    const dpr = window.devicePixelRatio || 1;
    this.size = size;
    this.dpr = dpr;
    this.scale = size / this.map.grid;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = this.canvas.style.height = size + 'px';
  }

  // colorOf(segId) -> [r, g, b]; borders and coast are drawn darker
  paint(colorOf) {
    const { ids, edge, grid: g, segs } = this.map, d = this.img.data;
    const cache = segs.map((s) => colorOf(s.id));
    const dark = cache.map((c) => shade(c, -0.55));
    for (let c = 0; c < g * g; c++) {
      const id = ids[c], o = c * 4;
      if (id < 0) { d[o + 3] = 0; continue; }
      const col = edge[c] ? dark[id] : cache[id];
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
    this.bctx.putImageData(this.img, 0, 0);
  }

  // clear and draw the painted map; returns ctx in css-pixel units
  drawBase() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.base, 0, 0, this.size, this.size);
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
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
