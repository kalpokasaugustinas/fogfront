// app shell: menu, campaign map, battle screen, input and the frame loop
import { rules, buildings, effects, factionColors, factionNames, colorNames, troopStyles, buildingStyles, neutralColor, themeNames, traits } from './config.js?v=35';
import { generateMap, rng } from './mapgen.js?v=35';
import { Battle } from './battle.js?v=35';
import { personalities } from './ai.js?v=35';
import { Campaign } from './campaign.js?v=35';
import { Expedition, stages, perks } from './expedition.js?v=35';
import { initAudio, sfx, setSfx, setMusic, setTrack, audioPrefs, audioState, audioFiles } from './audio.js?v=35';
import { MapView, hexToRgb, shade, label, pill, unitSprite, pagePoint, pageRect } from './render.js?v=35';
import { previewBuildings } from './structures.js?v=35';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const autoplay = params.has('autoplay');   // test mode: the player side is played by a bot too

const colors = factionColors.map(hexToRgb);
const neutral = hexToRgb(neutralColor);

// ---------- screens ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  screen = id;
  setTrack(id === 'battle' ? 'battle' : 'menu');   // aphelion on menus, rotating war tracks in battle
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
let auto = true, selected = -1, pct = 0.5, drag = null, hover = -1, speed = 1, paused = false, key = '';

// ---------- commander profile: your colour, troop style and building style ----------
const profileKey = 'frontlines.profile';
let profile = { color: 0, troops: 'soldier', buildings: 'classic' };
try { profile = { ...profile, ...JSON.parse(localStorage.getItem(profileKey) || '{}') }; } catch { /* private mode: defaults */ }
function saveProfile() { try { localStorage.setItem(profileKey, JSON.stringify(profile)); } catch { /* not saved */ } }

// give every side its look: the player gets the profile (and swaps colours with the bot that had
// it), bots get a random troop / building style, different from each other where possible
function dress(factions, seed, withPlayer = true) {
  const r = rng(seed ^ 0x5eed);
  if (withPlayer && factions[0] && !factions[0].ai) {
    const mine = factions[0].color, other = factions.find((f, i) => i > 0 && f.color === profile.color);
    if (other) other.color = mine;
    factions[0].color = profile.color;
    factions[0].skin = { troops: profile.troops, buildings: profile.buildings };
  }
  const shuffle = (a) => a.map((v) => [r(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const pick = (all, taken) => { const free = shuffle(all.filter((v) => !taken.includes(v))); return free.length ? free : shuffle(all); };
  const tPool = pick(Object.keys(troopStyles), withPlayer ? [profile.troops] : []), bPool = pick(Object.keys(buildingStyles), withPlayer ? [profile.buildings] : []);
  factions.forEach((f, i) => {
    if (f.skin) return;
    f.skin = { troops: tPool[i % tPool.length], buildings: bPool[(i + 1) % bPool.length] };
  });
  return factions;
}

function startBattle(setup, m, rid = -1) {
  // battle maps: random island shape + lakes/mountains (setup.shape can force a shape)
  const map = generateMap({ seed: setup.seed, cells: setup.cells, grid: rules.grid, shape: setup.shape ?? 'random', obstacles: true, detail: setup.detail ?? 1, stamp: setup.stamp ?? null });
  if (autoplay) setup.factions[0] = { ai: true, color: 0, think: 1.5, personality: personalities.aggressive };
  dress(setup.factions, setup.seed);
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
    if (o < 0) return { color: null, fill: 0, building, huts: !building };   // neutral: shacks show people live there
    return { color: colors[battle.factions[o].color], fill: 0.16, building, skin: battle.factions[o].skin?.buildings };
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
    const u = unitSprite(kind, s.owner < 0 ? '#8a8f86' : factionColors[b.factions[s.owner].color], z, dpr, s.owner < 0 ? 'soldier' : b.factions[s.owner].skin?.troops);
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
    const col = factionColors[b.factions[a.owner].color], u = unitSprite(kind, col, z, dpr, b.factions[a.owner].skin?.troops);
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
  // highlight: the tile you're dragging from (with its neighbours), else the selected tile
  const hl = drag ? drag.from : selected;
  if (hl >= 0) bv.highlight(ctx, hl, colors[battle.factions[0].color], battle.segs[hl].adj, performance.now() / 1000);
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
    ctx.fillStyle = factionColors[battle.factions[0].color];
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
  const r = pageRect(bv.canvas), p = pagePoint(e.clientX, e.clientY);
  return { x: ((p.x - r.left) * bv.size) / r.width, y: ((p.y - r.top) * bv.cssH) / r.height };
}

// ---------- zoom + pan ----------
// the map sits in #cam, which is scaled / moved with a css transform (cheap, no redraw). pinch or
// mouse wheel zooms (1x-5x) around the fingers / cursor; one finger on empty ground pans. when
// zooming settles, the view re-renders at a higher resolution so it stays sharp
const zoomMax = 5, cam = { z: 1, x: 0, y: 0 }, pointers = new Map();
let pinch = null, boostTimer = 0;
function setCam(z, x, y) {
  const w = $('battle-wrap').clientWidth, h = $('battle-wrap').clientHeight;
  cam.z = Math.min(zoomMax, Math.max(1, z));
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
  nz = Math.min(zoomMax, Math.max(1, nz));
  const wx = (px - cam.x) / cam.z, wy = (py - cam.y) / cam.z;
  setCam(nz, px - wx * nz, py - wy * nz);
}
function wrapPos(e) {
  const r = pageRect($('battle-wrap')), p = pagePoint(e.clientX, e.clientY);
  return { x: p.x - r.left, y: p.y - r.top };
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
// one finger = a gesture, decided when it moves or ends:
// - drag from your tile to a neighbour = send troops there (attack, or move to your own tile;
//   with auto on, a move also sets a standing route). released anywhere else = nothing sent
// - drag starting anywhere else = pan the map
// - tap your tile = select it and open its build wheel; tap anything else = close / deselect
// two fingers = pinch zoom
let gesture = null;
$('battle-canvas').addEventListener('pointerdown', (e) => {
  if (!battle) return;
  bv.canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, wrapPos(e));
  if (pointers.size === 2) {
    gesture = drag = null;
    pinch = { ...pinchInfo(), z0: cam.z, x0: cam.x, y0: cam.y };
    return;
  }
  if (pointers.size > 2) return;
  const sid = bv.segAt(e.clientX, e.clientY);
  hover = sid;
  gesture = { sid, ...wrapPos(e), x0: cam.x, y0: cam.y, mode: null };
});
$('battle-canvas').addEventListener('pointermove', (e) => {
  if (!battle) return;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, wrapPos(e));
  if (pinch && pointers.size === 2) {
    // keep the map point under the pinch centre under the fingers while scaling
    const p = pinchInfo(), nz = Math.min(zoomMax, Math.max(1, pinch.z0 * (p.d / Math.max(1, pinch.d))));
    const wx = (pinch.x - pinch.x0) / pinch.z0, wy = (pinch.y - pinch.y0) / pinch.z0;
    setCam(nz, p.x - wx * nz, p.y - wy * nz);
    return;
  }
  hover = bv.segAt(e.clientX, e.clientY);
  if (!gesture) return;
  const p = wrapPos(e);
  if (!gesture.mode && Math.hypot(p.x - gesture.x, p.y - gesture.y) > 8) {
    const troopDrag = isMine(gesture.sid) && battle.state === 'running' && countdown <= 0;
    gesture.mode = troopDrag ? 'drag' : 'pan';
    if (troopDrag) drag = { from: gesture.sid, moved: true, ...localPos(e) };
  }
  if (gesture.mode === 'pan') setCam(cam.z, gesture.x0 + p.x - gesture.x, gesture.y0 + p.y - gesture.y);
  else if (gesture.mode === 'drag') Object.assign(drag, localPos(e));
});
function pointerEnd(e) {
  pointers.delete(e.pointerId);
  if (pinch && pointers.size < 2) pinch = null;
}
$('battle-canvas').addEventListener('pointercancel', (e) => { pointerEnd(e); gesture = drag = null; });
$('battle-canvas').addEventListener('pointerup', (e) => {
  const wasPinch = !!pinch, g = gesture;
  pointerEnd(e);
  gesture = null;
  if (wasPinch || !g) { drag = null; return; }
  const playing = battle.state === 'running' && countdown <= 0;
  if (g.mode === 'drag') {
    const to = bv.segAt(e.clientX, e.clientY);
    if (playing && canTarget(g.sid, to)) sendFrom(g.sid, to);
  } else if (!g.mode && playing) tapAt(g.sid);
  drag = null;
});

// a tap on tile sid (or -1 = off the map): your tile = select it + build wheel (tiles with a
// structure or capitals just show their info / route); the same tile again or anything else = close
function tapAt(sid) {
  if (isMine(sid) && sid !== selected) { selected = sid; wheelOn = true; }
  else { selected = -1; wheelOn = false; }
}

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
// white line icons (24x24, stroked) per building
const wheelIcons = {
  farm: '<path d="M12 22V9"/><path d="M12 9c-2.5 0-4-1.8-4-4 2.5 0 4 1.8 4 4zM12 9c2.5 0 4-1.8 4-4-2.5 0-4 1.8-4 4z"/><path d="M12 14c-2.5 0-4-1.8-4-4 2.5 0 4 1.8 4 4zM12 14c2.5 0 4-1.8 4-4-2.5 0-4 1.8-4 4z"/><path d="M12 19c-2.5 0-4-1.8-4-4 2.5 0 4 1.8 4 4zM12 19c2.5 0 4-1.8 4-4-2.5 0-4 1.8-4 4z"/>',
  barracks: '<path d="M4 4l11 11M4 4v3l10 10M4 4h3l10 10"/><path d="M20 4L9 15M20 4v3L10 17M20 4h-3L7 14"/><path d="M13 17l4 4M11 17l-4 4"/>',
  fort: '<path d="M4 21V9h3V6h2v3h2V6h2v3h2V6h2v3h3v12z"/><path d="M10 21v-5a2 2 0 0 1 4 0v5"/>',
  hospital: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  lab: '<path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7.5 15h9"/><circle cx="10.5" cy="17.5" r=".6"/><circle cx="13.5" cy="18" r=".6"/>',
};
function renderWheel() {
  const box = $('wheel'), s = battle && selected >= 0 ? battle.segs[selected] : null;
  const want = wheelOn && s && s.owner === 0 && !s.building && !s.capital ? selected : -1;
  if (want === wheelFor) return;
  wheelFor = want;
  wheelPos = '';
  box.classList.toggle('hidden', want < 0);
  if (want < 0) { box.innerHTML = ''; return; }
  // ring of wedges between r0 and R, thin gaps, tick marks on the outer rim (like a game hud dial)
  const R = 100, r0 = 46, types = Object.keys(buildings), n = types.length, gap = 0.025;
  const pt = (rad, a) => [Math.cos(a) * rad, Math.sin(a) * rad].map((v) => v.toFixed(1));
  let svg = `<svg width="${(R + 8) * 2}" height="${(R + 8) * 2}" viewBox="${-R - 8} ${-R - 8} ${(R + 8) * 2} ${(R + 8) * 2}" style="left:${-R - 8}px;top:${-R - 8}px">
    <defs><radialGradient id="wheel-hot" cx="0" cy="0" r="${R}" gradientUnits="userSpaceOnUse"><stop offset="0.45" stop-color="#e0961a" stop-opacity="0.35"/><stop offset="1" stop-color="#ffd76a" stop-opacity="0.95"/></radialGradient></defs>
    <circle class="glass" r="${R}"/><circle class="hole" r="${r0}"/>`;
  for (let i = 0; i < 60; i++) {   // tick marks
    const a = (i / 60) * Math.PI * 2, [x1, y1] = pt(R + 2, a), [x2, y2] = pt(R + (i % 5 ? 4 : 7), a);
    svg += `<line class="tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  types.forEach((t, i) => {
    const a0 = -Math.PI / 2 - Math.PI / n + (i / n) * Math.PI * 2 + gap, a1 = a0 + (Math.PI * 2) / n - gap * 2, am = (a0 + a1) / 2;
    const [ax, ay] = pt(r0 + 2, a0), [bx, by] = pt(R - 2, a0), [cx, cy] = pt(R - 2, a1), [dx, dy] = pt(r0 + 2, a1);
    const d = `M${ax},${ay} L${bx},${by} A${R - 2},${R - 2} 0 0 1 ${cx},${cy} L${dx},${dy} A${r0 + 2},${r0 + 2} 0 0 0 ${ax},${ay} Z`;
    const [ix, iy] = pt(72, am);
    svg += `<g class="sector" data-type="${t}"><path class="bg" d="${d}"/>
      <g class="ico" transform="translate(${ix},${iy - 7}) scale(1.3) translate(-12,-12)">${wheelIcons[t]}</g>
      <text class="cost" x="${ix}" y="${+iy + 17}">${battle.costOf(0, t)}</text></g>`;
  });
  svg += `<circle class="rim" r="${R}"/><circle class="rim inner" r="${r0}"/></svg>`;
  box.innerHTML = svg;
  // small screens (phone landscape): shrink the wheel to fit around the tile
  const k = Math.max(0.62, Math.min(1, $('battle-wrap').clientHeight / 560));
  box.firstElementChild.style.setProperty('--k', k);
  box.firstElementChild.style.transformOrigin = `${R + 8}px ${R + 8}px`;
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
  const r = pageRect(bv.canvas), wr = pageRect($('battle-wrap'));
  const left = Math.round(r.left - wr.left + (bv.sx(s.x) * r.width) / bv.size), top = Math.round(r.top - wr.top + (bv.sy(s.y) * r.height) / bv.cssH);
  const pos = `${left}px,${top}px`;
  if (pos !== wheelPos) { wheelPos = pos; $('wheel').style.transform = `translate(${pos})`; }
}

// capital: nothing can be built; its carried-over bonuses
function capitalInfo(s) {
  const b = s.bonus, pc = (v) => `+${Math.round(v * 100)}%`;
  return `Bonuses: ${pc(b.growth)} growth here · ${pc(b.hosp)} in neighbours · ${pc(b.lab)} everywhere · defense ${pc(b.def)} · attack ${pc(b.atk)}`;
}

function updatePanel() {
  // segment info line: selected segment, or the hovered one
  const sid = selected >= 0 ? selected : hover;
  if (sid >= 0) {
    const s = battle.segs[sid], who = s.owner < 0 ? 'Neutral' : s.owner === 0 ? 'You' : colorNames[battle.factions[s.owner].color];
    const mult = [s.building === 'fort' && `🛡️ defense x${effects.fortDefense}`, s.building === 'barracks' && `⚔️ attack x${effects.barracksAttack}`].filter(Boolean).join(' · ');
    const col = s.owner < 0 ? neutralColor : factionColors[battle.factions[s.owner].color];
    // card: owner ribbon (+ tile kind), troops / cap and growth, then chips for terrain, structure, relic
    const relic = s.relic ? perks.find((p) => p.id === s.relic) : null;
    const kind = s.capital ? 'Capital' : s.home ? 'Homeland' : s.camp ? 'Camp' : s.owner < 0 ? 'Village' : 'Territory';
    const rate = s.owner < 0 ? `regrows to ${s.garrison} · +${Math.round(s.baseGrowth * rules.neutralRegrow * 10) / 10}/s` : `+${s.growth}/s`;
    const chips = [
      s.trait && `<span>${traits[s.trait].name}: ${traits[s.trait].desc}</span>`,
      s.building && !s.capital && `<span>${buildings[s.building].icon} ${buildings[s.building].name}</span>`,
      mult && `<span>${mult}</span>`,
      relic && `<span class="gold">✨ ${relic.name}: ${relic.desc}</span>`,
      s.capital && s.owner === 0 && `<span class="gold">${capitalInfo(s)}</span>`,
    ].filter(Boolean).join('');
    $('seg-info').innerHTML = `<div class="who" style="background:${col}">${who}<small>${kind}</small></div>
      <div class="body"><div class="troops">${Math.floor(s.troops)} <small>/ ${s.owner < 0 ? s.garrison : s.cap} · ${rate}</small></div>${chips ? `<div class="chips">${chips}</div>` : ''}</div>`;
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
    ['⏱️', fmtTime(b.time), 'time'], ['🗡️', st.killed, 'killed'], ['💀', st.deaths, 'troops lost'],
    ['🌱', st.made, 'troops raised'], ['🏳️', st.captured, 'tiles taken'], ['🏚️', st.lost, 'tiles lost'],
    ['🗺️', `${mine.length} / ${Math.max(st.peak, mine.length)}`, 'tiles held / peak'], ['🏗️', st.built, 'built'], ['📣', st.sent, 'orders'],
  ];
  // numbers count up when the card opens (data-n = final value); tiles pop in one after another
  const val = (v) => (typeof v === 'number' ? `<b data-n="${Math.round(v)}">0</b>` : `<b>${v}</b>`);
  return `<div class="stats">${cells.map(([i, v, l], k) => `<div style="animation-delay:${0.25 + k * 0.05}s"><span>${i}</span>${val(v)}<small>${l}</small></div>`).join('')}</div>`
    + (blds.length ? `<p class="blds">Standing buildings: ${blds.map(([i, c]) => `${i} ${c}`).join(' · ')}</p>` : '');
}

// end card chrome: win/lose look, stars (1 for the win, +1 no tile lost, +1 under 5 minutes),
// then count the stat numbers up
function showEnd(won, starsFor) {
  $('end').classList.toggle('win', won);
  $('end').classList.toggle('lose', !won);
  if (won && starsFor) {
    const s = starsFor.stats, got = [true, s.lost === 0, starsFor.time < 300];
    $('end-stars').innerHTML = got.map((on) => `<span class="${on ? 'on' : ''}">★</span>`).join('');
    $('end-why').textContent = '★ victory · ★ no tile lost · ★ under 5:00';
  } else $('end-stars').innerHTML = $('end-why').textContent = '';
  $('end').classList.remove('hidden');
  const nums = [...$('end').querySelectorAll('[data-n]')], t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0 - 300) / 900), e = k <= 0 ? 0 : 1 - (1 - k) ** 3;
    for (const el of nums) el.textContent = Math.round(+el.dataset.n * e).toLocaleString();
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  $('end-title').textContent = won ? (mode === 'campaign' ? 'Region conquered!' : 'Victory!') : 'Defeated';
  $('end-stats').innerHTML = statsHtml(battle);
  // quick battle: always offer a fresh map; campaign: retry only after a loss
  $('end-retry').textContent = mode === 'skirmish' ? '▶ Play again' : '↻ Retry';
  $('end-retry').classList.toggle('hidden', won && mode !== 'skirmish');
  $('end-continue').textContent = won ? 'Continue' : 'Menu';
  showEnd(won, won ? battle : null);
  setTrack(won ? 'victory' : 'defeat');
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
    $('end-title').textContent = won ? 'The world is yours!' : 'Expedition over';
    $('end-stats').innerHTML = `<p class="next-up">Reached stage ${reached} · total time ${fmtTime(expedition.time + (won ? 0 : battle.time))}${record ? ' · 🏆 new best' : ''}</p>` + statsHtml(battle);
    $('end-retry').textContent = '▶ New expedition';
    $('end-retry').classList.remove('hidden');
    $('end-continue').textContent = 'Menu';
    $('end-continue').classList.remove('hidden');
    showEnd(won, won ? battle : null);
    setTrack(won ? 'victory' : 'defeat');
    return;
  }
  const from = expedition.current, sum = expedition.collapse(battle), b = sum.bonus, pc = (v) => `+${Math.round(v * 100)}%`;
  const share = (k, label, eff) => (k ? `<li>${label}: ${k}/${sum.segments} → ${eff}</li>` : '');
  $('end-title').textContent = `${from.name} conquered!`;
  $('end-stats').innerHTML = statsHtml(battle) + `<div class="carry-box">Your ${sum.segments} tiles become one capital with <b>${sum.troops.toLocaleString()}</b> people.
    <ul class="carry">
      ${share(sum.farms, '🌾 Farms', pc(b.growth) + ' growth')}${share(sum.hosp, '➕ Hospitals', pc(b.hosp) + ' neighbour growth')}
      ${share(sum.labs, '🔬 Labs', pc(b.lab) + ' growth everywhere')}${share(sum.forts, '🛡️ Forts', pc(b.def) + ' defense')}
      ${share(sum.barracks, '⚔️ Barracks', pc(b.atk) + ' attack')}
    </ul></div><p class="next-up">Next: ${expedition.current.name} · pick a perk</p>`;
  for (const p of expedition.choices()) {
    const btn = document.createElement('button');
    btn.className = 'perk';
    btn.innerHTML = `<span class="ico">${p.icon}</span><span><b>${p.name}</b><br><small>${p.desc}</small></span>`;
    btn.onclick = () => { expedition.perks.push(p.id); $('end').classList.add('hidden'); zoomOut(); };
    $('end-perks').appendChild(btn);
  }
  $('end-retry').classList.add('hidden');
  $('end-continue').classList.add('hidden');
  showEnd(true, battle);
  setTrack('victory');
}

// zoom-out: the old map shrinks into the new capital while the bigger map fades in around it
// expedition stage change, told without words in three steps:
// 1. shrink: only the won island (a snapshot) is left over the fog and shrinks smoothly to the size
//    and place of the new capital tile (the capital has the old island's outline)
// 2. glow: the little island pulses gold: it has become one tile
// 3. reveal: the new map grows outward from that tile in a widening circle, and the little island
//    fades into the capital tile underneath
const zoomSteps = { hold: 0.5, shrink: 2.2, glow: 0.7, reveal: 1.8 };   // seconds
function zoomOut() {
  const wrap = bv.canvas.parentElement, old = bv.canvas;
  // old island: bounding box of its tiles, in canvas css px
  const om = bv.map, g = om.grid;
  let x0 = g, y0 = g, x1 = 0, y1 = 0;
  for (let c = 0; c < g * g; c++) {
    if (om.ids[c] < 0) continue;
    const x = c % g, y = Math.floor(c / g);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const oc = { x: bv.sx((x0 + x1 + 1) / 2), y: bv.sy((y0 + y1 + 1) / 2), w: (x1 - x0 + 1) * bv.scale };
  // redraw the old map clean (no selection, drag arrow or banner) and keep a snapshot of it
  selected = -1; drag = null; goFlash = 0; wheelOn = false;
  drawBattle();
  const snap = document.createElement('canvas');
  snap.width = old.width; snap.height = old.height;
  snap.getContext('2d').drawImage(old, 0, 0);
  const wr = pageRect(wrap), or = pageRect(old);
  const so = { x: or.left - wr.left, y: or.top - wr.top };   // snapshot's place in the wrap
  Object.assign(snap.style, { position: 'absolute', left: so.x + 'px', top: so.y + 'px', width: or.width + 'px', height: or.height + 'px', transformOrigin: '0 0' });
  snap.className = 'zoom-snap';
  wrap.appendChild(snap);
  startBattle(expedition.setup(), 'expedition');
  paused = true;
  old.style.opacity = '0';
  requestAnimationFrame(() => {
    const capId = battle.factions[0].capitalSeg, nr = pageRect(old), no = { x: nr.left - wr.left, y: nr.top - wr.top };
    const box = bv.boxes[capId] ?? [0, 0, g - 1, g - 1];
    const cc = { x: bv.sx((box[0] + box[2] + 1) / 2), y: bv.sy((box[1] + box[3] + 1) / 2), w: (box[2] - box[0] + 1) * bv.scale };
    const ratio = Math.min(1, cc.w / Math.max(1, oc.w));   // old island -> capital tile size
    const from = { x: so.x + oc.x, y: so.y + oc.y }, to = { x: no.x + cc.x, y: no.y + cc.y };   // island centre on screen
    const farthest = Math.hypot(Math.max(cc.x, nr.width - cc.x), Math.max(cc.y, nr.height - cc.y));   // reveal radius at the end
    const { hold, shrink, glow, reveal } = zoomSteps, total = hold + shrink + glow + reveal;
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
    const phase = (t, a, d) => Math.min(1, Math.max(0, (t - a) / d));
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / 1000;
      // 1. shrink (scale falls off exponentially, so it reads as a steady pull-back)
      const k = ease(phase(t, hold, shrink)), s = ratio ** k;
      const px = from.x + (to.x - from.x) * k, py = from.y + (to.y - from.y) * k;
      snap.style.transform = `translate(${px - so.x - s * oc.x}px, ${py - so.y - s * oc.y}px) scale(${s})`;
      // 2. glow: a gold pulse around the little island
      const gk = phase(t, hold + shrink, glow), pulse = Math.sin(gk * Math.PI);
      snap.style.filter = pulse > 0.01 ? `drop-shadow(0 0 ${2 + 10 * pulse}px rgba(255, 210, 90, ${0.9 * pulse}))` : '';
      // 3. reveal: the new map in a growing soft-edged circle around the capital; the island fades
      const rk = ease(phase(t, hold + shrink + glow * 0.5, reveal)), rad = 6 + rk * (farthest + 60);
      const mask = `radial-gradient(circle at ${cc.x}px ${cc.y}px, #000 ${Math.max(0, rad - 50)}px, transparent ${rad}px)`;
      old.style.opacity = rk > 0 ? '1' : '0';
      old.style.webkitMaskImage = old.style.maskImage = rk >= 1 ? '' : mask;
      snap.style.opacity = String(1 - phase(t, hold + shrink + glow * 0.6, reveal * 0.5));
      if (t < total) { requestAnimationFrame(tick); return; }
      snap.remove();
      old.style.opacity = old.style.webkitMaskImage = old.style.maskImage = '';
      paused = false;
      setSpeed(speed);
    };
    requestAnimationFrame(tick);
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
    factions: dress([0, 1, 2, 3].map((color) => ({ ai: true, color, think: 1.4, personality: personalities[types[Math.floor(r() * types.length)]] })), seed, false),
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
    const building = s.building ?? (s.relic ? 'relic' : s.home ? 'home' : null);
    return { color: s.owner < 0 ? null : colors[demo.factions[s.owner].color], fill: s.owner < 0 ? 0 : 0.16, building, huts: s.owner < 0 && !building, skin: s.owner < 0 ? null : demo.factions[s.owner].skin?.buildings };
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

// commander panel: colour swatches, troop and building style cards with live previews
function renderProfile() {
  const col = factionColors[profile.color];
  $('pf-colors').innerHTML = factionColors.map((c, i) => `<button class="pf-swatch ${i === profile.color ? 'on' : ''}" data-i="${i}" title="${colorNames[i]}" style="background:${c}"></button>`).join('');
  const cards = (box, list, cur, key) => {
    $(box).innerHTML = Object.entries(list).map(([id, name]) => `<button class="pf-card ${id === cur ? 'on' : ''}" data-id="${id}"><canvas width="192" height="112"></canvas>${name}</button>`).join('');
    for (const b of $(box).querySelectorAll('.pf-card')) b.onclick = () => { profile[key] = b.dataset.id; saveProfile(); renderProfile(); sfx.click(); };
  };
  cards('pf-troops', troopStyles, profile.troops, 'troops');
  cards('pf-buildings', buildingStyles, profile.buildings, 'buildings');
  // previews: a small squad per troop style, a house + tower per building style
  for (const b of $('pf-troops').querySelectorAll('.pf-card')) {
    const x = b.firstElementChild.getContext('2d'), u = unitSprite('soldier', col, 2.6, 2, b.dataset.id);
    x.scale(2, 2);   // canvas is 2x its css size
    for (const [px, py] of [[26, 24], [48, 21], [70, 24], [37, 36], [59, 36]]) x.drawImage(u.c, px - u.w / 2, py - u.h / 2, u.w, u.h);
  }
  for (const b of $('pf-buildings').querySelectorAll('.pf-card')) {
    const x = b.firstElementChild.getContext('2d');
    x.scale(2, 2);
    previewBuildings(x, 96, 56, b.dataset.id, hexToRgb(col));
  }
  for (const s of $('pf-colors').querySelectorAll('.pf-swatch')) s.onclick = () => { profile.color = +s.dataset.i; saveProfile(); renderProfile(); sfx.click(); };
}
$('btn-profile').onclick = () => { renderProfile(); $('profile').classList.remove('hidden'); };
$('pf-done').onclick = () => $('profile').classList.add('hidden');
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
          else goFlash = 1;
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
setAuto(true);   // auto-send routes on by default

// audio: start on the first gesture, toggles remembered
addEventListener('pointerdown', initAudio, { capture: true });
// phones held upright: rotate the page by css (always landscape, no 'turn your phone' prompt).
// --sw / --sh = the real screen size, so the rotated page fills it exactly
function syncRotation() {
  const upright = matchMedia('(orientation: portrait) and (pointer: coarse)').matches;
  const root = document.documentElement;
  root.style.setProperty('--sw', innerWidth + 'px');
  root.style.setProperty('--sh', innerHeight + 'px');
  root.classList.toggle('rotated', upright);
  root.classList.toggle('compact', (upright ? innerWidth : innerHeight) < 500);   // short landscape: compact hud
}
syncRotation();
addEventListener('resize', syncRotation);
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
window.__fl = { skipCountdown: () => { countdown = 0; goFlash = 0; }, campaign, startSkirmish, startBattle, startExpedition, get expedition() { return expedition; }, get battle() { return battle; }, get view() { return bv; }, cview: cv, audioState, audioFiles };
