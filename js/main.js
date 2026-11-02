// app shell: menu, campaign map, battle screen, input and the frame loop
import { rules, buildings, effects, factionColors, factionNames, neutralColor, themeNames } from './config.js?v=20';
import { generateMap, rng } from './mapgen.js?v=20';
import { Battle } from './battle.js?v=20';
import { personalities } from './ai.js?v=20';
import { Campaign } from './campaign.js?v=20';
import { Expedition, stages } from './expedition.js?v=20';
import { initAudio, sfx, setSfx, setMusic, setTrack, audioPrefs } from './audio.js?v=20';
import { MapView, hexToRgb, shade, label, pill, unitSprite } from './render.js?v=20';

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
let auto = false, selected = -1, pct = 0.5, drag = null, hover = -1, speed = 1, paused = false, key = '';

function startBattle(setup, m, rid = -1) {
  // battle maps: random island shape + lakes/mountains (setup.shape can force a shape)
  const map = generateMap({ seed: setup.seed, cells: setup.cells, grid: rules.grid, shape: setup.shape ?? 'random', obstacles: true, detail: setup.detail ?? 1, stamp: setup.stamp ?? null });
  if (autoplay) setup.factions[0] = { ai: true, color: 0, think: 1.5, personality: personalities.aggressive };
  battle = new Battle(map, setup);
  mode = m; regionId = rid; selected = -1; drag = null; paused = false; key = '';
  const theme = setup.theme ?? themeNames[setup.seed % themeNames.length];
  if (!bv) bv = new MapView($('battle-canvas'), map, theme); else bv.setMap(map, theme);
  bv.prewarm(battle.factions.map((f) => colors[f.color]), 0.16);
  $('stage').classList.toggle('hidden', m !== 'expedition');
  if (m === 'expedition') $('stage').textContent = `${expedition.stage + 1}/${stages.length} · ${expedition.current.name} · ${expedition.current.area}`;
  $('end').classList.add('hidden');
  renderBuildPanel();
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
  const k = `${battle.version}:${selected}`;
  if (k === key) return;
  key = k;
  if (selected >= 0 && !isMine(selected)) selected = -1;
  const adj = selected >= 0 ? battle.segs[selected].adj : [];
  bv.paint((id) => {
    const s = battle.segs[id], o = s.owner;
    if (o < 0) return { color: null, fill: 0, building: s.building };
    return { color: colors[battle.factions[o].color], fill: 0.16, building: s.building };
  });
  renderBuildPanel();
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
  // segment numbers
  if (numbers) for (const s of b.segs) {
    const x = v.sx(s.x), y = v.sy(s.y);
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
    const tt = a.fight ? a.t : Math.min(a.stopAt, a.t + ac / a.dur);
    const x = v.sx(f.x + (t.x - f.x) * tt), y = v.sy(f.y + (t.y - f.y) * tt);
    const ang = Math.atan2(v.sy(t.y) - v.sy(f.y), v.sx(t.x) - v.sx(f.x)), ca = Math.cos(ang), sa = Math.sin(ang);
    const col = factionColors[b.factions[a.owner].color], u = unitSprite(kind, col, z, dpr);
    const m = Math.max(1, Math.min(kind === 'battalion' ? 12 : 30, Math.ceil(a.n / per - 0.01)));
    const cols = Math.ceil(Math.sqrt(m)), seed = a.from * 31 + a.to;
    for (let i = 0; i < m; i++) {
      // rows behind the leader, ranks across the direction of travel
      const r = Math.floor(i / cols), c = i % cols, along = -r * sp * 0.9, across = (c - (cols - 1) / 2) * sp * 0.8;
      let px = x + ca * along - sa * across, py = y + sa * along + ca * across;
      if (a.fight) { px += Math.sin(now * 23 + i * 1.7 + seed) * z * 1.2; py += Math.cos(now * 19 + i) * z * 0.8; }
      else py += Math.sin(now * 14 + i) * z * 0.5;   // marching bob
      ctx.drawImage(u.c, px - u.w / 2, py - u.h, u.w, u.h);
    }
    if (a.fight) {
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
}

// battle input:
// - tap a neighbour of the selected segment = send troops there (attack, or move if it's yours)
// - tap your segment that isn't a neighbour = select it; tap the selected one again = deselect
// - drag from your segment to any neighbour = send troops
function localPos(e) {
  const r = bv.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
$('battle-canvas').addEventListener('pointerdown', (e) => {
  if (!battle || battle.state !== 'running') return;
  bv.canvas.setPointerCapture(e.pointerId);
  const sid = bv.segAt(e.clientX, e.clientY);
  hover = sid;
  // own segment: decide tap vs drag on pointerup
  if (isMine(sid)) drag = { from: sid, moved: false, ...localPos(e) };
  else if (canTarget(selected, sid)) sendFrom(selected, sid);
  else if (sid < 0) selected = -1;
});
$('battle-canvas').addEventListener('pointermove', (e) => {
  if (!battle) return;
  hover = bv.segAt(e.clientX, e.clientY);
  if (drag) {
    Object.assign(drag, localPos(e));
    if (hover !== drag.from && !drag.moved) { drag.moved = true; selected = drag.from; }
  }
});
$('battle-canvas').addEventListener('pointerup', (e) => {
  if (drag) {
    const to = bv.segAt(e.clientX, e.clientY), from = drag.from;
    if (drag.moved) { if (canTarget(from, to)) sendFrom(from, to); }
    else if (from === selected) selected = -1;                   // tap selected again: deselect
    else if (canTarget(selected, from)) sendFrom(selected, from); // tap own neighbour: move troops
    else selected = from;                                         // tap other own segment: select
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

// bottom panel: send %, selected segment info, build buttons
function renderBuildPanel() {
  const box = $('build');
  if (selected < 0 || !battle) {
    box.innerHTML = '<p class="hint">Tap your segment to select it, then tap a neighbour to send troops: attack enemies, move to your own. Or drag.</p>';
    return;
  }
  const sel = battle.segs[selected];
  if (sel.capital) {
    // capital: no building; show the carried-over bonuses
    const b = sel.bonus, pc = (v) => `+${Math.round(v * 100)}%`;
    box.innerHTML = `<p class="hint">🏰 <b>Capital</b>: nothing can be built here. Carried-over bonuses:
      ${pc(b.growth)} growth here · ${pc(b.hosp)} growth in your neighbouring segments · ${pc(b.lab)} growth everywhere ·
      defense ${pc(b.def)} · attack ${pc(b.atk)} from here</p>`;
    return;
  }
  box.innerHTML = Object.entries(buildings).map(([type, b]) =>
    `<button class="bld" data-type="${type}"><span class="ico">${b.icon}</span><span><b>${b.name}</b> · ${battle.costOf(0, type)}<br><small>${b.desc}</small></span></button>`).join('');
  for (const btn of box.querySelectorAll('.bld')) btn.onclick = () => {
    if (battle.build(0, selected, btn.dataset.type)) sfx.build(); else flash('Need more troops in this segment');
  };
}

function updatePanel() {
  // segment info line: selected segment, or the hovered one
  const sid = selected >= 0 ? selected : hover;
  if (sid >= 0) {
    const s = battle.segs[sid], who = s.owner < 0 ? 'Neutral' : factionNames[battle.factions[s.owner].color];
    const mult = [s.building === 'fort' && `🛡️ defense x${effects.fortDefense}`, s.building === 'barracks' && `⚔️ attack x${effects.barracksAttack}`].filter(Boolean).join(' · ');
    const col = s.owner < 0 ? neutralColor : factionColors[battle.factions[s.owner].color];
    $('seg-info').innerHTML = `<b style="color:${col}">${who}</b>
      · ${Math.floor(s.troops)} / ${s.owner < 0 ? s.garrison + ' (regrows to it at +' + s.baseGrowth + '/s)' : s.cap + ' troops · +' + s.growth + '/s'}${s.capital ? ' · 🏰 Capital' : s.building ? ' · ' + buildings[s.building].icon + ' ' + buildings[s.building].name : ''}${mult ? ' · ' + mult : ''}`;
  } else $('seg-info').textContent = '';
  // selected tile's route (if any) with a stop button
  const route = selected >= 0 ? battle.routes.get(selected) : null;
  $('route-info').classList.toggle('hidden', !route);
  if (route) $('route-info').firstElementChild.textContent = `🔁 Route active, keeps ${Math.round(route.keep * 100)}% of cap`;
  for (const btn of $('build').querySelectorAll('.bld')) {
    const s = battle.segs[selected];
    btn.disabled = !s || s.troops < battle.costOf(0, btn.dataset.type) || s.building === btn.dataset.type;
    btn.classList.toggle('current', !!s && s.building === btn.dataset.type);
  }
  // faction chips: segments and total troops (on map + marching)
  $('factions').innerHTML = battle.factions.map((f) => {
    const segs = battle.segs.filter((s) => s.owner === f.id);
    // total strength: troops on the map + marching + reserve (expedition capitals)
    const troops = segs.reduce((v, s) => v + s.troops, 0) + battle.armies.filter((a) => a.owner === f.id).reduce((v, a) => v + a.n, 0) + f.reserve;
    const dead = !battle.alive(f.id);
    return `<span class="chip ${dead ? 'dead' : ''}"><i style="background:${factionColors[f.color]}"></i>${segs.length}▣ ${Math.floor(troops)}</span>`;
  }).join('');
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
  flash(`🧭 Stage 1: ${expedition.current.name} (${expedition.current.area})`);
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
    </ul>Next: <b>${expedition.current.name}</b> (${expedition.current.area}). Pick a perk:`;
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
    $('zoom-banner').innerHTML = `Zooming out…<br><b>${expedition.current.name}</b> · ${expedition.current.area}`;
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
    return { color: s.owner < 0 ? null : colors[demo.factions[s.owner].color], fill: s.owner < 0 ? 0 : 0.16, building: s.building };
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
  const marching = battle.armies.filter((a) => !a.fight), fights = battle.armies.filter((a) => a.fight).length;
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
    if (!paused && battle.state === 'running') {
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
window.__fl = { campaign, startSkirmish, startBattle, startExpedition, get expedition() { return expedition; }, get battle() { return battle; }, get view() { return bv; }, cview: cv };
