// app shell: menu, campaign map, battle screen, input and the frame loop
import { rules, buildings, effects, factionColors, factionNames, neutralColor, themeNames, traits } from './config.js?v=23';
import { generateMap, rng } from './mapgen.js?v=23';
import { Battle } from './battle.js?v=23';
import { personalities } from './ai.js?v=23';
import { Campaign } from './campaign.js?v=23';
import { Expedition, stages, perks } from './expedition.js?v=23';
import { initAudio, sfx, setSfx, setMusic, setTrack, audioPrefs } from './audio.js?v=23';
import { MapView, hexToRgb, shade, label, pill, unitSprite } from './render.js?v=23';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const autoplay = params.has('autoplay');   // test mode: the player side is played by a bot too

const colors = factionColors.map(hexToRgb);
const neutral = hexToRgb(neutralColor);

// ---------- screens ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  screen = id;
  setTrack(id === 'battle' ? 'battle' : 'menu');   // heroic theme on menus, folk loop in battle
  if (id === 'menu') { renderMenuStats(); requestAnimationFrame(() => mv?.resize()); }
  requestAnimationFrame(() => { if (id === 'battle' && bv) { bv.resize(); key = ''; } if (id === 'campaign') cv.resize(), paintCampaign(); });
}
let screen = 'menu';

// ---------- campaign screen ----------
const campaign = new Campaign();
const cv = new MapView($('campaign-canvas'), campaign.map, 'summer', campaign.regions.map((r) => r.climate));
let pickedRegion = -1;

function paintCampaign() {
  cv.paint((id) => {
    // light tints so each region's climate (snow, autumn, moor, summer) still shows through
    if (campaign.owned.has(id)) return { color: colors[0], fill: 0.2 };
    const c = colors[campaign.regions[id].empire];
    return { color: campaign.attackable(id) ? c : shade(c, -0.2), fill: campaign.attackable(id) ? 0.1 : 0.04 };
  });
  renderRegionInfo();
}

function drawCampaign() {
  const ctx = cv.drawBase();
  const time = performance.now() / 1000;
  // sea routes between islands: moving dashed lines
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.lineDashOffset = -time * 14;
  ctx.lineCap = 'round';
  for (const b of campaign.map.bridges) {
    const x1 = cv.sx(b.ax), y1 = cv.sy(b.ay), x2 = cv.sx(b.bx), y2 = cv.sy(b.by);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(60,80,90,0.25)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + 10, x2, y2); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
  }
  ctx.restore();
  // picked region: glowing outline; regions you can attack: dashed outlines
  const open = campaign.regions.filter((r) => campaign.attackable(r.id)).map((r) => r.id);
  if (pickedRegion >= 0) cv.highlight(ctx, pickedRegion, colors[campaign.owned.has(pickedRegion) ? 0 : campaign.regions[pickedRegion].empire], open, time);
  else if (open.length) cv.highlight(ctx, open[0], colors[campaign.regions[open[0]].empire], open, time, true);
  const fs = Math.max(9, Math.min(13, cv.size / 48));
  for (const r of campaign.regions) {
    const s = campaign.map.segs[r.id], x = cv.sx(s.x), y = cv.sy(s.y);
    const owned = campaign.owned.has(r.id), open = campaign.attackable(r.id);
    label(ctx, owned ? '🏳️' : open ? '⚔️' : r.capital ? '👑' : '🔒', x, y - fs * 0.9, fs * 1.1);
    label(ctx, r.name, x, y + fs * 0.4, fs * 0.85, owned || open ? '#fff' : '#eef1f0', 700);
    if (!owned) label(ctx, 'Lv ' + r.level, x, y + fs * 1.4, fs * 0.75, '#ffd76a', 700);
  }
}

function renderRegionInfo() {
  const box = $('region-info');
  $('campaign-progress').textContent = `${campaign.owned.size} / ${campaign.regions.length} regions`;
  if (pickedRegion < 0) {
    box.innerHTML = campaign.done()
      ? '<p class="big">🏆 World conquered!</p><p>Reset the campaign to play again.</p>'
      : '<p>Tap a region marked ⚔️ next to your territory to attack it.</p>';
    return;
  }
  const r = campaign.regions[pickedRegion], open = campaign.attackable(r.id);
  box.innerHTML = `
    <p class="big">${r.capital ? '👑 ' : ''}${r.name}</p>
    <p>Held by <b style="color:${factionColors[r.empire]}">${factionNames[r.empire]}</b> · level ${r.level}</p>
    <p>${r.segments} segments · ${r.bots} enem${r.bots > 1 ? 'ies' : 'y'} · neutral garrisons ${Math.round(r.neutral[0] * 100)}–${Math.round(r.neutral[1] * 100)}% of tile size</p>
    ${open ? '<button id="attack-btn" class="primary">⚔️ Attack</button>'
           : campaign.owned.has(r.id) ? '<p>✅ Yours</p>' : '<p>🔒 Conquer a neighbouring region first</p>'}`;
  if (open) $('attack-btn').onclick = () => startBattle(campaign.battleSetup(r.id), 'campaign', r.id);
}

$('campaign-canvas').addEventListener('pointerdown', (e) => {
  const id = cv.segAt(e.clientX, e.clientY);
  pickedRegion = id;
  paintCampaign();
});

// ---------- battle screen ----------
let battle = null, bv = null, mode = 'skirmish', regionId = -1;
let countdown = 0, goFlash = 0;   // 3-2-1 before a battle starts (s left), 'Conquer!' banner after
let auto = false, selected = -1, pct = 0.5, drag = null, hover = -1, speed = 1, paused = false, key = '';

function startBattle(setup, m, rid = -1) {
  // battle maps: random island shape + lakes/mountains (setup.shape can force a shape)
  const map = generateMap({ seed: setup.seed, cells: setup.cells, grid: rules.grid, shape: setup.shape ?? 'random', obstacles: true, detail: setup.detail ?? 1, stamp: setup.stamp ?? null });
  if (autoplay) setup.factions[0] = { ai: true, color: 0, think: 1.5, personality: personalities.aggressive };
  battle = new Battle(map, setup);
  mode = m; regionId = rid; selected = -1; drag = null; paused = false; key = '';
  countdown = autoplay ? 0 : 3; goFlash = 0;
  const theme = setup.theme ?? themeNames[setup.seed % themeNames.length];
  if (!bv) bv = new MapView($('battle-canvas'), map, theme); else bv.setMap(map, theme);
  bv.prewarm(battle.factions.map((f) => colors[f.color]), 0.16);
  $('stage').classList.toggle('hidden', m !== 'expedition');
  if (m === 'expedition') $('stage').textContent = `Stage ${expedition.stage + 1}`;
  wheelOn = false;
  setCam(1, 0, 0);
  $('end').classList.add('hidden');
  renderWheel();
  show('battle');
}

function startSkirmish() {
  const seed = Math.floor(Math.random() * 1e9), r = rng(seed), types = Object.keys(personalities);
  startBattle({
    seed, cells: 22, neutral: [0.15, 0.35],
    factions: [{ ai: false, color: 0 }, ...[1, 2, 3].map((color) => ({
      ai: true, color, think: 3, personality: personalities[types[Math.floor(r() * types.length)]],
    }))],
  }, 'skirmish');
}

const colorOfFaction = (f) => (f < 0 ? neutral : colors[battle.factions[f].color]);
const isMine = (sid) => sid >= 0 && battle.segs[sid].owner === 0;
const canTarget = (from, to) => from >= 0 && to >= 0 && from !== to && battle.segs[from].adj.includes(to);

// repaint the map raster when ownership, buildings or the selection changed
function paintBattle() {
  const k = `${battle.version}:${selected}:${wheelOn}`;
  if (k === key) return;
  key = k;
  if (selected >= 0 && !isMine(selected)) selected = -1;
  const adj = selected >= 0 ? battle.segs[selected].adj : [];
  bv.paint((id) => {
    const s = battle.segs[id], o = s.owner, building = s.building ?? (s.relic ? 'relic' : s.home ? 'home' : s.camp ? 'camp' + s.camp : null);   // shrine shows until something is built
    if (o < 0) return { color: null, fill: 0, building };
    return { color: colors[battle.factions[o].color], fill: 0.16, building };
  });
  renderWheel();
}

// troop figures in tiles, tile numbers, sea routes and armies (marching / fighting) for battle b
// drawn on view v; ac = not-yet-simulated time (smooth motion); numbers = draw the number badges
function drawUnits(ctx, v, b, ac, numbers) {
  const fs = Math.max(11, Math.min(18, v.size / 30));
  // troop figures: one soldier per troopsPerDot troops (battalions of x5 on zoomed-out maps)
  const z = Math.max(1, Math.min(1.9, v.size / 480)), dpr = v.dpr;   // figure scale: small but visible
  const kind = (b.map.detail ?? 1) < 0.7 ? 'battalion' : 'soldier';
  const per = rules.troopsPerDot * (kind === 'battalion' ? 5 : 1), sp = (kind === 'battalion' ? 12 : 4.6) * z;
  for (const s of b.segs) {
    const spots = v.troopSpots(s.id, sp);
    const n = Math.min(spots.length, Math.ceil(s.troops / per - 0.01));
    const u = unitSprite(kind, s.owner < 0 ? '#8a8f86' : factionColors[b.factions[s.owner].color], z, dpr);
    for (let i = 0; i < n; i++) ctx.drawImage(u.c, spots[i][0] - u.w / 2, spots[i][1] - u.h, u.w, u.h);
  }
  // segment numbers, with the relic perk above (terrain shows in the ground itself)
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
  if (numbers) for (const s of b.segs) {
    const x = v.sx(s.x), y = v.sy(s.y);
    if (s.relic) {
      ctx.fillStyle = `rgba(255, 215, 106, ${0.25 + 0.25 * pulse})`;
      ctx.beginPath(); ctx.arc(x, y - fs * 1.35, fs * (0.75 + 0.12 * pulse), 0, Math.PI * 2); ctx.fill();
      label(ctx, perks.find((p) => p.id === s.relic).icon, x, y - fs * 1.35, fs * 0.9);
    }
    const own = s.owner >= 0 ? factionColors[b.factions[s.owner].color] : null;
    pill(ctx, Math.floor(s.troops), x, y, fs * 0.85, own ?? 'rgba(90,100,95,.55)', own ?? '#4b5552');
  }
  // sea routes (world-style maps): dashed lines between islands
  if (b.map.bridges?.length) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -(b.time + ac) * 14;
    for (const br of b.map.bridges) {
      const x1 = v.sx(br.ax), y1 = v.sy(br.ay), x2 = v.sx(br.bx), y2 = v.sy(br.by);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + 10, x2, y2);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(60,80,90,0.25)'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
    }
    ctx.restore();
  }
  // armies: marching formations; at the border they jostle and clash for the fight's 1-3 s
  const now = performance.now() / 1000;
  for (const a of b.armies) {
    const f = b.segs[a.from], t = b.segs[a.to];
    // progress between sim steps: add the not-yet-simulated time, so movement is smooth at any fps
    const fighting = a.fight || a.clash, tt = fighting ? a.t : Math.min(a.stopAt, a.t + ac / a.dur);
    const x = v.sx(f.x + (t.x - f.x) * tt), y = v.sy(f.y + (t.y - f.y) * tt);
    const ang = Math.atan2(v.sy(t.y) - v.sy(f.y), v.sx(t.x) - v.sx(f.x)), ca = Math.cos(ang), sa = Math.sin(ang);
    const col = factionColors[b.factions[a.owner].color], u = unitSprite(kind, col, z, dpr);
    const m = Math.max(1, Math.min(kind === 'battalion' ? 12 : 30, Math.ceil(a.n / per - 0.01)));
    const cols = Math.ceil(Math.sqrt(m)), seed = a.from * 31 + a.to;
    for (let i = 0; i < m; i++) {
      // rows behind the leader, ranks across the direction of travel
      const r = Math.floor(i / cols), c = i % cols, along = -r * sp * 0.9, across = (c - (cols - 1) / 2) * sp * 0.8;
      let px = x + ca * along - sa * across, py = y + sa * along + ca * across;
      if (fighting) { px += Math.sin(now * 23 + i * 1.7 + seed) * z * 1.2; py += Math.cos(now * 19 + i) * z * 0.8; }
      else py += Math.sin(now * 14 + i) * z * 0.5;   // marching bob
      ctx.drawImage(u.c, px - u.w / 2, py - u.h, u.w, u.h);
    }
    if (fighting) {
      // clash sparks just ahead of the formation
      const fx = x + ca * sp * 1.3, fy = y + sa * sp * 1.3 - 3 * z;
      ctx.lineWidth = 1.4;
      for (let k = 0; k < 4; k++) {
        const ph = now * 9 + k * 2.1 + seed, a2 = ph * 2.3;
        if (Math.sin(ph * 3.1) < 0.2) continue;
        const sx = fx + Math.sin(ph) * sp * 0.9, sy = fy + Math.cos(ph * 1.3) * sp * 0.6, len = 2.5 * z;
        ctx.strokeStyle = k % 2 ? '#fff6c8' : '#ffd76a';
        ctx.beginPath(); ctx.moveTo(sx - Math.cos(a2) * len, sy - Math.sin(a2) * len); ctx.lineTo(sx + Math.cos(a2) * len, sy + Math.sin(a2) * len); ctx.stroke();
      }
    }
    // small number above the formation (gold rim = barracks bonus)
    if (numbers) pill(ctx, Math.floor(a.n), x, y - u.h - 7 * z, fs * 0.62, a.atk > 1 ? '#e0a020' : col, col);
  }
}

function drawBattle() {
  paintBattle();
  const ctx = bv.drawBase();
  // selected segment: glowing outline; its neighbours: dashed outlines
  if (selected >= 0) bv.highlight(ctx, selected, colors[0], battle.segs[selected].adj, performance.now() / 1000);
  const fs = Math.max(11, Math.min(18, bv.size / 30));
  drawUnits(ctx, bv, battle, acc, true);
  updateWheel();   // follows zoom / pan
  // player routes: dashed arrows with a moving dash
  ctx.save();
  for (const [a, r] of battle.routes) {
    const s = battle.segs[a], t = battle.segs[r.to];
    if (s.owner !== 0) continue;
    const x1 = bv.sx(s.x), y1 = bv.sy(s.y), x2 = bv.sx(t.x), y2 = bv.sy(t.y);
    const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
    const sx = x1 + Math.cos(ang) * fs * 1.2, sy = y1 + Math.sin(ang) * fs * 1.2;
    const ex = x1 + Math.cos(ang) * (len - fs * 1.3), ey = y1 + Math.sin(ang) * (len - fs * 1.3);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.setLineDash([6, 5]); ctx.lineDashOffset = -(battle.time + acc) * 20;
    ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath();   // arrow head
    ctx.moveTo(ex + Math.cos(ang) * 6, ey + Math.sin(ang) * 6);
    ctx.lineTo(ex + Math.cos(ang + 2.5) * 8, ey + Math.sin(ang + 2.5) * 8);
    ctx.lineTo(ex + Math.cos(ang - 2.5) * 8, ey + Math.sin(ang - 2.5) * 8);
    ctx.fillStyle = '#fff'; ctx.fill();
  }
  ctx.restore();
  // drag arrow from the selected segment to the pointer
  if (drag && drag.moved) {
    const f = battle.segs[drag.from], fx = bv.sx(f.x), fy = bv.sy(f.y);
    const ok = canTarget(drag.from, hover);
    const tx = ok ? bv.sx(battle.segs[hover].x) : drag.x, ty = ok ? bv.sy(battle.segs[hover].y) : drag.y;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty);
    ctx.lineWidth = 4; ctx.setLineDash([8, 6]);
    ctx.strokeStyle = ok ? '#fff' : 'rgba(255,255,255,.4)';
    ctx.stroke(); ctx.setLineDash([]);
    if (ok) label(ctx, '→ ' + Math.floor(battle.segs[drag.from].troops * pct), (fx + tx) / 2, (fy + ty) / 2 - fs, fs * 0.8, '#ffd76a');
  }
  if ((countdown > 0 && !paused) || goFlash > 0) drawCountdown(ctx);
}

// 3-2-1 countdown: a gold-rimmed shield medallion with a big number that pops in and settles,
// over a soft dark vignette; then a 'Conquer!' ribbon banner that fades as the battle starts
function drawCountdown(ctx) {
  const w = bv.canvas.width / bv.dpr, h = bv.canvas.height / bv.dpr, cx = w / 2, cy = h * 0.46, R = Math.min(w, h) * 0.13;
  ctx.save();
  const fade = countdown > 0 ? 1 : goFlash;
  // soft dark halo behind the medallion (fades out well inside the canvas, so no square edge)
  const vig = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 2.6);
  vig.addColorStop(0, `rgba(20,30,40,${0.3 * fade})`);
  vig.addColorStop(1, 'rgba(20,30,40,0)');
  ctx.fillStyle = vig;
  ctx.beginPath(); ctx.arc(cx, cy, R * 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (countdown > 0) {
    const n = Math.ceil(countdown), f = n - countdown;   // f: 0 -> 1 within each second
    const pop = 1 + 0.35 * Math.max(0, 1 - f * 5) ** 2 - 0.06 * Math.max(0, f - 0.8) * 5;
    const alpha = f > 0.85 ? (1 - f) / 0.15 : 1;
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    // medallion: drop shadow, gold rim, parchment face, inner ring, crossed-sword ticks
    ctx.fillStyle = 'rgba(20,30,30,0.3)';
    ctx.beginPath(); ctx.ellipse(R * 0.08, R * 1.05, R * 0.9, R * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    const rim = ctx.createLinearGradient(0, -R, 0, R);
    rim.addColorStop(0, '#ffe7a0'); rim.addColorStop(0.5, '#e0a43a'); rim.addColorStop(1, '#9a6420');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    const face = ctx.createRadialGradient(-R * 0.3, -R * 0.4, R * 0.1, 0, 0, R * 0.86);
    face.addColorStop(0, '#fffaf0'); face.addColorStop(1, '#e8dcc0');
    ctx.fillStyle = face;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.84, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(154,100,32,0.55)';
    ctx.lineWidth = Math.max(1.5, R * 0.03);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.74, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.76, Math.sin(a) * R * 0.76); ctx.lineTo(Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82); ctx.stroke();
    }
    ctx.font = `900 ${R * 1.15}px Georgia, 'Times New Roman', serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = R * 0.08;
    ctx.strokeStyle = '#fffaf0';
    ctx.strokeText(n, 0, R * 0.06);
    ctx.fillStyle = factionColors[0];
    ctx.fillText(n, 0, R * 0.06);
  } else {
    // ribbon banner sliding up a little as it fades
    ctx.globalAlpha = Math.min(1, goFlash * 1.6);
    ctx.translate(cx, cy - (1 - goFlash) * R * 0.4);
    const bw = R * 3.4, bh = R * 0.85;
    ctx.fillStyle = '#9a2f2a';
    for (const s of [-1, 1]) {   // ribbon tails
      ctx.beginPath(); ctx.moveTo(s * bw * 0.42, -bh * 0.3); ctx.lineTo(s * bw * 0.62, -bh * 0.3); ctx.lineTo(s * bw * 0.54, bh * 0.05); ctx.lineTo(s * bw * 0.62, bh * 0.4); ctx.lineTo(s * bw * 0.42, bh * 0.4); ctx.fill();
    }
    const band = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    band.addColorStop(0, '#e2554c'); band.addColorStop(1, '#b8382f');
    ctx.fillStyle = band;
    ctx.beginPath(); ctx.moveTo(-bw / 2, -bh / 2); ctx.quadraticCurveTo(0, -bh * 0.75, bw / 2, -bh / 2); ctx.lineTo(bw / 2, bh / 2); ctx.quadraticCurveTo(0, bh * 0.25, -bw / 2, bh / 2); ctx.fill();
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = Math.max(1.5, R * 0.035);
    ctx.stroke();
    ctx.font = `900 ${R * 0.5}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = '#fff6dc';
    ctx.fillText(mode === 'expedition' && expedition?.current ? expedition.current.name + '!' : 'Conquer!', 0, -bh * 0.08);
  }
  ctx.restore();
}

// battle input:
// - tap a neighbour of the selected segment = send troops there (attack, or move if it's yours)
// - tap your segment that isn't a neighbour = select it; tap the selected one again = deselect
// - drag from your segment to any neighbour = send troops
function localPos(e) {
  // canvas css px, undoing the zoom transform
  const r = bv.canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * bv.size) / r.width, y: ((e.clientY - r.top) * bv.cssH) / r.height };
}

// ---------- zoom + pan ----------
// the map sits in #cam, which is scaled / moved with a css transform (cheap, no redraw). pinch or
// mouse wheel zooms (1x-3x) around the fingers / cursor; one finger on empty ground pans. when
// zooming settles, the view re-renders at a higher resolution so it stays sharp
const cam = { z: 1, x: 0, y: 0 }, pointers = new Map();
let pinch = null, pan = null, boostTimer = 0;
function setCam(z, x, y) {
  const w = $('battle-wrap').clientWidth, h = $('battle-wrap').clientHeight;
  cam.z = Math.min(3, Math.max(1, z));
  cam.x = Math.min(0, Math.max(w - w * cam.z, x));
  cam.y = Math.min(0, Math.max(h - h * cam.z, y));
  $('cam').style.transform = cam.z === 1 ? '' : `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
  clearTimeout(boostTimer);
  boostTimer = setTimeout(() => {
    const boost = cam.z >= 1.9 ? 2 : cam.z >= 1.4 ? 1.5 : 1;
    if (bv && bv.boost !== boost) { bv.boost = boost; bv.resize(); }
  }, 300);
}
// zoom to nz keeping the screen point (px, py) (relative to the map area) fixed
function zoomAt(px, py, nz) {
  nz = Math.min(3, Math.max(1, nz));
  const wx = (px - cam.x) / cam.z, wy = (py - cam.y) / cam.z;
  setCam(nz, px - wx * nz, py - wy * nz);
}
function wrapPos(e) {
  const r = $('battle-wrap').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
$('battle-wrap').addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = wrapPos(e);
  zoomAt(p.x, p.y, cam.z * Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
const pinchInfo = () => {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
$('battle-canvas').addEventListener('pointerdown', (e) => {
  if (!battle) return;
  bv.canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, wrapPos(e));
  if (pointers.size === 2) {
    // second finger: pinch zoom (cancels any drag / pan of the first finger)
    drag = pan = null;
    pinch = { ...pinchInfo(), z0: cam.z, x0: cam.x, y0: cam.y };
    return;
  }
  if (pointers.size > 2 || battle.state !== 'running' || countdown > 0) return;
  const sid = bv.segAt(e.clientX, e.clientY);
  hover = sid;
  // own segment: decide tap vs drag on pointerup
  if (isMine(sid)) drag = { from: sid, moved: false, ...localPos(e) };
  else if (canTarget(selected, sid)) sendFrom(selected, sid);
  else pan = { ...wrapPos(e), x0: cam.x, y0: cam.y, moved: false, sid };   // empty ground: pan (tap = deselect)
});
$('battle-canvas').addEventListener('pointermove', (e) => {
  if (!battle) return;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, wrapPos(e));
  if (pinch && pointers.size === 2) {
    // keep the map point under the pinch centre under the fingers while scaling
    const p = pinchInfo(), nz = Math.min(3, Math.max(1, pinch.z0 * (p.d / Math.max(1, pinch.d))));
    const wx = (pinch.x - pinch.x0) / pinch.z0, wy = (pinch.y - pinch.y0) / pinch.z0;
    setCam(nz, p.x - wx * nz, p.y - wy * nz);
    return;
  }
  if (pan) {
    const p = wrapPos(e);
    if (Math.hypot(p.x - pan.x, p.y - pan.y) > 6) pan.moved = true;
    if (pan.moved) setCam(cam.z, pan.x0 + p.x - pan.x, pan.y0 + p.y - pan.y);
    return;
  }
  hover = bv.segAt(e.clientX, e.clientY);
  if (drag) {
    Object.assign(drag, localPos(e));
    if (hover !== drag.from && !drag.moved) { drag.moved = true; selected = drag.from; wheelOn = false; }
  }
});
function pointerEnd(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; drag = pan = null; return; }
  if (pan) { if (!pan.moved && pan.sid < 0) selected = -1; pan = null; }
}
$('battle-canvas').addEventListener('pointercancel', (e) => { pointerEnd(e); drag = null; });
$('battle-canvas').addEventListener('pointerup', (e) => {
  const wasPinch = !!pinch;
  pointerEnd(e);
  if (wasPinch) return;
  if (drag) {
    const to = bv.segAt(e.clientX, e.clientY), from = drag.from;
    if (drag.moved) { if (canTarget(from, to)) sendFrom(from, to); }
    else if (from === selected) selected = -1;                   // tap selected again: deselect
    // auto on + second tap on the tile the selected one already feeds: select it (route stays),
    // so a supply chain can be built tile by tile
    else if (auto && battle.routes.get(selected)?.to === from) selected = from;
    else if (canTarget(selected, from)) sendFrom(selected, from); // tap own neighbour: move troops
    else { selected = from; wheelOn = true; }                     // tap other own segment: select (+ build wheel)
  }
  drag = null;
});

function sendFrom(from, to) {
  const n = Math.floor(battle.segs[from].troops * pct);
  const sent = battle.send(0, from, to, n);
  // auto on + own target: also set a standing route that keeps (1 - pct) of the cap
  if (auto && isMine(to) && battle.setRoute(0, from, to, 1 - pct)) {
    flash(`🔁 Route set: keeps ${Math.round((1 - pct) * 100)}% of cap, forwards the rest`);
  } else if (!sent) flash('Not enough troops');
}

function setAuto(on) {
  auto = on;
  $('auto').classList.toggle('on', on);
}
$('auto').onclick = () => setAuto(!auto);
$('route-stop').onclick = () => { if (selected >= 0) battle.clearRoute(selected); };

// build wheel: tapping your tile that has no structure opens a ring of the 5 buildings around it.
// tap a sector to build (paid with that tile's troops); the hole in the middle and everything
// outside the ring stay tappable, so sending troops works as usual (and closes the wheel)
let wheelOn = false, wheelFor = -1, wheelPos = '';
const wheelColors = { farm: ['#ffd76a', '#e0a020'], barracks: ['#f07a6a', '#c8372e'], fort: ['#b7c0c8', '#77828d'], hospital: ['#ffffff', '#d8dde0'], lab: ['#8fe3f2', '#2aa8c8'] };
function renderWheel() {
  const box = $('wheel'), s = battle && selected >= 0 ? battle.segs[selected] : null;
  const want = wheelOn && s && s.owner === 0 && !s.building && !s.capital ? selected : -1;
  if (want === wheelFor) return;
  wheelFor = want;
  wheelPos = '';
  box.classList.toggle('hidden', want < 0);
  if (want < 0) { box.innerHTML = ''; return; }
  const R = 104, r0 = 40, types = Object.keys(buildings), n = types.length, gap = 0.035;
  const pt = (rad, a) => `${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`;
  let svg = `<svg width="${R * 2}" height="${R * 2}" viewBox="${-R} ${-R} ${R * 2} ${R * 2}" style="left:${-R}px;top:${-R}px">
    <defs><linearGradient id="wheel-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a0"/><stop offset="0.5" stop-color="#e0a43a"/><stop offset="1" stop-color="#9a6420"/></linearGradient>
    ${types.map((t) => `<radialGradient id="wg-${t}" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="${wheelColors[t][0]}"/><stop offset="1" stop-color="${wheelColors[t][1]}"/></radialGradient>`).join('')}</defs>`;
  types.forEach((t, i) => {
    const a0 = -Math.PI / 2 - Math.PI / n + (i / n) * Math.PI * 2 + gap, a1 = a0 + (Math.PI * 2) / n - gap * 2, am = (a0 + a1) / 2;
    const d = `M${pt(r0, a0)} L${pt(R - 3, a0)} A${R - 3},${R - 3} 0 0 1 ${pt(R - 3, a1)} L${pt(r0, a1)} A${r0},${r0} 0 0 0 ${pt(r0, a0)} Z`;
    const [ix, iy] = pt(60, am).split(','), [nx, ny] = pt(84, am).split(',');
    svg += `<g class="sector" data-type="${t}"><path class="bg" d="${d}"/>
      <circle class="ico-bg" cx="${ix}" cy="${iy - 2}" r="16" fill="url(#wg-${t})"/>
      <text x="${ix}" y="${iy - 1}" font-size="16">${buildings[t].icon}</text>
      <text class="name" x="${nx}" y="${+ny - 4}"${buildings[t].name.length > 6 ? ' style="font-size:8.5px"' : ''}>${buildings[t].name}</text>
      <text class="cost" x="${nx}" y="${+ny + 8}">${battle.costOf(0, t)}</text></g>`;
  });
  svg += `<circle class="rim" r="${R - 1}"/><circle class="rim" r="${r0 - 1}" style="stroke-width:3"/></svg>`;
  box.innerHTML = svg;
  for (const g of box.querySelectorAll('.sector')) {
    g.addEventListener('pointerdown', (e) => e.stopPropagation());
    g.addEventListener('click', () => {
      if (battle.build(0, selected, g.dataset.type)) sfx.build();
      else flash(`${buildings[g.dataset.type].name} needs ${battle.costOf(0, g.dataset.type)} troops in this tile`);
    });
  }
  updateWheel();
}
// sector states (enough troops?) and position over the tile, following zoom / pan
function updateWheel() {
  if (wheelFor < 0) return;
  const s = battle.segs[wheelFor];
  for (const g of $('wheel').querySelectorAll('.sector')) g.classList.toggle('off', s.troops < battle.costOf(0, g.dataset.type));
  const r = bv.canvas.getBoundingClientRect(), wr = $('battle-wrap').getBoundingClientRect();
  const left = Math.round(r.left - wr.left + (bv.sx(s.x) * r.width) / bv.size), top = Math.round(r.top - wr.top + (bv.sy(s.y) * r.height) / bv.cssH);
  const pos = `${left}px,${top}px`;
  if (pos !== wheelPos) { wheelPos = pos; $('wheel').style.transform = `translate(${pos})`; }
}

// capital: nothing can be built; its carried-over bonuses
function capitalInfo(s) {
  const b = s.bonus, pc = (v) => `+${Math.round(v * 100)}%`;
  return `<br>Bonuses: ${pc(b.growth)} growth here · ${pc(b.hosp)} in neighbours · ${pc(b.lab)} everywhere · defense ${pc(b.def)} · attack ${pc(b.atk)}`;
}

function updatePanel() {
  // segment info line: selected segment, or the hovered one
  const sid = selected >= 0 ? selected : hover;
  if (sid >= 0) {
    const s = battle.segs[sid], who = s.owner < 0 ? 'Neutral' : factionNames[battle.factions[s.owner].color];
    const mult = [s.building === 'fort' && `🛡️ defense x${effects.fortDefense}`, s.building === 'barracks' && `⚔️ attack x${effects.barracksAttack}`].filter(Boolean).join(' · ');
    const col = s.owner < 0 ? neutralColor : factionColors[battle.factions[s.owner].color];
    $('seg-info').innerHTML = `<b style="color:${col}">${who}</b>
      ${s.trait ? `· ${traits[s.trait].name} (${traits[s.trait].desc}) ` : ''}${s.relic ? `· ✨ Relic: ${perks.find((p) => p.id === s.relic).name} (${perks.find((p) => p.id === s.relic).desc}, for whoever holds it) ` : ''}· ${Math.floor(s.troops)} / ${s.owner < 0 ? s.garrison + ' (regrows to it at +' + s.baseGrowth + '/s)' : s.cap + ' troops · +' + s.growth + '/s'}${s.capital ? ' · 🏰 Capital' : s.building ? ' · ' + buildings[s.building].icon + ' ' + buildings[s.building].name : ''}${mult ? ' · ' + mult : ''}${s.capital && s.owner === 0 ? capitalInfo(s) : ''}`;
  } else $('seg-info').textContent = '';
  // selected tile's route (if any) with a stop button
  const route = selected >= 0 ? battle.routes.get(selected) : null;
  $('route-info').classList.toggle('hidden', !route);
  if (route) $('route-info').firstElementChild.textContent = `🔁 Route active, keeps ${Math.round(route.keep * 100)}% of cap`;
  const res = battle.factions[0].reserve;
  $('clock').textContent = fmtTime(battle.time) + (res >= 1 ? ` · 🏕️ ${Math.floor(res)}` : '');
  $('clock').title = res >= 1 ? 'Reserve: flows into your capital when it has room' : '';
}

for (const b of document.querySelectorAll('#pct button')) {
  b.onclick = () => setPct(+b.dataset.pct);
}
function setPct(p) {
  pct = p;
  for (const b of document.querySelectorAll('#pct button')) b.classList.toggle('on', +b.dataset.pct === p);
}

for (const b of document.querySelectorAll('#speed button')) b.onclick = () => setSpeed(+b.dataset.speed);
function setSpeed(s) {
  paused = s === 0;
  if (s > 0) speed = s;
  for (const b of document.querySelectorAll('#speed button')) b.classList.toggle('on', +b.dataset.speed === (paused ? 0 : speed));
}

// stats grid for end screens: fights, economy, territory, buildings by type
function statsHtml(b) {
  const st = b.stats, n = (v) => Math.round(v).toLocaleString();
  const mine = b.segs.filter((s) => s.owner === 0);
  const blds = Object.entries(buildings).map(([k, v]) => [v.icon, mine.filter((s) => s.building === k).length]).filter(([, c]) => c);
  const cells = [
    ['⏱️', fmtTime(b.time), 'time'], ['🗡️', n(st.killed), 'killed'], ['💀', n(st.deaths), 'troops lost'],
    ['🌱', n(st.made), 'troops raised'], ['🏳️', st.captured, 'tiles taken'], ['🏚️', st.lost, 'tiles lost'],
    ['🗺️', `${mine.length} / ${Math.max(st.peak, mine.length)}`, 'tiles held / peak'], ['🏗️', st.built, 'built'], ['📣', st.sent, 'orders'],
  ];
  return `<div class="stats">${cells.map(([i, v, l]) => `<div><span>${i}</span><b>${v}</b><small>${l}</small></div>`).join('')}</div>`
    + (blds.length ? `<p class="blds">Standing buildings: ${blds.map(([i, c]) => `${i} ${c}`).join(' · ')}</p>` : '');
}

function endBattle() {
  const won = battle.state === 'won';
  if (mode === 'expedition') return endStage(won);
  // regular end card: undo the expedition variants
  $('end-perks').innerHTML = '';
  $('end-retry').textContent = '↻ Retry';
  $('end-continue').classList.remove('hidden');
  if (won && mode === 'campaign') { campaign.conquer(regionId); pickedRegion = -1; }
  if (won && mode === 'skirmish') addQuickWin();
  const st = battle.stats;
  $('end-title').textContent = won ? (mode === 'campaign' ? '🏳️ Region conquered!' : '🏆 Victory!') : '💀 Defeated';
  $('end-stats').innerHTML = statsHtml(battle);
  $('end-retry').classList.toggle('hidden', won);
  $('end').classList.remove('hidden');
}
$('end-continue').onclick = () => { if (mode === 'campaign') show('campaign'); else show('menu'); };
$('end-retry').onclick = () => {
  if (mode === 'campaign') startBattle(campaign.battleSetup(regionId), 'campaign', regionId);
  else if (mode === 'expedition') startExpedition();
  else startSkirmish();
};

// ---------- expedition (zoom-out roguelite) ----------
let expedition = null;

function startExpedition() {
  expedition = new Expedition(Math.floor(Math.random() * 1e9));
  startBattle(expedition.setup(), 'expedition');
  flash(`🧭 Stage 1: ${expedition.current.name}`);
}

// stage over: run lost / world won / collapse into the next capital and pick a perk
function endStage(won) {
  $('end-perks').innerHTML = '';
  const last = expedition.stage === stages.length - 1;
  if (!won || last) {
    if (won) expedition.collapse(battle);
    const reached = won ? stages.length : expedition.stage + 1;
    const record = expedition.saveBest(reached);
    $('end-title').textContent = won ? '🌍 The world is yours!' : `💀 Expedition over: ${expedition.current.name}`;
    $('end-stats').innerHTML = `<p>Reached stage ${reached}/${stages.length} · total time ${fmtTime(expedition.time + (won ? 0 : battle.time))}${record ? ' · 🏆 new best' : ''}</p>` + statsHtml(battle);
    $('end-retry').textContent = '↻ New expedition';
    $('end-retry').classList.remove('hidden');
    $('end-continue').classList.remove('hidden');
    $('end').classList.remove('hidden');
    return;
  }
  const from = expedition.current, sum = expedition.collapse(battle), b = sum.bonus, pc = (v) => `+${Math.round(v * 100)}%`;
  const share = (k, label, eff) => (k ? `<li>${label}: ${k}/${sum.segments} → ${eff}</li>` : '');
  $('end-title').textContent = `🏳️ ${from.name} conquered`;
  $('end-stats').innerHTML = statsHtml(battle) + `Your ${sum.segments} segments become one capital with <b>${sum.troops.toLocaleString()}</b> people.
    <ul class="carry">
      ${share(sum.farms, '🌾 Farms', pc(b.growth) + ' growth')}${share(sum.hosp, '➕ Hospitals', pc(b.hosp) + ' neighbour growth')}
      ${share(sum.labs, '🔬 Labs', pc(b.lab) + ' growth everywhere')}${share(sum.forts, '🛡️ Forts', pc(b.def) + ' defense')}
      ${share(sum.barracks, '⚔️ Barracks', pc(b.atk) + ' attack')}
    </ul>Next: <b>${expedition.current.name}</b>. Pick a perk:`;
  for (const p of expedition.choices()) {
    const btn = document.createElement('button');
    btn.className = 'perk';
    btn.innerHTML = `<span class="ico">${p.icon}</span><span><b>${p.name}</b><br><small>${p.desc}</small></span>`;
    btn.onclick = () => { expedition.perks.push(p.id); $('end').classList.add('hidden'); zoomOut(); };
    $('end-perks').appendChild(btn);
  }
  $('end-retry').classList.add('hidden');
  $('end-continue').classList.add('hidden');
  $('end').classList.remove('hidden');
}

// zoom-out: the old map shrinks into the new capital while the bigger map fades in around it
function zoomOut() {
  const wrap = bv.canvas.parentElement, old = bv.canvas;
  const snap = document.createElement('canvas');
  snap.width = old.width; snap.height = old.height;
  snap.getContext('2d').drawImage(old, 0, 0);
  const wr = wrap.getBoundingClientRect(), or = old.getBoundingClientRect();
  Object.assign(snap.style, { position: 'absolute', left: or.left - wr.left + 'px', top: or.top - wr.top + 'px', width: or.width + 'px', height: or.height + 'px' });
  snap.className = 'zoom-snap';
  wrap.appendChild(snap);
  startBattle(expedition.setup(), 'expedition');
  paused = true;
  requestAnimationFrame(() => {
    const cap = battle.segs[battle.factions[0].capitalSeg];
    const nr = old.getBoundingClientRect(), tx = cap ? bv.sx(cap.x) : nr.width / 2, ty = cap ? bv.sy(cap.y) : nr.height / 2;
    // new map starts zoomed in on the capital, old map sits on top and shrinks into it
    old.style.transformOrigin = `${tx}px ${ty}px`;
    old.style.transform = 'scale(3)';
    old.style.opacity = '0';
    const dx = nr.left - wr.left + tx - (or.left - wr.left + or.width / 2), dy = nr.top - wr.top + ty - (or.top - wr.top + or.height / 2);
    $('zoom-banner').innerHTML = `Zooming out…<br><b>${expedition.current.name}</b>`;
    $('zoom-banner').classList.add('show');
    requestAnimationFrame(() => {
      old.classList.add('zooming');
      snap.classList.add('zooming');
      old.style.transform = 'scale(1)';
      old.style.opacity = '1';
      snap.style.transform = `translate(${dx}px, ${dy}px) scale(0.06)`;
      snap.style.opacity = '0';
    });
    setTimeout(() => {
      snap.remove();
      old.classList.remove('zooming');
      old.style.transform = old.style.opacity = old.style.transformOrigin = '';
      $('zoom-banner').classList.remove('show');
      paused = false;
      setSpeed(speed);
    }, 1900);
  });
}

let flashTimer = 0;
function flash(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $('toast').classList.remove('show'), 1200);
}

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------- menu: live demo battle in the background ----------
// four bots fight on a decorative island behind the menu (attract mode); a new island when it ends
let demo = null, mv = null, demoAcc = 0, demoN = 0;
function newDemo() {
  const seed = 4242 + demoN * 977, r = rng(seed), types = Object.keys(personalities);
  const map = generateMap({ seed, cells: 18, grid: rules.grid, shape: 'random', obstacles: true });
  demo = new Battle(map, {
    seed, neutral: [0.1, 0.25],
    factions: [0, 1, 2, 3].map((color) => ({ ai: true, color, think: 1.4, personality: personalities[types[Math.floor(r() * types.length)]] })),
  });
  // a few ready-made buildings so the island looks lived in
  const blds = Object.keys(buildings);
  demo.segs.forEach((s, i) => { if (r() < 0.3 && !s.capital) s.building = blds[i % blds.length]; });
  const theme = themeNames[demoN % themeNames.length];
  if (!mv) mv = new MapView($('menu-canvas'), map, theme); else mv.setMap(map, theme);
  demoN++;
}
function drawMenu(dt) {
  if (!demo || demo.state !== 'running' || demo.time > 240) newDemo();
  demoAcc += dt;
  while (demoAcc >= rules.step) { demo.step(rules.step); demoAcc -= rules.step; }
  demo.events.length = 0;   // demo is silent
  mv.paint((id) => {
    const s = demo.segs[id];
    return { color: s.owner < 0 ? null : colors[demo.factions[s.owner].color], fill: s.owner < 0 ? 0 : 0.16, building: s.building ?? (s.relic ? 'relic' : s.home ? 'home' : null) };
  });
  drawUnits(mv.drawBase(), mv, demo, demoAcc, false);
}

// menu badges: campaign progress, best expedition, quick battle wins
function renderMenuStats() {
  const best = Expedition.best();
  $('m-regions').textContent = `🏳️ ${campaign.owned.size}/${campaign.regions.length}`;
  $('m-best').textContent = best ? `🧭 Stage ${best.stage}` : '🧭 —';
  $('m-wins').textContent = `🏆 ${quickWins()}`;
  $('m-campaign').textContent = `${campaign.owned.size}/${campaign.regions.length} regions conquered`;
  $('m-expedition').textContent = best ? `Best: stage ${best.stage}/5` : 'Valley → World roguelite';
}
const wins_key = 'frontlines.quickwins';
function quickWins() { try { return +localStorage.getItem(wins_key) || 0; } catch { return 0; } }
function addQuickWin() { try { localStorage.setItem(wins_key, quickWins() + 1); } catch { /* storage blocked */ } }

// ---------- menu, help, keyboard ----------
$('btn-campaign').onclick = () => show('campaign');
$('btn-skirmish').onclick = startSkirmish;
$('btn-expedition').onclick = startExpedition;
$('btn-help').onclick = () => $('help').classList.remove('hidden');
$('help-close').onclick = () => $('help').classList.add('hidden');
$('campaign-back').onclick = () => show('menu');
$('campaign-reset').onclick = () => {
  if (confirm('Reset campaign progress?')) { campaign.reset(); pickedRegion = -1; paintCampaign(); }
};
$('battle-quit').onclick = () => {
  if (battle.state !== 'running' || confirm('Leave this battle?')) show(mode === 'campaign' ? 'campaign' : 'menu');
};
$('help-buildings').innerHTML = Object.values(buildings).map((b) => `<li>${b.icon} <b>${b.name}</b> (cost ${b.cost}): ${b.desc}</li>`).join('');

addEventListener('keydown', (e) => {
  if (screen !== 'battle') return;
  if (e.key === ' ') { setSpeed(paused ? speed : 0); e.preventDefault(); }
  if (['1', '2', '3', '4'].includes(e.key)) setPct(+e.key * 0.25);
  if (e.key === 'Escape') selected = -1;
  if (e.key === 'a' || e.key === 'A') setAuto(!auto);
});
addEventListener('resize', () => { if (screen === 'battle' && bv) { bv.resize(); key = ''; } if (screen === 'campaign') cv.resize(), paintCampaign(); });

// ---------- frame loop: fixed-step simulation, draw every frame ----------
let last = performance.now(), acc = 0, uiTimer = 0;
// battle sounds: war cry when a fight starts, horns on captures that involve you, a marching beat
// while armies walk (louder for bigger armies), random sword clashes while fights last
let marchTimer = 0, clashTimer = 0, shoutCool = 0;
function playBattleSounds(dt) {
  shoutCool -= dt;
  for (const e of battle.events.splice(0)) {
    if (e.type === 'fight' && shoutCool <= 0) { sfx.shout(Math.min(1, e.size / 150)); shoutCool = 0.35; }
    if (e.type === 'capture') { if (e.owner === 0 || e.prev === 0) sfx.capture(e.owner === 0); else sfx.captureFar(); }
  }
  if (paused || battle.state !== 'running') return;
  const marching = battle.armies.filter((a) => !a.fight && !a.clash), fights = battle.armies.filter((a) => a.fight || a.clash).length;
  marchTimer -= dt;
  if (marching.length && marchTimer <= 0) {
    sfx.march(Math.min(1, marching.reduce((v, a) => v + a.n, 0) / 200));
    marchTimer = 0.42 / Math.sqrt(speed);
  }
  clashTimer -= dt;
  if (fights && clashTimer <= 0) { sfx.clash(); clashTimer = (0.09 + Math.random() * 0.25) / Math.min(3, fights); }
}

// runs at the monitor's refresh rate (60, 144 Hz ...): the sim advances in fixed steps,
// drawing interpolates between them (see acc in drawBattle)
function frame(now) {
  requestAnimationFrame(frame);   // schedule first, so an error in one frame never stops the loop
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (screen === 'battle' && battle) {
    if (countdown > 0) {
      // 3-2-1: the map is live to look at, but nothing moves until it's over. it waits while
      // paused (e.g. the expedition zoom-out), so the first drum hits when the numbers appear
      if (!paused) {
        if (countdown === 3) sfx.drum(0);
        const before = Math.ceil(countdown);
        countdown = Math.max(0, countdown - dt);
        if (Math.ceil(countdown) !== before) {
          if (countdown > 0) sfx.drum(3 - Math.ceil(countdown));
          else { sfx.horn(); goFlash = 1; }
        }
      }
    } else if (!paused && battle.state === 'running') {
      goFlash = Math.max(0, goFlash - dt * 1.1);
      acc += dt * speed;
      while (acc >= rules.step) { battle.step(rules.step); acc -= rules.step; }
    }
    // show the result card once, however the battle ended
    if (battle.state !== 'running' && !battle.endShown) { battle.endShown = true; endBattle(); }
    playBattleSounds(dt);
    drawBattle();
    uiTimer -= dt;
    if (uiTimer <= 0) { updatePanel(); uiTimer = 0.15; }
  } else if (screen === 'campaign') drawCampaign();
  else if (screen === 'menu') drawMenu(dt);
}
requestAnimationFrame(frame);
setPct(0.5);
setSpeed(1);

// audio: start on the first gesture, toggles remembered
addEventListener('pointerdown', initAudio, { capture: true });
// phones: the first tap anywhere in the game goes fullscreen (browser bars hidden). browsers only
// allow this from a user gesture; unsupported (iphone safari) or refused requests are ignored
function goFullscreen() {
  const el = document.documentElement;
  if (!matchMedia('(pointer: coarse)').matches || document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))   // phones: landscape only
    .catch(() => {});
}
addEventListener('pointerup', goFullscreen, { capture: true });
addEventListener('keydown', initAudio, { capture: true });
function syncAudioButtons() {
  $('btn-sfx').classList.toggle('off', !audioPrefs.sfx);
  $('btn-music').classList.toggle('off', !audioPrefs.music);
  $('bar-music').classList.toggle('off', !audioPrefs.music);
}
$('btn-sfx').onclick = () => { setSfx(!audioPrefs.sfx); syncAudioButtons(); sfx.click(); };
$('btn-music').onclick = $('bar-music').onclick = () => { setMusic(!audioPrefs.music); syncAudioButtons(); };
syncAudioButtons();
renderMenuStats();

// hooks for headless tests
window.__fl = { skipCountdown: () => { countdown = 0; goFlash = 0; }, campaign, startSkirmish, startBattle, startExpedition, get expedition() { return expedition; }, get battle() { return battle; }, get view() { return bv; }, cview: cv };
