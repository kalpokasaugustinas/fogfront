// menu mascots: two small bands of foglets (blue left, red right) hopping and shouting at each
// other across the menu. each foglet is a round little fighter in its team colour with an angry face,
// a shaking weapon and its own kit (soldier, knight, viking, archer). drawn on two small canvases
// every menu frame; nothing here touches the game
import { hexToRgb, shade } from './render.js?v=56';

const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const shouts = ['Grr!', 'Hey!', '!!', 'Ours!', 'Back off!', 'Charge!', 'Mine!'];

// band = { canvas, color, styles, face: 1 (looks right) | -1 (looks left), seed }
export function makeBand(canvas, color, styles, face, seed) {
  return { canvas, col: hexToRgb(color), styles, face, seed, bubbles: styles.map(() => ({ text: '', until: 0, next: 1 + seed * 0.7 })) };
}

// draw one band at time t (seconds)
export function drawBand(b, t) {
  const c = b.canvas, dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  const n = b.styles.length, u = Math.min(h / 60, w / (n * 21));   // size unit: a foglet is ~20u wide, ~30u tall
  // back row first (smaller, higher), front foglet nearest the menu centre
  const order = [...b.styles.keys()].sort((i, j) => (i % 2) - (j % 2)), talk = [];   // bubbles drawn last, over everyone
  for (const i of order) {
    const back = i % 2 === 1;
    const k = n === 1 ? 0.5 : i / (n - 1);
    // the foglet closest to the centre stands front and first
    const px = b.face > 0 ? w * (0.22 + 0.56 * k) : w * (0.78 - 0.56 * k);
    const gy = h * (back ? 0.72 : 0.92), sc = u * (back ? 0.86 : 1);
    // hop: each foglet on its own rhythm, angrier (higher, faster) now and then
    const ph = b.seed * 1.7 + i * 2.1, rage = 0.5 + 0.5 * Math.max(0, Math.sin(t * 0.7 + ph));
    const cyc = (t * (2.1 + 0.9 * rage) + ph) % 1, air = Math.sin(Math.PI * Math.min(1, cyc / 0.7));
    const hop = cyc < 0.7 ? air * (6 + 8 * rage) * sc : 0;
    const squash = cyc >= 0.7 ? 1 - 0.18 * Math.sin(Math.PI * (cyc - 0.7) / 0.3) : 1 + 0.06 * air;
    foglet(x, px, gy, sc, b.col, b.styles[i], b.face, t + ph, hop, squash, rage);
    // shout bubbles, one at a time per foglet
    const bub = b.bubbles[i];
    if (t > bub.next) { bub.text = shouts[Math.floor((t * 7 + i * 3 + b.seed * 5) % shouts.length)]; bub.until = t + 1.1; bub.next = t + 2.5 + ((i * 1.3 + b.seed) % 2.2); }
    if (t < bub.until) talk.push([px + b.face * 7 * sc, gy - hop - 36 * sc, sc, bub.text, 1 - Math.max(0, (t - bub.until + 0.25) / 0.25)]);
  }
  for (const [bx, by, s, text, a] of talk) bubble(x, bx, by, s, text, a, w);
}

// one foglet standing on (px, gy); s = size unit, f = facing (1 right, -1 left)
function foglet(x, px, gy, s, col, style, f, t, hop, squash, rage) {
  const dark = shade(col, -0.45), mid = shade(col, -0.2), light = shade(col, 0.35);
  const ink = 'rgba(28,24,30,0.95)';
  x.save();
  // ground shadow shrinks while in the air
  x.fillStyle = `rgba(20,30,35,${0.25 - Math.min(0.15, hop / (s * 60))})`;
  x.beginPath(); x.ellipse(px, gy, 9 * s * (1 - hop / (s * 50)), 2.4 * s, 0, 0, Math.PI * 2); x.fill();
  x.translate(px, gy - hop);
  x.scale(f * (2 - squash) * 0.5 + f * 0.5, squash);   // squash and stretch, mirrored to face the foe
  const lw = 1.4 * s;
  x.lineJoin = 'round'; x.lineCap = 'round';
  // feet
  x.fillStyle = rgb(dark);
  for (const fx of [-4.2, 4.2]) { x.beginPath(); x.ellipse(fx * s, -1.2 * s, 3.2 * s, 2 * s, 0, 0, Math.PI * 2); x.fill(); }
  // back arm (shield / bow side)
  const shake = Math.sin(t * (14 + 10 * rage)) * (0.25 + 0.35 * rage);
  // body: a soft bean with a dark outline and a lighter belly
  const body = new Path2D();
  body.moveTo(-9 * s, -9 * s);
  body.bezierCurveTo(-10 * s, -24 * s, 10 * s, -24 * s, 9 * s, -9 * s);
  body.bezierCurveTo(9 * s, -2 * s, -9 * s, -2 * s, -9 * s, -9 * s);
  x.fillStyle = rgb(col); x.fill(body);
  x.fillStyle = rgb(light, 0.5); x.beginPath(); x.ellipse(1.5 * s, -7.5 * s, 5 * s, 3.6 * s, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = rgb(mid, 0.5); x.beginPath(); x.ellipse(-6 * s, -10 * s, 2.5 * s, 5 * s, 0.2, 0, Math.PI * 2); x.fill();
  x.strokeStyle = rgb(dark); x.lineWidth = lw; x.stroke(body);
  // face (looks toward the foe: +x)
  const ey = -15.5 * s;
  for (const [ex, er] of [[0.8, 2.5], [6.2, 2.2]]) {
    x.fillStyle = '#fff'; x.beginPath(); x.ellipse(ex * s, ey, er * s, er * 1.15 * s, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = ink; x.beginPath(); x.arc((ex + 0.9) * s, ey + 0.4 * s, er * 0.5 * s, 0, Math.PI * 2); x.fill();
  }
  // angry brows: slanted down toward the middle, twitching
  const tw = Math.sin(t * 9) * 0.4 * s;
  x.strokeStyle = ink; x.lineWidth = 1.5 * s;
  x.beginPath(); x.moveTo(-1.9 * s, ey - 3.6 * s - tw); x.lineTo(2.8 * s, ey - 1.9 * s); x.stroke();
  x.beginPath(); x.moveTo(8.4 * s, ey - 3.4 * s - tw); x.lineTo(4.4 * s, ey - 1.9 * s); x.stroke();
  // mouth: shouting (open) in rage, a grimace otherwise
  if (rage > 0.55) {
    x.fillStyle = ink; x.beginPath(); x.ellipse(4 * s, -10.2 * s, 2.1 * s, (1 + 1.3 * rage) * s, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#e0656b'; x.beginPath(); x.ellipse(4 * s, -9.4 * s, 1.2 * s, 0.6 * s, 0, 0, Math.PI * 2); x.fill();
  } else {
    x.strokeStyle = ink; x.lineWidth = 1.2 * s;
    x.beginPath(); x.moveTo(1.8 * s, -9.6 * s); x.quadraticCurveTo(4 * s, -11.4 * s, 6.4 * s, -9.6 * s); x.stroke();
  }
  // kit: headgear + weapon arm (shaking at the foe)
  gear(x, s, style, col, dark, shake, rage);
  x.restore();
  // anger mark above the head when furious
  if (rage > 0.7) {
    x.save();
    x.translate(px - f * 6 * s, gy - hop - 27 * s);
    x.strokeStyle = '#e0312b'; x.lineWidth = 1.3 * s;
    const a = 2.2 * s * (0.8 + 0.3 * Math.sin(t * 12));
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      x.beginPath(); x.moveTo(dx * a * 0.35, dy * a); x.quadraticCurveTo(dx * a * 0.35, dy * a * 0.35, dx * a, dy * a * 0.35); x.stroke();
    }
    x.restore();
  }
}

// headgear and weapon per style (in the foglet's local, facing-right frame)
function gear(x, s, style, col, dark, shake, rage) {
  const steel = '#b9c2cb', steelDark = '#7d8894', wood = '#8a5a34', woodDark = '#5e3b20';
  x.lineWidth = 1.2 * s;
  // weapon arm: a stub from the front side, raised and shaking
  const arm = (draw) => {
    x.save();
    x.translate(8 * s, -10 * s);
    x.rotate(-0.9 - 0.5 * rage + shake);
    draw();
    x.fillStyle = rgb(col); x.strokeStyle = rgb(dark);
    x.beginPath(); x.ellipse(1.5 * s, 0, 2.6 * s, 2 * s, 0, 0, Math.PI * 2); x.fill(); x.stroke();   // fist
    x.restore();
  };
  if (style === 'knight') {
    // round steel helm with a red plume; kite shield on the near side; sword
    x.fillStyle = steel; x.strokeStyle = steelDark;
    x.beginPath(); x.moveTo(-8.6 * s, -16 * s); x.bezierCurveTo(-8 * s, -26 * s, 8.6 * s, -26 * s, 8.8 * s, -17 * s); x.lineTo(-8.6 * s, -16 * s); x.fill(); x.stroke();
    x.fillStyle = '#d1403a'; x.beginPath(); x.ellipse(-2 * s, -25.5 * s, 4 * s, 1.8 * s, -0.4, 0, Math.PI * 2); x.fill();
    arm(() => { x.fillStyle = steel; x.strokeStyle = steelDark; x.fillRect(1 * s, -1 * s, 11 * s, 2 * s); x.strokeRect(1 * s, -1 * s, 11 * s, 2 * s);
      x.fillStyle = woodDark; x.fillRect(0, -2.6 * s, 1.4 * s, 5.2 * s); });
    x.fillStyle = steel; x.strokeStyle = rgb(dark);
    x.beginPath(); x.moveTo(-10.5 * s, -14 * s); x.lineTo(-4.5 * s, -14 * s); x.lineTo(-4.8 * s, -7 * s); x.lineTo(-7.5 * s, -3.5 * s); x.lineTo(-10.2 * s, -7 * s); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = rgb(col); x.fillRect(-8.1 * s, -13 * s, 1.2 * s, 7.5 * s);
  } else if (style === 'viking') {
    // horned helm, round wooden shield, axe
    x.fillStyle = steelDark; x.strokeStyle = '#4e5660';
    x.beginPath(); x.moveTo(-8 * s, -17 * s); x.bezierCurveTo(-7 * s, -25 * s, 8 * s, -25 * s, 8.4 * s, -17.5 * s); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = '#f4ead2'; x.strokeStyle = '#b8aa88';
    for (const d of [-1, 1]) { x.beginPath(); x.moveTo(d * 6.5 * s + 0.5 * s, -20 * s); x.quadraticCurveTo(d * 12 * s, -22 * s, d * 11 * s, -28 * s); x.quadraticCurveTo(d * 9.5 * s, -23 * s, d * 5 * s, -21.5 * s); x.closePath(); x.fill(); x.stroke(); }
    arm(() => { x.fillStyle = wood; x.fillRect(0, -0.8 * s, 11 * s, 1.6 * s);
      x.fillStyle = steel; x.strokeStyle = steelDark; x.beginPath(); x.moveTo(9 * s, -0.8 * s); x.quadraticCurveTo(13 * s, -5 * s, 13.5 * s, -0.5 * s); x.quadraticCurveTo(13 * s, 4 * s, 9 * s, 0.8 * s); x.closePath(); x.fill(); x.stroke(); });
    x.fillStyle = wood; x.strokeStyle = woodDark;
    x.beginPath(); x.arc(-8.5 * s, -9 * s, 5 * s, 0, Math.PI * 2); x.fill(); x.stroke();
    x.fillStyle = rgb(col); x.beginPath(); x.arc(-8.5 * s, -9 * s, 1.8 * s, 0, Math.PI * 2); x.fill();
  } else if (style === 'archer') {
    // pointed hood, bow held up in front, a feather
    x.fillStyle = rgb(dark, 0.9); x.strokeStyle = rgb(dark);
    x.beginPath(); x.moveTo(-9 * s, -14 * s); x.bezierCurveTo(-10 * s, -24 * s, 2 * s, -27 * s, -6 * s, -31 * s); x.bezierCurveTo(6 * s, -27 * s, 10 * s, -22 * s, 9 * s, -15 * s);
    x.bezierCurveTo(5 * s, -21 * s, -4 * s, -21 * s, -9 * s, -14 * s); x.fill();
    x.fillStyle = '#7cb32a'; x.beginPath(); x.ellipse(-7 * s, -24 * s, 1.1 * s, 3.4 * s, -0.6, 0, Math.PI * 2); x.fill();
    arm(() => { x.strokeStyle = wood; x.lineWidth = 1.4 * s; x.beginPath(); x.arc(5 * s, 0, 7 * s, -Math.PI * 0.42, Math.PI * 0.42); x.stroke();
      x.strokeStyle = 'rgba(240,235,220,0.95)'; x.lineWidth = 0.5 * s; x.beginPath(); x.moveTo(7.2 * s, -6.6 * s); x.lineTo(7.2 * s, 6.6 * s); x.stroke(); });
  } else {
    // soldier: kettle helmet with a wide brim, spear
    x.fillStyle = steel; x.strokeStyle = steelDark;
    x.beginPath(); x.ellipse(0.5 * s, -19.5 * s, 11 * s, 2.2 * s, -0.05, 0, Math.PI * 2); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(-6 * s, -19.5 * s); x.bezierCurveTo(-5 * s, -26.5 * s, 6 * s, -26.5 * s, 7 * s, -19.5 * s); x.closePath(); x.fill(); x.stroke();
    arm(() => { x.fillStyle = wood; x.fillRect(-6 * s, -0.7 * s, 20 * s, 1.4 * s);
      x.fillStyle = steel; x.strokeStyle = steelDark; x.beginPath(); x.moveTo(14 * s, -2 * s); x.lineTo(18.5 * s, 0); x.lineTo(14 * s, 2 * s); x.closePath(); x.fill(); x.stroke(); });
  }
}

// speech bubble with a short shout
// kept inside the canvas (w wide, top at 0) so it's never cut off
function bubble(x, bx, by, s, text, alpha, cw) {
  x.save();
  x.globalAlpha = Math.max(0, alpha);
  x.font = `800 ${Math.round(7.5 * s)}px Fredoka, system-ui, sans-serif`;
  const w = x.measureText(text).width + 7 * s, h = 11 * s;
  const tip = bx;
  bx = Math.min(cw - w / 2 - 2, Math.max(w / 2 + 2, bx));
  by = Math.max(h + 2, by);
  x.fillStyle = '#fff'; x.strokeStyle = 'rgba(40,40,50,0.85)'; x.lineWidth = 1.1 * s;
  x.beginPath(); x.roundRect(bx - w / 2, by - h, w, h, 4 * s); x.fill(); x.stroke();
  const tx = Math.min(bx + w / 2 - 4 * s, Math.max(bx - w / 2 + 4 * s, tip));   // tail points at the speaker
  x.beginPath(); x.moveTo(tx - 2 * s, by - 0.5 * s); x.lineTo(tx, by + 3 * s); x.lineTo(tx + 2 * s, by - 0.5 * s); x.fill();
  x.fillStyle = '#2a2530'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, bx, by - h / 2 + 0.3 * s);
  x.restore();
}
