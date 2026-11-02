// app shell: menu, campaign map, battle screen, input and the frame loop
import { rules, buildings, effects, factionColors, factionNames, neutralColor, themeNames } from './config.js?v=9';
import { generateMap, rng } from './mapgen.js?v=9';
import { Battle } from './battle.js?v=9';
import { personalities } from './ai.js?v=9';
import { Campaign } from './campaign.js?v=9';
import { MapView, hexToRgb, shade, label, pill } from './render.js?v=9';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const autoplay = params.has('autoplay');   // test mode: the player side is played by a bot too

const colors = factionColors.map(hexToRgb);
const neutral = hexToRgb(neutralColor);

// ---------- screens ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  screen = id;
  requestAnimationFrame(() => { if (id === 'battle' && bv) { bv.resize(); key = ''; } if (id === 'campaign') cv.resize(), paintCampaign(); });
}
let screen = 'menu';

// ---------- campaign screen ----------
const campaign = new Campaign();
const cv = new MapView($('campaign-canvas'), campaign.map);
let pickedRegion = -1;

function paintCampaign() {
  cv.paint((id) => {
    const pick = id === pickedRegion ? 0.2 : 0;
    if (campaign.owned.has(id)) return { color: colors[0], fill: 0.3 + pick };
    const c = colors[campaign.regions[id].empire];
    return { color: campaign.attackable(id) ? c : shade(c, -0.25), fill: (campaign.attackable(id) ? 0.22 : 0.08) + pick };
  });
  renderRegionInfo();
}

function drawCampaign() {
  const ctx = cv.drawBase();
  const fs = Math.max(10, Math.min(15, cv.size / 36));
  for (const r of campaign.regions) {
    const s = campaign.map.segs[r.id], x = cv.px(s.x), y = cv.px(s.y);
    const owned = campaign.owned.has(r.id), open = campaign.attackable(r.id);
    label(ctx, owned ? '🏳️' : open ? '⚔️' : r.capital ? '👑' : '🔒', x, y - fs * 0.9, fs * 1.1);
    label(ctx, r.name, x, y + fs * 0.4, fs * 0.85, owned || open ? '#fff' : '#dde3e3', 700);
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
    <p>${r.segments} segments · ${r.bots} enem${r.bots > 1 ? 'ies' : 'y'} · neutral troops ${r.neutral[0]}–${r.neutral[1]}</p>
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
  const map = generateMap({ seed: setup.seed, cells: setup.cells, grid: rules.grid, shape: setup.shape ?? 'random', obstacles: true });
  if (autoplay) setup.factions[0] = { ai: true, color: 0, think: 1.5, personality: personalities.aggressive };
  battle = new Battle(map, setup);
  mode = m; regionId = rid; selected = -1; drag = null; paused = false; key = '';
  const theme = setup.theme ?? themeNames[setup.seed % themeNames.length];
  if (!bv) bv = new MapView($('battle-canvas'), map, theme); else bv.setMap(map, theme);
  $('end').classList.add('hidden');
  renderBuildPanel();
  show('battle');
}

function startSkirmish() {
  const seed = Math.floor(Math.random() * 1e9), r = rng(seed), types = Object.keys(personalities);
  startBattle({
    seed, cells: 22, neutral: [40, 140],
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
    const o = battle.segs[id].owner, hl = id === selected ? 0.3 : adj.includes(id) ? 0.14 : 0;
    if (o < 0) return { color: null, fill: hl };
    return { color: colors[battle.factions[o].color], fill: 0.16 + hl };
  });
  renderBuildPanel();
}

function drawBattle() {
  paintBattle();
  const ctx = bv.drawBase();
  const fs = Math.max(11, Math.min(18, bv.size / 30));
  // segment numbers and building icons
  for (const s of battle.segs) {
    const x = bv.px(s.x), y = bv.px(s.y);
    if (s.building) label(ctx, buildings[s.building].icon, x, y - fs * 1.15, fs * 1.05);
    const own = s.owner >= 0 ? factionColors[battle.factions[s.owner].color] : null;
    pill(ctx, Math.floor(s.troops), x, y + (s.building ? fs * 0.2 : 0), fs * 0.85, own ?? 'rgba(90,100,95,.55)', own ?? '#4b5552');
  }
  // armies on the move
  for (const a of battle.armies) {
    const f = battle.segs[a.from], t = battle.segs[a.to];
    const x = bv.px(f.x + (t.x - f.x) * a.t), y = bv.px(f.y + (t.y - f.y) * a.t);
    const rad = 5 + Math.sqrt(a.n) * 1.3;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = factionColors[battle.factions[a.owner].color];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = a.atk > 1 ? '#ffd76a' : '#fff';   // gold ring = barracks bonus
    ctx.stroke();
    label(ctx, a.n, x, y, fs * 0.7);
  }
  // player routes: dashed arrows with a moving dash
  ctx.save();
  for (const [a, r] of battle.routes) {
    const s = battle.segs[a], t = battle.segs[r.to];
    if (s.owner !== 0) continue;
    const x1 = bv.px(s.x), y1 = bv.px(s.y), x2 = bv.px(t.x), y2 = bv.px(t.y);
    const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
    const sx = x1 + Math.cos(ang) * fs * 1.2, sy = y1 + Math.sin(ang) * fs * 1.2;
    const ex = x1 + Math.cos(ang) * (len - fs * 1.3), ey = y1 + Math.sin(ang) * (len - fs * 1.3);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.setLineDash([6, 5]); ctx.lineDashOffset = -battle.time * 20;
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
    const f = battle.segs[drag.from], fx = bv.px(f.x), fy = bv.px(f.y);
    const ok = canTarget(drag.from, hover);
    const tx = ok ? bv.px(battle.segs[hover].x) : drag.x, ty = ok ? bv.px(battle.segs[hover].y) : drag.y;
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
  box.innerHTML = Object.entries(buildings).map(([type, b]) =>
    `<button class="bld" data-type="${type}"><span class="ico">${b.icon}</span><span><b>${b.name}</b> · ${b.cost}<br><small>${b.desc}</small></span></button>`).join('');
  for (const btn of box.querySelectorAll('.bld')) btn.onclick = () => {
    if (!battle.build(0, selected, btn.dataset.type)) flash('Need more troops in this segment');
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
      · ${Math.floor(s.troops)} / ${s.cap} troops · +${s.growth}/s${s.building ? ' · ' + buildings[s.building].icon + ' ' + buildings[s.building].name : ''}${mult ? ' · ' + mult : ''}`;
  } else $('seg-info').textContent = '';
  // selected tile's route (if any) with a stop button
  const route = selected >= 0 ? battle.routes.get(selected) : null;
  $('route-info').classList.toggle('hidden', !route);
  if (route) $('route-info').firstElementChild.textContent = `🔁 Route active, keeps ${Math.round(route.keep * 100)}% of cap`;
  for (const btn of $('build').querySelectorAll('.bld')) {
    const s = battle.segs[selected];
    btn.disabled = !s || s.troops < buildings[btn.dataset.type].cost || s.building === btn.dataset.type;
    btn.classList.toggle('current', !!s && s.building === btn.dataset.type);
  }
  // faction chips: segments and total troops (on map + marching)
  $('factions').innerHTML = battle.factions.map((f) => {
    const segs = battle.segs.filter((s) => s.owner === f.id);
    const troops = segs.reduce((v, s) => v + s.troops, 0) + battle.armies.filter((a) => a.owner === f.id).reduce((v, a) => v + a.n, 0);
    const dead = !battle.alive(f.id);
    return `<span class="chip ${dead ? 'dead' : ''}"><i style="background:${factionColors[f.color]}"></i>${segs.length}▣ ${Math.floor(troops)}</span>`;
  }).join('');
  $('clock').textContent = fmtTime(battle.time);
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

function endBattle() {
  const won = battle.state === 'won';
  if (won && mode === 'campaign') { campaign.conquer(regionId); pickedRegion = -1; }
  const st = battle.stats;
  $('end-title').textContent = won ? (mode === 'campaign' ? '🏳️ Region conquered!' : '🏆 Victory!') : '💀 Defeated';
  $('end-stats').textContent = `Time ${fmtTime(battle.time)} · ${st.captured} captures · ${st.built} buildings · ${st.sent} orders`;
  $('end-retry').classList.toggle('hidden', won);
  $('end').classList.remove('hidden');
}
$('end-continue').onclick = () => { if (mode === 'campaign') show('campaign'); else show('menu'); };
$('end-retry').onclick = () => {
  if (mode === 'campaign') startBattle(campaign.battleSetup(regionId), 'campaign', regionId); else startSkirmish();
};

let flashTimer = 0;
function flash(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => $('toast').classList.remove('show'), 1200);
}

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------- menu, help, keyboard ----------
$('btn-campaign').onclick = () => show('campaign');
$('btn-skirmish').onclick = startSkirmish;
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
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (screen === 'battle' && battle) {
    if (!paused && battle.state === 'running') {
      acc += dt * speed;
      while (acc >= rules.step) { battle.step(rules.step); acc -= rules.step; }
    }
    // show the result card once, however the battle ended
    if (battle.state !== 'running' && !battle.endShown) { battle.endShown = true; endBattle(); }
    drawBattle();
    uiTimer -= dt;
    if (uiTimer <= 0) { updatePanel(); uiTimer = 0.15; }
  } else if (screen === 'campaign') drawCampaign();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setPct(0.5);
setSpeed(1);

// hooks for headless tests
window.__fl = { campaign, startSkirmish, startBattle, get battle() { return battle; } };
