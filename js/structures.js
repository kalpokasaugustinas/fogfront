// building scenes: when a segment has a building, the whole segment turns into a small diorama.
// two passes per segment, both in css pixels with the segment path as clip where needed:
//   ground(...) = flat things under the owner tint (fields, courtyards, plazas, gardens)
//   top(...)    = standing things above everything (houses, walls, towers, soldiers, flags)
// view gives: scale, size, theme, seed, segP (paths), spots(id, n, sep) and edgeSpots(id, sep)

const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const dk = (c, k) => c.map((v) => v * (1 - k));
const lt = (c, k) => c.map((v) => v + (255 - v) * k);

// tiny deterministic random from (i, j, seed)
function rnd(i, j, s) {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(j + 7, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const stone = [196, 192, 182], stoneDark = [140, 136, 128], roofRed = [178, 92, 70], wallWhite = [244, 240, 230];

// clip to a segment path (paths are in grid units, drawing continues in css px)
function clipSeg(v, x, id) {
  v.gridT(x);
  x.clip(v.segP[id]);
  v.cssT(x);
}

function shadow(x, cx, cy, rx, ry) {
  x.fillStyle = 'rgba(20,30,30,0.25)';
  x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); x.fill();
}

// gabled house seen from the front-top: wall, door, two-tone roof
function house(x, cx, cy, u, wall = wallWhite, roof = roofRed, w = 2.4, h = 1.3) {
  w *= u; h *= u;
  const rh = u * 1.2;
  shadow(x, cx + u * 0.5, cy + u * 0.15, w * 0.7, u * 0.5);
  x.fillStyle = css(wall);
  x.fillRect(cx - w / 2, cy - h, w, h);
  x.fillStyle = css(dk(wall, 0.15));
  x.fillRect(cx + w * 0.2, cy - h, w * 0.3, h);
  x.fillStyle = css(dk(roof, 0.35));
  x.fillRect(cx - u * 0.25, cy - h * 0.6, u * 0.5, h * 0.6);   // door
  x.fillStyle = css(roof);
  x.beginPath(); x.moveTo(cx - w / 2 - u * 0.2, cy - h); x.lineTo(cx - w * 0.15, cy - h - rh); x.lineTo(cx + w * 0.35, cy - h - rh); x.lineTo(cx + w / 2 + u * 0.2, cy - h); x.fill();
  x.fillStyle = css(dk(roof, 0.2));
  x.beginPath(); x.moveTo(cx + w * 0.35, cy - h - rh); x.lineTo(cx + w / 2 + u * 0.2, cy - h); x.lineTo(cx + w * 0.1, cy - h); x.lineTo(cx - w * 0.05, cy - h - rh * 0.4); x.closePath(); x.fill();
}

// square stone tower with battlements; returns its top y
function tower(x, cx, cy, u, w, h, col = stone) {
  w *= u; h *= u;
  shadow(x, cx + u * 0.6, cy + u * 0.1, w * 0.8, u * 0.55);
  x.fillStyle = css(col);
  x.fillRect(cx - w / 2, cy - h, w, h);
  x.fillStyle = css(dk(col, 0.22));
  x.fillRect(cx + w * 0.15, cy - h, w * 0.35, h);
  const m = Math.max(2, Math.round(w / (u * 0.7)));
  for (let i = 0; i < m; i += 2) {
    x.fillStyle = css(i * (w / m) > w * 0.65 ? dk(col, 0.22) : col);
    x.fillRect(cx - w / 2 + i * (w / m), cy - h - u * 0.45, w / m, u * 0.45);
  }
  x.fillStyle = 'rgba(40,40,50,0.7)';
  x.fillRect(cx - u * 0.15, cy - h * 0.7, u * 0.3, u * 0.45);   // window slit
  return cy - h - u * 0.45;
}

function flag(x, px, py, u, color) {
  x.strokeStyle = 'rgba(60,50,40,0.9)';
  x.lineWidth = Math.max(1, u * 0.15);
  x.beginPath(); x.moveTo(px, py); x.lineTo(px, py - u * 2.2); x.stroke();
  x.fillStyle = css(color);
  x.beginPath(); x.moveTo(px, py - u * 2.2); x.lineTo(px + u * 1.4, py - u * 1.85); x.lineTo(px, py - u * 1.5); x.fill();
}

function soldier(x, cx, cy, u, color) {
  x.fillStyle = 'rgba(20,30,30,0.22)';
  x.fillRect(cx - u * 0.1, cy - u * 0.05, u * 0.55, u * 0.18);
  x.fillStyle = css(color);
  x.fillRect(cx - u * 0.22, cy - u * 0.75, u * 0.44, u * 0.75);
  x.fillStyle = css([236, 206, 176]);
  x.beginPath(); x.arc(cx, cy - u * 0.95, u * 0.22, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(70,60,50,0.9)';
  x.lineWidth = Math.max(0.6, u * 0.08);
  x.beginPath(); x.moveTo(cx + u * 0.3, cy); x.lineTo(cx + u * 0.3, cy - u * 1.6); x.stroke();   // spear
}

function tent(x, cx, cy, u, col, mark) {
  shadow(x, cx + u * 0.4, cy + u * 0.1, u * 1.2, u * 0.4);
  x.fillStyle = css(col);
  x.beginPath(); x.moveTo(cx - u * 1.1, cy); x.lineTo(cx, cy - u * 1.4); x.lineTo(cx + u * 1.1, cy); x.fill();
  x.fillStyle = css(dk(col, 0.18));
  x.beginPath(); x.moveTo(cx, cy - u * 1.4); x.lineTo(cx + u * 1.1, cy); x.lineTo(cx + u * 0.2, cy); x.fill();
  if (mark) cross(x, cx - u * 0.25, cy - u * 0.55, u * 0.32, mark);
}

function cross(x, cx, cy, s, col) {
  x.fillStyle = css(col);
  x.fillRect(cx - s, cy - s * 0.33, s * 2, s * 0.66);
  x.fillRect(cx - s * 0.33, cy - s, s * 0.66, s * 2);
}

// ---------- per building ----------

const fieldColors = [[226, 198, 112], [150, 172, 92], [176, 132, 92], [184, 196, 112], [212, 184, 96]];

export function ground(v, x, id, type, owner) {
  const s = v.map.segs[id], u = v.u, cx = v.sx(s.x), cy = v.sy(s.y), seed = v.seed + id * 31;
  const snow = v.theme === v.themes?.winter || v.theme.groundA[0] > 215;
  x.save();
  clipSeg(v, x, id);
  if (type === 'farm') {
    // patchwork of strips at a per-segment angle, with furrows and a dirt track
    x.translate(cx, cy);
    x.scale(1, v.tilt);   // fields lie flat on the tilted ground
    x.rotate(rnd(1, 1, seed) * Math.PI);
    const w = u * 2.6, R = v.size * 0.35;
    for (let i = -Math.ceil(R / w); i <= Math.ceil(R / w); i++) {
      for (let j = -3; j <= 3; j++) {
        let col = fieldColors[Math.floor(rnd(i, j, seed) * fieldColors.length)];
        if (snow) col = lt(col, 0.6);
        const len = R / 3;
        x.fillStyle = css(col);
        x.fillRect(i * w, j * len, w - u * 0.25, len - u * 0.25);
        x.strokeStyle = css(dk(col, 0.18), 0.6);
        x.lineWidth = Math.max(0.5, u * 0.08);
        for (let f = 1; f < 4; f++) { x.beginPath(); x.moveTo(i * w + f * w / 4, j * len); x.lineTo(i * w + f * w / 4, j * len + len - u * 0.25); x.stroke(); }
      }
    }
    x.strokeStyle = css(snow ? [214, 206, 196] : [196, 170, 128]);
    x.lineWidth = u * 0.5;
    x.beginPath(); x.moveTo(-R, u * 0.6); x.bezierCurveTo(-R / 3, -u * 3, R / 3, u * 4, R, -u); x.stroke();
  } else if (type === 'barracks' || type === 'fort') {
    // trampled courtyard around the main spot
    const [p] = v.spots(id, 1, 0);
    if (!p) { x.restore(); return; }
    x.fillStyle = css(snow ? [214, 214, 216] : [184, 164, 128], 0.75);
    x.beginPath(); x.ellipse(p[0], p[1] - u * 0.5, u * 6.5, u * 3.8, 0, 0, Math.PI * 2); x.fill();
  } else if (type === 'hospital') {
    // herb gardens: small green beds with flower dots
    for (const [px, py] of v.spots(id, 6, u * 4).slice(1)) {
      x.fillStyle = css([128, 160, 92]);
      x.fillRect(px - u * 1.2, py - u * 0.8, u * 2.4, u * 1.6);
      for (let k = 0; k < 5; k++) {
        x.fillStyle = css(k % 2 ? [236, 236, 240] : [220, 120, 140]);
        x.beginPath(); x.arc(px - u + rnd(k, 3, seed + px | 0) * u * 2, py - u * 0.6 + rnd(k, 4, seed + py | 0) * u * 1.2, u * 0.18, 0, Math.PI * 2); x.fill();
      }
    }
  } else if (type === 'capital') {
    // cobbled town square
    const [p] = v.spots(id, 1, 0);
    if (!p) { x.restore(); return; }
    x.fillStyle = css(snow ? [222, 222, 224] : [196, 186, 168]);
    x.beginPath(); x.ellipse(p[0], p[1] - u * 0.4, u * 7.5, u * 4.4, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = css(snow ? [206, 206, 210] : [176, 166, 148]);
    for (let i = 0; i < 40; i++) {
      const a = rnd(i, 21, seed) * Math.PI * 2, d = Math.sqrt(rnd(i, 22, seed));
      x.fillRect(p[0] + Math.cos(a) * d * u * 6.5, p[1] - u * 0.4 + Math.sin(a) * d * u * 3.6, u * 0.5, u * 0.3);
    }
  } else if (type === 'lab') {
    // paved plaza with a ring pattern
    const [p] = v.spots(id, 1, 0);
    if (!p) { x.restore(); return; }
    x.fillStyle = css([206, 204, 198]);
    x.beginPath(); x.ellipse(p[0], p[1] - u * 0.4, u * 6, u * 3.6, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = css([170, 168, 160]);
    x.lineWidth = Math.max(0.6, u * 0.12);
    x.beginPath(); x.ellipse(p[0], p[1] - u * 0.4, u * 4, u * 2.4, 0, 0, Math.PI * 2); x.stroke();
  }
  x.restore();
}

export function top(v, x, id, type, owner) {
  const u = v.u, seed = v.seed + id * 31, col = owner ?? [140, 140, 140];
  x.save();
  v.cssT(x);
  if (type === 'farm') {
    // farmhouses with haystacks
    for (const [i, [px, py]] of v.spots(id, 3, u * 6).entries()) {
      house(x, px, py, u, wallWhite, i === 0 ? roofRed : [150, 120, 80]);
      x.fillStyle = css([224, 190, 100]);
      x.beginPath(); x.arc(px + u * 2.4, py - u * 0.4, u * 0.6, Math.PI, 0); x.fill();
    }
  } else if (type === 'fort') {
    // stone wall along the segment edge with round towers, keep in the middle
    x.save();
    v.gridT(x);
    x.clip(v.segP[id]);
    const wpx = (u * 0.9) / v.scale;
    x.lineJoin = 'round';
    x.lineWidth = wpx * 2.6;
    x.strokeStyle = css(stoneDark);
    x.stroke(v.segP[id]);
    x.lineWidth = wpx * 2;
    x.strokeStyle = css(stone);
    x.stroke(v.segP[id]);
    x.setLineDash([wpx * 0.7, wpx * 0.7]);
    x.lineWidth = wpx * 0.8;
    x.strokeStyle = css(lt(stone, 0.35));
    x.stroke(v.segP[id]);
    x.restore();
    for (const [px, py] of v.edgeSpots(id, u * 9)) {
      shadow(x, px + u * 0.5, py + u * 0.2, u * 1.1, u * 0.45);
      x.fillStyle = css(stoneDark);
      x.fillRect(px - u * 0.9, py - u * 2.2, u * 1.8, u * 2.2);
      x.fillStyle = css(stone);
      x.fillRect(px - u * 0.9, py - u * 2.2, u * 1.1, u * 2.2);
      x.fillStyle = css(lt(stone, 0.2));
      x.beginPath(); x.ellipse(px, py - u * 2.2, u * 0.9, u * 0.4, 0, 0, Math.PI * 2); x.fill();
    }
    const [k] = v.spots(id, 1, 0);
    if (!k) { x.restore(); return; }
    const ty = tower(x, k[0], k[1], u, 2.6, 4);
    flag(x, k[0], ty, u, col);
  } else if (type === 'barracks') {
    // castle: two towers + hall with a gate, flag, tents and a formation of soldiers
    const [c, a, b] = v.spots(id, 3, u * 7);
    if (!c) { x.restore(); return; }
    const [px, py] = c;
    shadow(x, px + u, py + u * 0.2, u * 4.5, u * 0.8);
    x.fillStyle = css(stone);
    x.fillRect(px - u * 3, py - u * 2.4, u * 6, u * 2.4);
    x.fillStyle = css(dk(stone, 0.22));
    x.fillRect(px + u * 1, py - u * 2.4, u * 2, u * 2.4);
    x.fillStyle = 'rgba(50,40,40,0.85)';
    x.beginPath(); x.moveTo(px - u * 0.7, py); x.lineTo(px - u * 0.7, py - u * 1.1); x.arc(px, py - u * 1.1, u * 0.7, Math.PI, 0); x.lineTo(px + u * 0.7, py); x.fill();
    tower(x, px - u * 3.2, py, u, 1.8, 3.6);
    const t2 = tower(x, px + u * 3.2, py, u, 1.8, 3.6);
    flag(x, px + u * 3.2, t2, u, col);
    if (a) for (let i = 0; i < 2; i++) tent(x, a[0] + (i - 0.5) * u * 2.6, a[1], u, [226, 218, 200]);
    if (b) for (let r = 0; r < 3; r++) for (let q = 0; q < 5; q++) soldier(x, b[0] + (q - 2) * u * 0.9 + r * u * 0.3, b[1] + (r - 1) * u * 1.1, u, col);
  } else if (type === 'capital') {
    // walled town: wall along the segment edge, houses around a tall keep with a big flag
    x.save();
    v.gridT(x);
    x.clip(v.segP[id]);
    const wpx = (u * 0.7) / v.scale;
    x.lineJoin = 'round';
    x.lineWidth = wpx * 2.4;
    x.strokeStyle = css(stoneDark);
    x.stroke(v.segP[id]);
    x.lineWidth = wpx * 1.8;
    x.strokeStyle = css(lt(stone, 0.15));
    x.stroke(v.segP[id]);
    x.restore();
    const [c, ...homes] = v.spots(id, 7, u * 3.2);
    if (!c) { x.restore(); return; }
    const roofs = [roofRed, [150, 110, 80], [120, 130, 150], roofRed];
    for (const [i, h] of homes.entries()) house(x, h[0], h[1], u * 0.85, wallWhite, roofs[i % roofs.length]);
    const ty = tower(x, c[0], c[1], u, 3, 5.4, lt(stone, 0.1));
    tower(x, c[0] - u * 2.2, c[1] + u * 0.3, u, 1.5, 3.6);
    tower(x, c[0] + u * 2.2, c[1] + u * 0.3, u, 1.5, 3.6);
    flag(x, c[0], ty, u * 1.5, col);
  } else if (type === 'hospital') {
    // white infirmary with a red cross, medical tents
    const [c, ...rest] = v.spots(id, 3, u * 6);
    if (!c) { x.restore(); return; }
    house(x, c[0], c[1], u, wallWhite, [214, 214, 218], 4, 1.8);
    cross(x, c[0] - u * 0.8, c[1] - u * 3.1, u * 0.6, [214, 64, 60]);
    flag(x, c[0] + u * 2.2, c[1] - u * 1.8, u, col);
    for (const p of rest) tent(x, p[0], p[1], u, [242, 242, 238], [214, 64, 60]);
  } else if (type === 'lab') {
    // domed observatory, a tower with glowing windows, crystals
    const [c, a, b] = v.spots(id, 3, u * 6);
    if (!c) { x.restore(); return; }
    const [px, py] = c;
    shadow(x, px + u, py + u * 0.2, u * 3, u * 0.7);
    x.fillStyle = css([226, 224, 218]);
    x.fillRect(px - u * 2, py - u * 2.2, u * 4, u * 2.2);
    x.fillStyle = css([196, 194, 188]);
    x.fillRect(px + u * 0.6, py - u * 2.2, u * 1.4, u * 2.2);
    x.fillStyle = css([150, 170, 190]);
    x.beginPath(); x.arc(px, py - u * 2.2, u * 2, Math.PI, 0); x.fill();
    x.fillStyle = css([110, 130, 150]);
    x.beginPath(); x.arc(px, py - u * 2.2, u * 2, Math.PI * 1.5, 0); x.lineTo(px, py - u * 2.2); x.fill();
    x.strokeStyle = css([70, 80, 96]);
    x.lineWidth = u * 0.35;
    x.beginPath(); x.moveTo(px - u * 0.3, py - u * 3.4); x.lineTo(px + u * 1.4, py - u * 4.6); x.stroke();   // telescope
    flag(x, px - u * 1.8, py - u * 2.2, u, col);
    if (a) {
      const ty = tower(x, a[0], a[1], u, 1.6, 4.2, [210, 206, 214]);
      x.fillStyle = css([120, 230, 240]);
      for (let i = 0; i < 3; i++) x.fillRect(a[0] - u * 0.2, ty + u * (1 + i * 1.1), u * 0.4, u * 0.5);
    }
    if (b) for (let i = 0; i < 3; i++) {
      const bx = b[0] + (i - 1) * u * 1.2, by = b[1] + (i % 2) * u * 0.4, hgt = u * (1.4 + rnd(i, 9, seed) * 1.2);
      x.fillStyle = 'rgba(120,230,240,0.35)';
      x.beginPath(); x.arc(bx, by - hgt * 0.5, hgt * 0.7, 0, Math.PI * 2); x.fill();
      x.fillStyle = css([110, 210, 228]);
      x.beginPath(); x.moveTo(bx, by - hgt); x.lineTo(bx - u * 0.45, by - hgt * 0.4); x.lineTo(bx, by); x.lineTo(bx + u * 0.45, by - hgt * 0.4); x.fill();
      x.fillStyle = css([70, 170, 200]);
      x.beginPath(); x.moveTo(bx, by - hgt); x.lineTo(bx + u * 0.45, by - hgt * 0.4); x.lineTo(bx, by); x.fill();
    }
  }
  x.restore();
}
