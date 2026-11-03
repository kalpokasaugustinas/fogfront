// menu mascots: two small bands of foglets (yours on the left, a rival band on the right) hopping and
// shouting at each other across the menu. each one is the in-game troop figure (drawFoglet, the
// same drawing as on the map) drawn big, with a tiny angry face added and more movement: hops,
// leaning in at the foe, shaking with rage, and now and then one blasting off like a rocket while a
// new one walks in. drawn on two side canvases every menu frame
import { drawFoglet, hexToRgb } from './render.js?v=60';

const shouts = ['Grr!', 'Hey!', '!!', 'Ours!', 'Back off!', 'Charge!', 'Mine!'];

// band = { canvas, color, styles, face: 1 (looks right) | -1 (looks left), seed }
// each foglet has a mode: idle (hopping, shouting) -> charge (hops faster and faster) -> fly (blasts
// off like a rocket, flame + smoke, out of the top of the screen) -> gone -> walk (a new foglet walks
// in from the screen edge to the empty spot) -> idle. one rocket per band every 9-15 s
export function makeBand(canvas, color, styles, face, seed) {
  return {
    canvas, col: hexToRgb(color), styles, face, seed, last: 0, puffs: [], nextRocket: 7 + seed * 5,
    hops: styles.map((_, i) => (seed * 1.7 + i * 2.1) % 1),
    acts: styles.map(() => ({ mode: 'idle', t0: 0 })),
    bubbles: styles.map((_, i) => ({ text: '', until: 0, next: 1 + seed * 0.7 + i * 0.9 })),
  };
}

// change a band's colour / kits (the player's band follows the commander profile)
export function dressBand(b, color, styles) { b.col = hexToRgb(color); b.styles = styles; }

const charge = 1.4, gone = 0.9, walk = 2.4;   // seconds per rocket phase

// draw one band at time t (seconds)
export function drawBand(b, t) {
  const c = b.canvas, dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  // the canvas runs the full screen height (so rockets leave the screen); the band stands in the
  // bottom box. figure scale: a foglet is ~4 x 8 units, with room for hops, hats, bubbles, leaning
  const hb = Math.min(h * 0.5, 320), n = b.styles.length, s = Math.min(hb / 13.5, w / (n * 5.4));
  const dt = Math.min(0.1, Math.max(0, t - (b.last || t))); b.last = t;
  if (!b.started) { b.started = t; b.nextRocket += t; }
  // time for a rocket: an idle foglet starts charging
  if (t > b.nextRocket) {
    const idle = b.acts.map((a, i) => (a.mode === 'idle' ? i : -1)).filter((i) => i >= 0);
    if (idle.length) { const i = idle[Math.floor((t * 13) % idle.length)]; b.acts[i] = { mode: 'charge', t0: t }; b.bubbles[i].until = 0; }
    b.nextRocket = t + 9 + ((t * 7.3 + b.seed * 3) % 6);
  }
  drawPuffs(x, b, t, s);
  const talk = [];   // speech bubbles drawn last, over everyone
  // back row (odd) first, front row on top
  for (const i of [...b.styles.keys()].sort((p, q) => (q % 2) - (p % 2))) {
    const back = i % 2 === 1, k = n === 1 ? 0.5 : i / (n - 1);
    const sc = s * (back ? 0.85 : 1);
    const gx = b.face > 0 ? w * (0.15 + 0.52 * k) : w * (0.85 - 0.52 * k), gy = h - 18 - hb * (back ? 0.16 : 0.03);   // 18 px clear of the build label
    const act = b.acts[i], tau = t - act.t0;
    // phase changes
    if (act.mode === 'gone' && tau > gone) { act.mode = 'walk'; act.t0 = t; }
    if (act.mode === 'walk' && tau > walk) { act.mode = 'idle'; act.t0 = t; }
    if (act.mode === 'gone') continue;
    // rage comes and goes; furious foglets hop higher, lean in further and shake
    const ph = b.seed * 1.7 + i * 2.1, rage = act.mode === 'charge' ? 1 : 0.5 + 0.5 * Math.max(0, Math.sin(t * 0.6 + ph));
    let px = gx, lift = 0, hop = 0, squash = 1, lean = 0;
    if (act.mode === 'walk') {
      // walks in from the screen edge, easing into its spot, with a little step bob
      const e = 1 - (1 - Math.min(1, tau / walk)) ** 2, from = b.face > 0 ? -4 * sc : w + 4 * sc;
      px = from + (gx - from) * e;
      hop = Math.abs(Math.sin(tau * Math.PI * 3)) * 0.5 * sc * (1 - e * 0.6);
      lean = 0.12 * b.face * (1 - e);
    } else {
      // hop rhythm: 1.25-1.8 a second, steady (phase advanced per frame); charging speeds it up 6x
      const boost = act.mode === 'charge' ? 1 + 5 * Math.min(1, tau / charge) : 1;
      if (act.mode !== 'fly') b.hops[i] = (b.hops[i] + dt * 1.2 * (1.05 + 0.45 * rage) * boost) % 1;
      const cyc = b.hops[i], air = cyc < 0.65 ? Math.sin(Math.PI * cyc / 0.65) : 0;
      hop = air * (1.6 + 1.6 * rage) * sc * (act.mode === 'charge' ? 0.6 : 1);
      squash = cyc >= 0.65 ? 1 - 0.16 * Math.sin(Math.PI * (cyc - 0.65) / 0.35) : 1 + 0.05 * air;
      const lunge = act.mode === 'idle' ? Math.max(0, Math.sin(t * 1.3 + ph * 2)) ** 3 : 0;   // now and then a step toward the foe
      const shake = rage > 0.75 ? Math.sin(t * 40 + i) * (act.mode === 'charge' ? 0.3 : 0.12) * sc : 0;
      lean = (0.08 + 0.18 * lunge + 0.06 * rage) * b.face + Math.sin(t * 3 + ph) * 0.04;
      px = gx + b.face * lunge * 1.4 * sc + shake;
      if (act.mode === 'charge' && tau > charge) { act.mode = 'fly'; act.t0 = t; }
      if (act.mode === 'fly') {
        // blast-off: accelerating straight up, a slight wobble, flame under the feet, smoke behind
        const ft = t - act.t0;   // flight time (not tau: that was the charge's clock on the switch frame)
        lift = 2 * sc + 1400 * ft * ft + 120 * ft;
        lean = Math.sin(ft * 18) * 0.08; squash = 1.12; hop = 0;
        b.puffs.push({ x: px + (Math.random() - 0.5) * sc, y: gy - lift + 0.5 * sc, t0: t, r: (0.6 + Math.random() * 0.6) * sc });
        if (gy - lift < -14 * sc) { act.mode = 'gone'; act.t0 = t; continue; }
      }
    }
    if (act.mode === 'fly') flame(x, px, gy - lift, sc, t);
    figure(x, px, gy - lift, sc, b.col, b.styles[i], b.face, hop, squash, lean, rage, t + ph, act.mode !== 'fly');
    const bub = b.bubbles[i];
    if (act.mode === 'charge') { talk.push([px + b.face * 1.2 * sc, gy - hop - 8.6 * sc, s, tau < 0.7 ? 'Hmm…' : 'Wheee!', 1]); continue; }
    if (act.mode !== 'idle') continue;
    // one speaker per band at a time, so bubbles never pile up
    if (t > bub.next && b.bubbles.some((o) => o !== bub && t < o.until)) bub.next = t + 0.6;
    if (t > bub.next) { bub.text = shouts[Math.floor((t * 7 + i * 3 + b.seed * 5) % shouts.length)]; bub.until = t + 1.2; bub.next = t + 2.8 + ((i * 1.3 + b.seed) % 2.4); }
    if (t < bub.until) talk.push([px + b.face * 1.2 * sc, gy - hop - 8.6 * sc, s, bub.text, 1 - Math.max(0, (t - bub.until + 0.25) / 0.25)]);
  }
  for (const [bx, by, sc, text, a] of talk) bubble(x, bx, by, sc, text, a, w);
}

// rocket flame under a flying foglet's feet (flickering, white-hot core)
function flame(x, px, fy, s, t) {
  const f = 1 + 0.25 * Math.sin(t * 60) + 0.15 * Math.sin(t * 37);
  x.save();
  x.globalCompositeOperation = 'lighter';
  const g = x.createLinearGradient(px, fy, px, fy + 5 * s * f);
  g.addColorStop(0, 'rgba(255,250,210,0.95)'); g.addColorStop(0.35, 'rgba(255,190,70,0.9)'); g.addColorStop(1, 'rgba(255,90,30,0)');
  x.fillStyle = g;
  x.beginPath(); x.moveTo(px - 1.1 * s, fy); x.quadraticCurveTo(px, fy + 1.5 * s, px, fy + 5 * s * f); x.quadraticCurveTo(px, fy + 1.5 * s, px + 1.1 * s, fy); x.fill();
  x.restore();
}

// smoke left behind by rockets: grey puffs that grow, drift and fade
function drawPuffs(x, b, t, s) {
  b.puffs = b.puffs.filter((p) => t - p.t0 < 1.1);
  for (const p of b.puffs) {
    const a = (t - p.t0) / 1.1;
    x.fillStyle = `rgba(235,238,240,${0.7 * (1 - a)})`;
    x.beginPath(); x.arc(p.x + Math.sin(p.t0 * 9) * a * s, p.y + a * 1.5 * s, p.r * (1 + 2.2 * a), 0, Math.PI * 2); x.fill();
  }
}

// one big foglet: ground shadow, then the in-game figure (mirrored to face the foe) leaning and
// squashing around its feet, then the angry face on its head
function figure(x, px, gy, s, col, style, f, hop, squash, lean, rage, t, ground = true) {
  x.save();
  if (ground) {   // no shadow while flying
    x.fillStyle = `rgba(20,30,30,${0.25 * (1 - Math.min(0.6, hop / (s * 6)))})`;
    x.beginPath(); x.ellipse(px, gy, 2.2 * s * (1 - hop / (s * 10)), 0.7 * s, 0, 0, Math.PI * 2); x.fill();
  }
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
