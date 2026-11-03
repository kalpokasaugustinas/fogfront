// menu mascots: two small bands of foglets (yours on the left, a rival band on the right) hopping and
// shouting at each other across the menu. each one is the in-game troop figure (drawFoglet, the
// same drawing as on the map) drawn big, with a tiny angry face added and more movement: slow
// hops, leaning in at the foe, shaking with rage. drawn on two small canvases every menu frame
import { drawFoglet, hexToRgb } from './render.js?v=58';

const shouts = ['Grr!', 'Hey!', '!!', 'Ours!', 'Back off!', 'Charge!', 'Mine!'];

// band = { canvas, color, styles, face: 1 (looks right) | -1 (looks left), seed }
export function makeBand(canvas, color, styles, face, seed) {
  return { canvas, col: hexToRgb(color), styles, face, seed, bubbles: styles.map((_, i) => ({ text: '', until: 0, next: 1 + seed * 0.7 + i * 0.9 })) };
}

// change a band's colour / kits (the player's band follows the commander profile)
export function dressBand(b, color, styles) { b.col = hexToRgb(color); b.styles = styles; }

// draw one band at time t (seconds)
export function drawBand(b, t) {
  const c = b.canvas, dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  const n = b.styles.length, s = Math.min(h / 11.5, w / (n * 4.4));   // figure scale: a foglet is ~3 x 8 units
  const talk = [];   // speech bubbles drawn last, over everyone
  // back row (odd) first, front row on top
  for (const i of [...b.styles.keys()].sort((p, q) => (q % 2) - (p % 2))) {
    const back = i % 2 === 1, k = n === 1 ? 0.5 : i / (n - 1);
    const sc = s * (back ? 0.85 : 1);
    const gx = b.face > 0 ? w * (0.2 + 0.6 * k) : w * (0.8 - 0.6 * k), gy = h * (back ? 0.8 : 0.95);
    // rage comes and goes; furious foglets hop higher, lean in further and shake
    const ph = b.seed * 1.7 + i * 2.1, rage = 0.5 + 0.5 * Math.max(0, Math.sin(t * 0.6 + ph));
    const cyc = (t * (1.05 + 0.45 * rage) + ph) % 1, air = cyc < 0.65 ? Math.sin(Math.PI * cyc / 0.65) : 0;
    const hop = air * (1.6 + 1.6 * rage) * sc;
    const squash = cyc >= 0.65 ? 1 - 0.16 * Math.sin(Math.PI * (cyc - 0.65) / 0.35) : 1 + 0.05 * air;
    const lunge = Math.max(0, Math.sin(t * 1.3 + ph * 2)) ** 3;   // now and then a step toward the foe
    const shake = rage > 0.75 ? Math.sin(t * 40 + i) * 0.12 * sc : 0;
    const lean = (0.08 + 0.18 * lunge + 0.06 * rage) * b.face + Math.sin(t * 3 + ph) * 0.04;
    const px = gx + b.face * lunge * 1.4 * sc + shake;
    figure(x, px, gy, sc, b.col, b.styles[i], b.face, hop, squash, lean, rage, t + ph);
    const bub = b.bubbles[i];
    // one speaker per band at a time, so bubbles never pile up
    if (t > bub.next && b.bubbles.some((o) => o !== bub && t < o.until)) bub.next = t + 0.6;
    if (t > bub.next) { bub.text = shouts[Math.floor((t * 7 + i * 3 + b.seed * 5) % shouts.length)]; bub.until = t + 1.2; bub.next = t + 2.8 + ((i * 1.3 + b.seed) % 2.4); }
    if (t < bub.until) talk.push([px + b.face * 1.2 * sc, gy - hop - 8.6 * sc, s, bub.text, 1 - Math.max(0, (t - bub.until + 0.25) / 0.25)]);
  }
  for (const [bx, by, sc, text, a] of talk) bubble(x, bx, by, sc, text, a, w);
}

// one big foglet: ground shadow, then the in-game figure (mirrored to face the foe) leaning and
// squashing around its feet, then the angry face on its head
function figure(x, px, gy, s, col, style, f, hop, squash, lean, rage, t) {
  x.save();
  x.fillStyle = `rgba(20,30,30,${0.25 * (1 - Math.min(0.6, hop / (s * 6)))})`;
  x.beginPath(); x.ellipse(px, gy, 2.2 * s * (1 - hop / (s * 10)), 0.7 * s, 0, 0, Math.PI * 2); x.fill();
  x.translate(px, gy - hop);
  x.rotate(lean);
  x.scale(f * (1 + (1 - squash) * 0.6), squash);
  drawFoglet(x, 0, 0, s, col, style);
  // face on the head (centre 0, -5): eyes looking at the foe, brows pulled down, mouth open when shouting
  const ink = 'rgba(30,26,32,0.95)', hy = -5 * s;
  x.fillStyle = ink;
  for (const ex of [0.05, 0.6]) { x.beginPath(); x.arc(ex * s, hy + 0.05 * s, 0.17 * s, 0, Math.PI * 2); x.fill(); }
  x.strokeStyle = ink; x.lineWidth = 0.17 * s; x.lineCap = 'round';
  const tw = Math.sin(t * 9) * 0.06 * s;
  x.beginPath(); x.moveTo(-0.3 * s, hy - 0.45 * s - tw); x.lineTo(0.2 * s, hy - 0.22 * s); x.stroke();
  x.beginPath(); x.moveTo(0.95 * s, hy - 0.42 * s - tw); x.lineTo(0.5 * s, hy - 0.22 * s); x.stroke();
  if (rage > 0.55) { x.beginPath(); x.ellipse(0.4 * s, hy + 0.55 * s, 0.24 * s, (0.12 + 0.18 * rage) * s, 0, 0, Math.PI * 2); x.fill(); }
  else { x.beginPath(); x.moveTo(0.15 * s, hy + 0.62 * s); x.quadraticCurveTo(0.4 * s, hy + 0.45 * s, 0.68 * s, hy + 0.62 * s); x.stroke(); }
  x.restore();
  // anger mark next to the head when furious
  if (rage > 0.7) {
    x.save();
    x.translate(px - f * 1.4 * s, gy - hop - 6.6 * s);
    x.strokeStyle = '#e0312b'; x.lineWidth = 0.22 * s; x.lineCap = 'round';
    const a = 0.45 * s * (0.8 + 0.3 * Math.sin(t * 12));
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      x.beginPath(); x.moveTo(dx * a * 0.35, dy * a); x.quadraticCurveTo(dx * a * 0.35, dy * a * 0.35, dx * a, dy * a * 0.35); x.stroke();
    }
    x.restore();
  }
}

// speech bubble with a short shout, kept inside the canvas (cw wide, top at 0); s = figure scale
function bubble(x, bx, by, s, text, alpha, cw) {
  x.save();
  x.globalAlpha = Math.max(0, alpha);
  x.font = `800 ${Math.round(1.5 * s)}px Fredoka, system-ui, sans-serif`;
  const w = x.measureText(text).width + 1.4 * s, h = 2.2 * s, tip = bx;
  bx = Math.min(cw - w / 2 - 2, Math.max(w / 2 + 2, bx));
  by = Math.max(h + 2, by);
  x.fillStyle = '#fff'; x.strokeStyle = 'rgba(40,40,50,0.85)'; x.lineWidth = 0.22 * s;
  x.beginPath(); x.roundRect(bx - w / 2, by - h, w, h, 0.8 * s); x.fill(); x.stroke();
  const tx = Math.min(bx + w / 2 - 0.8 * s, Math.max(bx - w / 2 + 0.8 * s, tip));   // tail points at the speaker
  x.beginPath(); x.moveTo(tx - 0.4 * s, by - 0.1 * s); x.lineTo(tx, by + 0.6 * s); x.lineTo(tx + 0.4 * s, by - 0.1 * s); x.fill();
  x.fillStyle = '#2a2530'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, bx, by - h / 2 + 0.06 * s);
  x.restore();
}
