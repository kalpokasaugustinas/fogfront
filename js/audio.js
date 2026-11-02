// sound effects + generative background music, all synthesized with web audio (no sound files).
// sfx: marching steps, war cries, sword clashes, capture horns, clicks.
// music: slow medieval-folk loop in d dorian: drone pad, plucked lute arpeggios, frame drum.
// audio starts on the first tap/key (browser rule); on/off choices are remembered.

const pref_key = 'frontlines.audio';
let ctx = null, master, sfxBus, musicBus, noiseBuf, musicTimer = 0;
const prefs = loadPrefs();

function loadPrefs() {
  try { return { sfx: true, music: true, ...JSON.parse(localStorage.getItem(pref_key)) }; } catch { return { sfx: true, music: true }; }
}
function savePrefs() { try { localStorage.setItem(pref_key, JSON.stringify(prefs)); } catch { /* storage blocked */ } }

export const audioPrefs = prefs;

// create the audio graph on the first user gesture
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  // gentle compressor so many overlapping effects never clip
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = prefs.sfx ? 0.8 : 0;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = prefs.music ? 0.32 : 0;
  musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startMusic();
  // stop playing in a background tab
  document.addEventListener('visibilitychange', () => (document.hidden ? ctx.suspend() : ctx.resume()));
}

export function setSfx(on) { prefs.sfx = on; savePrefs(); if (ctx) sfxBus.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05); }
export function setMusic(on) { prefs.music = on; savePrefs(); if (ctx) musicBus.gain.setTargetAtTime(on ? 0.32 : 0, ctx.currentTime, 0.3); }

// ---------- building blocks ----------

// filtered noise burst
function noise({ when = 0, dur = 0.1, type = 'bandpass', freq = 1000, q = 1, vol = 0.3, attack = 0.005, bus = sfxBus, sweep = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + when, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

// simple oscillator note with an envelope (optional lowpass and pitch glide)
function note({ when = 0, freq = 440, dur = 0.3, type = 'sine', vol = 0.2, attack = 0.01, glide = 0, cutoff = 0, bus = sfxBus }) {
  if (!ctx) return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = o;
  if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; out = o.connect(f); }
  out.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ---------- effects ----------

export const sfx = {
  // one marching step: low thud + gravel shuffle; size 0..1
  march(size) {
    const v = 0.08 + 0.22 * size;
    noise({ type: 'lowpass', freq: 160, q: 0.7, vol: v, dur: 0.12 });
    noise({ type: 'bandpass', freq: 1400, q: 0.8, vol: v * 0.25, dur: 0.07, when: 0.01 });
  },
  // war cry: a few detuned "aaah" voices (saw through vowel formants), rising then falling
  shout(size) {
    if (!ctx) return;
    const voices = 2 + Math.round(size * 3), t = ctx.currentTime;
    for (let i = 0; i < voices; i++) {
      const base = 150 + Math.random() * 90, dur = 0.55 + Math.random() * 0.3, start = t + Math.random() * 0.12;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base, start);
      o.frequency.linearRampToValueAtTime(base * 1.35, start + dur * 0.35);
      o.frequency.linearRampToValueAtTime(base * 0.9, start + dur);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime((0.05 + 0.06 * size) / Math.sqrt(voices), start + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      // vowel "ah": two formant bandpasses mixed
      for (const [fq, q] of [[750, 6], [1150, 8]]) {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = fq * (0.95 + Math.random() * 0.1); f.Q.value = q;
        o.connect(f).connect(g);
      }
      g.connect(sfxBus);
      o.start(start);
      o.stop(start + dur + 0.05);
    }
    noise({ type: 'bandpass', freq: 900, q: 1.2, vol: 0.05 + 0.05 * size, dur: 0.5, attack: 0.08 });   // crowd breath
  },
  // sword clash: bright metallic ping + short noise scrape
  clash() {
    const f = 2200 + Math.random() * 2600;
    note({ freq: f, type: 'triangle', vol: 0.07, dur: 0.12 + Math.random() * 0.1, attack: 0.002 });
    note({ freq: f * 1.51, type: 'sine', vol: 0.035, dur: 0.08, attack: 0.002 });
    noise({ type: 'highpass', freq: 3500, q: 0.7, vol: 0.06, dur: 0.05 });
  },
  // horn when a tile changes hands: rising for you, falling when you lose one
  capture(mine) {
    const [a, b] = mine ? [196, 294] : [220, 147];
    note({ freq: a, type: 'sawtooth', vol: 0.08, dur: 0.28, attack: 0.03, cutoff: 1300 });
    note({ freq: b, type: 'sawtooth', vol: 0.09, dur: mine ? 0.55 : 0.45, attack: 0.03, when: 0.2, cutoff: 1300 });
    if (mine) noise({ type: 'lowpass', freq: 200, vol: 0.12, dur: 0.18, when: 0.2 });
  },
  // any tile changing hands between other factions: soft drum hit + distant low horn
  captureFar() {
    noise({ type: 'lowpass', freq: 130, vol: 0.09, dur: 0.22 });
    note({ freq: 147, type: 'sawtooth', vol: 0.03, dur: 0.35, attack: 0.04, cutoff: 700, when: 0.05 });
  },
  build() {
    for (let i = 0; i < 3; i++) noise({ type: 'bandpass', freq: 600 + i * 150, q: 3, vol: 0.12, dur: 0.07, when: i * 0.11 });
  },
  // countdown war drum: deep boom + skin slap, a little higher on each count (i = 0, 1, 2)
  drum(i) {
    note({ freq: 70 + i * 12, type: 'sine', vol: 0.28, dur: 0.45, attack: 0.004, glide: 0.6 });
    noise({ type: 'lowpass', freq: 240, q: 0.8, vol: 0.22, dur: 0.16 });
    noise({ type: 'bandpass', freq: 900, q: 1.5, vol: 0.05, dur: 0.05 });
  },
  // battle start: two-note horn call with a drum hit
  horn() {
    note({ freq: 147, type: 'sawtooth', vol: 0.09, dur: 0.3, attack: 0.04, cutoff: 1200 });
    note({ freq: 220, type: 'sawtooth', vol: 0.1, dur: 0.7, attack: 0.05, when: 0.25, cutoff: 1400 });
    note({ freq: 294, type: 'sawtooth', vol: 0.05, dur: 0.6, attack: 0.05, when: 0.3, cutoff: 1600 });
    noise({ type: 'lowpass', freq: 160, vol: 0.2, dur: 0.3, when: 0.25 });
  },
  click() { note({ freq: 880, type: 'sine', vol: 0.05, dur: 0.05, attack: 0.002 }); },
};

// ---------- music ----------
// two generative tracks, scheduled ~1 s ahead on a timer, one bar at a time:
//   battle: d dorian folk loop, 72 bpm: drone pad, plucked lute arpeggio, frame drum
//   menu:   heroic d major theme, 84 bpm (d-a-bm-g): brass-like chord swells, horn melody,
//           timpani on the downbeat with a roll and cymbal swell every 4th bar
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const tracks = {
  battle: { bpm: 72, chords: [[50, 57, 62, 65], [48, 55, 60, 64], [53, 60, 65, 69], [45, 52, 57, 60]], bar: battleBar },
  menu: { bpm: 84, chords: [[50, 57, 62, 66], [45, 52, 57, 61], [47, 54, 59, 62], [43, 50, 55, 59]], bar: menuBar },
};
let track = tracks.menu, nextBar = 0, bar = 0;

function startMusic() {
  nextBar = ctx.currentTime + 0.3;
  clearInterval(musicTimer);
  musicTimer = setInterval(scheduleMusic, 250);
}

// switch tracks: quick dip of the music bus, then the new track starts on a fresh phrase
export function setTrack(name) {
  const next = tracks[name] ?? tracks.menu;
  if (next === track) return;
  track = next;
  bar = 0;
  if (!ctx) return;
  const g = musicBus.gain, on = prefs.music ? 0.32 : 0, t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setTargetAtTime(0, t, 0.15);
  g.setTargetAtTime(on, t + 0.9, 0.4);
  nextBar = t + 0.9;
}

function scheduleMusic() {
  if (!ctx || ctx.state !== 'running') return;
  while (nextBar < ctx.currentTime + 1.2) {
    const beat = 60 / track.bpm, ch = track.chords[Math.floor(bar / 2) % track.chords.length];
    track.bar(nextBar - ctx.currentTime, ch, beat, bar);
    nextBar += beat * 4;
    bar++;
  }
}

function battleBar(when, ch, beat, bar) {
  const barLen = beat * 4;
  // drone pad: soft triangles, slow attack
  for (const m of [ch[0] - 12, ch[1] - 12]) note({ bus: musicBus, when, freq: mtof(m), type: 'triangle', vol: 0.09, attack: 0.8, dur: barLen + 0.6, cutoff: 900 });
  // plucked arpeggio: 8 eighth notes, chord tones with the odd octave jump
  for (let i = 0; i < 8; i++) {
    if (Math.random() < 0.18) continue;
    const m = ch[(i * 2 + bar) % 4] + (Math.random() < 0.25 ? 12 : 0);
    note({ bus: musicBus, when: when + i * beat / 2, freq: mtof(m), type: 'sawtooth', vol: 0.05, attack: 0.004, dur: 0.6, cutoff: 1600 });
    note({ bus: musicBus, when: when + i * beat / 2, freq: mtof(m) * 2.003, type: 'sine', vol: 0.015, attack: 0.004, dur: 0.35 });
  }
  // frame drum: beats 1 and 3, softer ghost note before 3
  for (const [b, v] of [[0, 0.22], [1.5, 0.07], [2, 0.16]]) noise({ bus: musicBus, when: when + b * beat, type: 'lowpass', freq: 140, q: 1, vol: v, dur: 0.25 });
}

// horn melody: one 2-bar phrase per chord pair, built from chord tones (rhythm in beats)
const phrases = [[[0, 1], [1, 0.5], [2, 0.5], [3, 2]], [[3, 1.5], [2, 0.5], [1, 1], [0, 1]], [[2, 0.5], [3, 0.5], [2, 1], [1, 2]], [[0, 2], [1, 1], [3, 1]]];

function menuBar(when, ch, beat, bar) {
  const barLen = beat * 4;
  // brass-like chord swell: detuned saws through a lowpass, slow attack
  for (const m of [ch[1], ch[2], ch[3]]) {
    for (const det of [1, 1.004]) note({ bus: musicBus, when, freq: mtof(m) * det, type: 'sawtooth', vol: 0.022, attack: 0.5, dur: barLen + 0.4, cutoff: 1100 });
  }
  note({ bus: musicBus, when, freq: mtof(ch[0] - 12), type: 'triangle', vol: 0.1, attack: 0.05, dur: barLen, cutoff: 600 });   // bass
  // horn melody on even bars (a phrase spans the next 2 bars' worth of beats when it's long)
  if (bar % 2 === 0) {
    let at = 0;
    for (const [deg, len] of phrases[(bar / 2) % phrases.length]) {
      const f = mtof(ch[deg] + 12);
      note({ bus: musicBus, when: when + at * beat, freq: f, type: 'sawtooth', vol: 0.045, attack: 0.06, dur: len * beat * 0.95, cutoff: 1800 });
      note({ bus: musicBus, when: when + at * beat, freq: f * 0.5, type: 'triangle', vol: 0.03, attack: 0.06, dur: len * beat * 0.95 });
      at += len;
    }
  }
  // timpani on the downbeat (pitched to the root), roll + cymbal swell into every 4th bar
  const timp = (w, v) => note({ bus: musicBus, when: w, freq: mtof(ch[0] - 12), type: 'sine', vol: v, attack: 0.005, dur: 0.6, glide: 0.92 });
  timp(when, 0.22);
  timp(when + beat * 2, 0.12);
  if (bar % 4 === 3) {
    for (let i = 0; i < 8; i++) timp(when + beat * 3 + i * beat / 8, 0.05 + i * 0.012);
    noise({ bus: musicBus, when: when + beat * 2, type: 'highpass', freq: 5000, q: 0.5, vol: 0.05, dur: beat * 2.2, attack: beat * 2 });
  }
}
