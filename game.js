'use strict';
// SQUAREHEAD — an Undertale-style survival fight against Cuphead-style bosses.
// You are a square and all you can do is dash. Survive until the boss runs out of time.
// Each boss turns you into different kinds of squares for its attacks.

const W = 960, H = 720, TAU = Math.PI * 2;
// the whole screen is the arena (minus the HUD strips at the top and bottom)
const A = { l: 14, t: 58, r: 946, b: 680 };
A.w = A.r - A.l; A.h = A.b - A.t;
const BX = (A.l + A.r) / 2, BY = (A.t + A.b) / 2 - 10; // the boss's home: the middle
const BOSS_SCALE = 0.8;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = W * s + 'px';
  cv.style.height = H * s + 'px';
}
addEventListener('resize', fit);
fit();

// ---------------------------------------------------------------- utils (visual randomness only)
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const fmtTime = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ---------------------------------------------------------------- seeded random
// Attack layouts come from this generator and it is re-seeded for every step of a
// boss's pattern, so each attack plays out exactly the same way every time.
let seedS = 1;
function R() {
  let x = seedS;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  seedS = x;
  return x / 4294967296;
}
function seed(n) { seedS = (Math.imul(n + 1, 2654435761) >>> 0) || 1; for (let i = 0; i < 4; i++) R(); }
const sr = (a, b) => a + R() * (b - a);
const sri = (a, b) => Math.floor(sr(a, b + 1));
const sc = p => R() < p;

// ---------------------------------------------------------------- save
const SAVE_KEY = 'squarehead-save-v2';
let save = { unlocked: 1, best: {}, hp: 4, mode: 1, keys: null, musicVol: 7, sfxVol: 8, chapters: {} };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && s.unlocked) save = Object.assign(save, s);
} catch (e) { /* storage unavailable */ }
if (!(save.hp >= 1 && save.hp <= 15)) save.hp = 4;
if (!(save.mode >= 0 && save.mode <= 5)) save.mode = 1;

// MODE = how strong the bosses are: faster, denser, bigger attacks and a longer fight
const MODES = [
  { name: 'STORY',      col: '#8fe86a', spd: 0.85, dens: 0.8,  size: 1.0,  dur: 1.0,  move: 0.6 },
  { name: 'NORMAL',     col: '#ffe14d', spd: 1.0,  dens: 1.0,  size: 1.15, dur: 1.15, move: 1.0 },
  { name: 'HARD',       col: '#ffb030', spd: 1.12, dens: 1.25, size: 1.3,  dur: 1.3,  move: 1.25 },
  { name: 'EXPERT',     col: '#ff7a30', spd: 1.25, dens: 1.5,  size: 1.4,  dur: 1.5,  move: 1.5 },
  { name: 'INSANE',     col: '#ff3a3a', spd: 1.4,  dens: 1.8,  size: 1.5,  dur: 1.75, move: 1.75 },
  { name: 'IMPOSSIBLE', col: '#d02cff', spd: 1.55, dens: 2.1,  size: 1.6,  dur: 2.0,  move: 2.0 },
];
const fightDur = (idx, mode) => Math.round(BOSS_DUR[idx] * MODES[mode].dur);
const BOSS_DUR = [75, 85, 95, 105, 120];
// each chapter has its own unlocked bosses, medals and story flags; the live copy sits at
// the top of `save` and is filed away under save.chapters[CH] whenever we save
let CH = 0; // current chapter: 0 = The Square Sea, 1 = The Quoly Lands
const PROGRESS = { unlocked: 1, best: {}, beatAll: false, seenIntro: false, didTutorial: false };
function loadProgress(ch) {
  const o = save.chapters[ch] || (ch === 0 ? save : {});
  for (const k in PROGRESS) save[k] = o[k] !== undefined ? o[k] : JSON.parse(JSON.stringify(PROGRESS[k]));
  if (ch === 1) save.didTutorial = true; // the tutorial lives in chapter 1
}
function persist() {
  const o = {};
  for (const k in PROGRESS) o[k] = save[k];
  save.chapters[CH] = o;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}
if (!save.chapters || typeof save.chapters !== 'object') save.chapters = {};
if (!(save.musicVol >= 0 && save.musicVol <= 10)) save.musicVol = 7;
if (!(save.sfxVol >= 0 && save.sfxVol <= 10)) save.sfxVol = 8;
loadProgress(0);

// HITS = how many hits you can take (1..15)
function diffInfo(hp) {
  if (hp === 1) return { name: 'ONE HIT = DEATH', col: '#ff2a2a' };
  if (hp <= 3) return { name: 'GLASS', col: '#ff5a3a' };
  if (hp <= 5) return { name: 'TOUGH', col: '#ffb030' };
  if (hp <= 8) return { name: 'STURDY', col: '#ffe14d' };
  if (hp <= 11) return { name: 'TANK', col: '#8fe86a' };
  return { name: 'FORTRESS', col: '#6ad0ff' };
}

// medals replace grades: the fewer hits you take, the better the medal
const MEDALS = [
  { name: 'BRONZE', col: '#cd7f32', dark: '#7a4416' },
  { name: 'SILVER', col: '#d5dde5', dark: '#7d8792' },
  { name: 'GOLD', col: '#ffd23f', dark: '#a87b00' },
  { name: 'DIAMOND', col: '#8ff6ff', dark: '#2a9fb8' },
];
function medalFor(hits) { return hits === 0 ? 3 : hits <= 2 ? 2 : hits <= 5 ? 1 : 0; }
const MEDAL_RULES = 'DIAMOND: no hits   GOLD: 1-2   SILVER: 3-5   BRONZE: 6+';

// ---------------------------------------------------------------- input
// gameplay keys can be rebound in SETTINGS (two keys per action)
const ACTIONS = [
  ['up', 'MOVE UP'], ['down', 'MOVE DOWN'], ['left', 'MOVE LEFT'], ['right', 'MOVE RIGHT'],
  ['dash', 'DASH'], ['jump', 'JUMP (blue square)'], ['pause', 'PAUSE'],
];
const DEFAULT_KEYS = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  dash: ['ShiftLeft', 'KeyC'], jump: ['Space', 'KeyZ'], pause: ['Escape', 'KeyP'],
};
const BIND = {};
for (const [a] of ACTIONS) {
  const k = save.keys && save.keys[a];
  BIND[a] = Array.isArray(k) ? [k[0] || null, k[1] || null] : DEFAULT_KEYS[a].slice();
}
function setKey(action, slot, code) {
  for (const a in BIND) BIND[a] = BIND[a].map(c => (c === code ? null : c));
  BIND[action][slot] = code;
  save.keys = BIND; persist();
}
// wipe unlocked bosses and medals (keys, mode and hits settings are kept)
function resetProgress() {
  save.unlocked = 1; save.best = {}; save.beatAll = false;
  sel = 0;
  persist();
}
function resetKeys() {
  for (const [a] of ACTIONS) BIND[a] = DEFAULT_KEYS[a].slice();
  save.keys = BIND; persist();
}
function keyName(c) {
  if (!c) return '---';
  const m = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER',
    ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT', AltRight: 'R-ALT', Backspace: 'BACKSPACE', Tab: 'TAB', CapsLock: 'CAPS',
  };
  if (m[c]) return m[c];
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad')) return 'NUM ' + c.slice(6);
  return c.toUpperCase();
}
const keyList = a => BIND[a].filter(Boolean).map(keyName).join(' / ') || 'unbound';

// menus always use these fixed keys, so you can never lock yourself out
const MENU = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  ok: ['Enter', 'Space', 'KeyZ'], back: ['Escape', 'Backspace'], quit: ['KeyQ'], mute: ['KeyM'], unlock: ['KeyU'],
};

const keys = {}, pressed = {};
let rebind = null; // { a: action, slot } while SETTINGS waits for a key
addEventListener('keydown', e => {
  audio.init();
  if (rebind) {
    e.preventDefault();
    if (e.repeat) return;
    if (e.code !== 'Escape') { setKey(rebind.a, rebind.slot, e.code); sfx.confirm(); }
    rebind = null;
    return;
  }
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab' || e.code === 'Backspace') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if (state === 'fight') pauseGame();
});
const held = a => BIND[a].some(c => c && keys[c]);
const tap = a => BIND[a].some(c => c && pressed[c]);
const mtap = a => MENU[a].some(c => pressed[c]);

// ---------------------------------------------------------------- audio
const audio = {
  ac: null, master: null, noiseBuf: null, muted: false,
  init() {
    if (!this.ac) {
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ac.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ac.destination);
        // music and sound effects each get their own volume knob
        this.musicGain = this.ac.createGain(); this.musicGain.connect(this.master);
        this.sfxGain = this.ac.createGain(); this.sfxGain.connect(this.master);
        this.setVolumes();
        const len = this.ac.sampleRate;
        this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { this.ac = null; }
    }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  },
  now() { return this.ac ? this.ac.currentTime : 0; },
  bus: 'sfx', // music.play() switches this to 'music' while it schedules notes
  out() { return this.bus === 'music' ? this.musicGain : this.sfxGain; },
  setVolumes() {
    if (!this.ac) return;
    this.musicGain.gain.value = Math.pow(save.musicVol / 10, 1.5);
    this.sfxGain.gain.value = Math.pow(save.sfxVol / 10, 1.5);
  },
  tone(f, dur, type = 'square', vol = 0.05, slide = 1, t0) {
    if (!this.ac || this.muted) return;
    const t = t0 === undefined ? this.ac.currentTime : t0;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out());
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, vol = 0.1, hp = 0, t0) {
    if (!this.ac || this.muted) return;
    const t = t0 === undefined ? this.ac.currentTime : t0;
    const s = this.ac.createBufferSource(), g = this.ac.createGain();
    s.buffer = this.noiseBuf;
    let node = s;
    if (hp) {
      const f = this.ac.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = hp;
      s.connect(f); node = f;
    }
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g); g.connect(this.out());
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  },
  // filtered noise whose pitch slides from f0 to f1 (whooshes, buzzes, swishes)
  sweep(dur, vol, f0, f1, q = 4, t0) {
    if (!this.ac || this.muted) return;
    const t = t0 === undefined ? this.ac.currentTime : t0;
    const s = this.ac.createBufferSource(), f = this.ac.createBiquadFilter(), g = this.ac.createGain();
    s.buffer = this.noiseBuf;
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out());
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  },
  // play a list of [semitones above f0, length] notes in a row
  melody(f0, notes, type = 'square', vol = 0.06) {
    if (!this.ac) return;
    let t = this.ac.currentTime;
    for (const [n, d] of notes) {
      if (n !== null) this.tone(f0 * Math.pow(2, n / 12), d * 0.95, type, vol, 1, t);
      t += d;
    }
  },
};

// stop the same sound from stacking up when many bullets spawn at once
const sfxLast = {};
function throttle(name, gap) {
  const n = audio.now();
  if (n - (sfxLast[name] || -1) < gap) return false;
  sfxLast[name] = n;
  return true;
}

const sfx = {
  hurt() { audio.tone(320, 0.3, 'sawtooth', 0.12, 0.25); audio.noise(0.25, 0.15); },
  dash() { audio.noise(0.12, 0.06, 1500); },
  jump() { audio.tone(260, 0.1, 'square', 0.035, 2); },
  fire() { audio.tone(240, 0.08, 'sawtooth', 0.03, 0.5); },
  pop() { audio.tone(520, 0.06, 'square', 0.03, 0.4); },
  laser() { audio.tone(110, 0.35, 'sawtooth', 0.05, 0.5); },
  warn() { audio.tone(1040, 0.04, 'square', 0.025); },
  mod() { audio.tone(523, 0.08, 'square', 0.06); audio.tone(784, 0.14, 'square', 0.06, 1, audio.now() + 0.08); },
  boom() { audio.noise(0.7, 0.25); audio.tone(90, 0.7, 'sine', 0.3, 0.3); },
  select() { audio.tone(660, 0.05, 'square', 0.04); },
  confirm() { audio.tone(660, 0.06, 'square', 0.05); audio.tone(990, 0.1, 'square', 0.05, 1, audio.now() + 0.06); },
  text() { audio.tone(rand(380, 440), 0.03, 'square', 0.02); },
  shatter() { audio.tone(700, 0.15, 'square', 0.08, 0.5); audio.noise(0.3, 0.12, 2000); },
  ko() { audio.tone(392, 0.15, 'square', 0.08); audio.tone(523, 0.15, 'square', 0.08, 1, audio.now() + 0.15); audio.tone(784, 0.4, 'square', 0.08, 1, audio.now() + 0.3); },
  // attack sounds
  drop() { if (throttle('drop', 0.07)) audio.tone(rand(900, 1300), 0.05, 'triangle', 0.025, 0.5); },
  whoosh() { if (throttle('whoosh', 0.12)) audio.sweep(0.35, 0.18, 300, 2400, 3); },
  sawBuzz() { audio.sweep(0.5, 0.14, 2500, 700, 8); audio.tone(90, 0.4, 'sawtooth', 0.04, 1.3); },
  ring() { audio.tone(300, 0.18, 'triangle', 0.08, 2.5); audio.noise(0.12, 0.08, 3000); },
  spiralTick() { if (throttle('spiral', 0.1)) audio.tone(rand(600, 700), 0.04, 'sine', 0.04, 1.4); },
  missile() { audio.sweep(0.4, 0.1, 400, 1800, 2); },
  charge() { if (throttle('charge', 0.15)) audio.tone(200, 0.6, 'sawtooth', 0.04, 4); },
  bounce() { if (throttle('bounce', 0.05)) audio.tone(rand(380, 460), 0.06, 'square', 0.03, 1.6); },
  zap() { if (throttle('zap', 0.12)) { audio.noise(0.25, 0.12, 1500); audio.tone(70, 0.3, 'square', 0.06, 0.6); } },
  land() { audio.tone(110, 0.08, 'sine', 0.12, 0.5); },
  ready() { audio.tone(440, 0.12, 'square', 0.06); audio.tone(440, 0.12, 'square', 0.06, 1, audio.now() + 0.3); },
  fight() { audio.melody(523, [[0, 0.08], [4, 0.08], [7, 0.08], [12, 0.3]], 'square', 0.07); audio.noise(0.4, 0.15, 800); },
  exFull() { audio.melody(880, [[0, 0.07], [7, 0.07], [12, 0.18]], 'triangle', 0.08); },
  heartbeat() { audio.tone(60, 0.12, 'sine', 0.25, 0.7); audio.tone(55, 0.12, 'sine', 0.2, 0.7, audio.now() + 0.16); },
  gameOver() { audio.melody(392, [[0, 0.22], [-1, 0.22], [-2, 0.22], [-5, 0.6]], 'triangle', 0.09); },
  win() { audio.melody(523, [[0, 0.1], [4, 0.1], [7, 0.1], [12, 0.15], [7, 0.1], [12, 0.45]], 'square', 0.06); },
  unlock() { audio.melody(660, [[0, 0.06], [5, 0.06], [12, 0.2]], 'triangle', 0.08); },
  phase() { audio.sweep(0.8, 0.2, 200, 3000, 2); audio.tone(110, 0.8, 'sawtooth', 0.08, 0.4); },
  // each kind of square gets its own transformation sound, after the classic "ding"
  soul(k) {
    audio.tone(1046, 0.12, 'square', 0.06);
    const t = audio.now() + 0.1;
    if (k === 'slow') audio.tone(600, 0.6, 'sawtooth', 0.06, 0.25, t);
    else if (k === 'fast') audio.tone(200, 0.4, 'sawtooth', 0.06, 4, t);
    else if (SOULS[k].m.grav) { audio.tone(80, 0.4, 'sine', 0.3, 0.5, t); audio.noise(0.2, 0.1, 0, t); }
    else if (k === 'purple') audio.tone(784, 0.3, 'square', 0.05, 0.5, t);
    else if (k === 'cyan') audio.tone(1568, 0.3, 'triangle', 0.06, 1.5, t);
    else if (k === 'yellow') audio.tone(300, 0.25, 'square', 0.05, 3, t);
    else if (k === 'orange') audio.tone(220, 0.35, 'square', 0.06, 0.4, t);
    else if (k === 'shadow') audio.tone(300, 0.6, 'square', 0.05, 0.3, t);
    else if (k === 'giant') audio.tone(150, 0.3, 'square', 0.07, 0.6, t);
    else audio.tone(784, 0.15, 'square', 0.05, 1, t);
  },
  castStart() { audio.sweep(0.6, 0.12, 400, 3000, 6); audio.tone(300, 0.6, 'triangle', 0.05, 2); },
};

// tiny step sequencer: bass + kick + hat, tempo follows the time modifiers
const music = {
  on: false, step: 0, next: 0, def: null, timer: null,
  start(def) {
    if (!audio.ac) return;
    this.def = def; this.on = true; this.step = 0;
    this.next = audio.ac.currentTime + 0.08;
    if (!this.timer) this.timer = setInterval(() => this.tick(), 25);
  },
  stop() { this.on = false; },
  tick() {
    if (!this.on || !audio.ac) return;
    const ac = audio.ac;
    if (this.next < ac.currentTime - 0.2) this.next = ac.currentTime + 0.02;
    while (this.next < ac.currentTime + 0.12) {
      if (!audio.muted) { audio.bus = 'music'; this.play(this.step, this.next); audio.bus = 'sfx'; }
      const inFight = F && this.def !== MENU_MUSIC && this.def !== MENU_MUSIC2;
      const rate = inFight ? F.timeScale * (1 + 0.07 * F.phase) : 1;
      this.next += 60 / (this.def.bpm * rate) / 4;
      this.step = (this.step + 1) % 32;
    }
  },
  play(s, t) {
    const d = this.def, i = s % 16, dr = d.drums;
    const n = d.bass[s % d.bass.length];
    if (n !== null) audio.tone(d.root * Math.pow(2, n / 12), d.bassLen || 0.11, d.bassWave || 'square', d.bassVol || 0.03, 1, t);
    const l = d.lead ? d.lead[s % d.lead.length] : null;
    if (l !== null) {
      const f = d.root * 4 * Math.pow(2, l / 12);
      audio.tone(f, d.leadLen || 0.12, d.leadWave || 'triangle', d.leadVol || 0.03, 1, t);
      if (d.detune) audio.tone(f * 1.012, d.leadLen || 0.12, d.leadWave || 'triangle', d.leadVol || 0.03, 1, t);
    }
    if (dr.k[i] === 'k') audio.tone(150, 0.12, 'sine', 0.22, 0.25, t);
    if (dr.s[i] === 's') { audio.noise(0.12, 0.08, 1200, t); audio.tone(190, 0.06, 'triangle', 0.05, 0.6, t); }
    if (dr.h[i] === 'h') audio.noise(0.035, 0.035, 7000, t);
    if (dr.t && dr.t[i] === 't') audio.tone(i % 8 ? 1500 : 1100, 0.03, 'sine', 0.08, 1, t);
  },
};

// ---------------------------------------------------------------- drawing helpers
function oval(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); }
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function fs(c, fill, lw = 5, stroke = '#111') {
  c.fillStyle = fill; c.fill();
  if (lw) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
}
function eyes(c, s, x, y, rx, ry, gap, angry, pupil = '#111') {
  for (const side of [-1, 1]) {
    const ex = x + side * gap;
    oval(c, ex, y, rx, ry); fs(c, '#fff', 4);
    const px = ex + s.lx * rx * 0.4, py = y + s.ly * ry * 0.4;
    oval(c, px, py, rx * 0.45, ry * 0.5); c.fillStyle = pupil; c.fill();
    oval(c, px - rx * 0.15, py - ry * 0.2, rx * 0.13, ry * 0.12); c.fillStyle = '#fff'; c.fill();
    if (angry) {
      c.beginPath();
      c.moveTo(ex + side * rx * 1.1, y - ry * 1.35);
      c.lineTo(ex - side * rx * 0.9, y - ry * 0.75);
      c.lineWidth = 7; c.strokeStyle = '#111'; c.stroke();
    }
  }
}
function sawShape(c, x, y, r, a, teeth = 12) {
  c.save(); c.translate(x, y); c.rotate(a);
  c.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const rr = i % 2 ? r * 0.76 : r;
    const aa = (i / (teeth * 2)) * TAU;
    c.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
  }
  c.closePath(); fs(c, '#b9c2cb', 3);
  oval(c, 0, 0, r * 0.55, r * 0.55); c.fillStyle = '#d7dee5'; c.fill();
  oval(c, 0, 0, r * 0.25, r * 0.25); fs(c, '#c33', 3);
  c.restore();
}

// ---------------------------------------------------------------- boss art
function drawCubert(c, s) {
  const t = s.t, ph = s.phase;
  const col = ['#f5c542', '#f59a42', '#e5533d'][ph];
  c.translate(0, Math.sin(t * 4) * 4);
  for (const side of [-1, 1]) {
    const hx = side * 128, hy = -5 + Math.sin(t * 6 + side * 1.3) * 28 - (s.mouth > 0 ? 30 : 0);
    c.beginPath(); c.moveTo(side * 70, 15);
    c.bezierCurveTo(side * 108, 45, side * 100, hy + 30, hx, hy);
    c.lineWidth = 14; c.strokeStyle = '#111'; c.stroke();
    c.lineWidth = 7; c.strokeStyle = col; c.stroke();
    oval(c, hx, hy, 17, 15); fs(c, '#fff', 4);
  }
  rrect(c, -82, -72, 164, 150, 26); fs(c, col, 6);
  rrect(c, -66, -60, 44, 13, 6); c.fillStyle = 'rgba(255,255,255,.45)'; c.fill();
  c.save(); c.rotate(Math.sin(t * 3) * 0.06);
  c.beginPath();
  c.moveTo(-60, -70); c.lineTo(-62, -112); c.lineTo(-30, -86); c.lineTo(0, -124);
  c.lineTo(30, -86); c.lineTo(62, -112); c.lineTo(60, -70); c.closePath();
  fs(c, '#ffe14d', 5);
  for (const [gx, gy] of [[-62, -112], [0, -124], [62, -112]]) { oval(c, gx, gy, 6, 6); fs(c, '#e23', 3); }
  c.restore();
  eyes(c, s, 0, -12, 19, 23, 32, ph >= 1);
  if (s.mouth > 0) {
    oval(c, 0, 42, 26, 18); fs(c, '#3a0a0a', 4);
    oval(c, 0, 50, 14, 7); c.fillStyle = '#e0566b'; c.fill();
  } else {
    c.beginPath(); c.moveTo(-34, 32); c.quadraticCurveTo(0, ph >= 2 ? 40 : 64, 34, 32); c.closePath();
    fs(c, '#3a0a0a', 4);
    c.fillStyle = '#fff'; c.fillRect(-20, 33, 12, 8); c.fillRect(8, 33, 12, 8);
  }
  oval(c, -56, 22, 10, 6); c.fillStyle = 'rgba(255,90,90,.5)'; c.fill();
  oval(c, 56, 22, 10, 6); c.fill();
}

function drawVortex(c, s) {
  const t = s.t, ph = s.phase;
  c.translate(0, Math.sin(t * 2.5) * 8);
  for (let i = 0; i < 5 + ph; i++) {
    const a = t * 1.6 + (i / (5 + ph)) * TAU;
    oval(c, Math.cos(a) * 118, Math.sin(a) * 42 + 20, 9, 9); fs(c, '#e0b0ff', 3);
  }
  const col = ['#8a4dff', '#a33dff', '#d42c8a'][ph];
  oval(c, 0, 12, 72, 72); fs(c, col, 6);
  c.save(); oval(c, 0, 12, 68, 68); c.clip(); c.translate(0, 12); c.rotate(t * (1.5 + ph));
  c.beginPath();
  for (let a = 0; a < 15; a += 0.2) c.lineTo(Math.cos(a) * a * 5, Math.sin(a) * a * 5);
  c.lineWidth = 10; c.strokeStyle = 'rgba(255,255,255,.2)'; c.stroke();
  c.restore();
  c.save(); c.translate(0, -48); c.rotate(-0.15 + Math.sin(t * 2) * 0.1);
  c.beginPath(); c.moveTo(-46, -6); c.quadraticCurveTo(-8, -60, 30, -118); c.quadraticCurveTo(22, -50, 46, -6); c.closePath();
  fs(c, '#3b1670', 5);
  c.beginPath(); c.moveTo(-44, -14); c.lineTo(44, -14); c.lineTo(46, -4); c.lineTo(-46, -4); c.closePath(); fs(c, '#ffcc33', 3);
  oval(c, 0, 0, 86, 15); fs(c, '#2a1050', 5);
  c.save(); c.translate(30, -118); c.rotate(t * 3);
  c.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 10, a = (i / 10) * TAU; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  c.closePath(); fs(c, '#ffe14d', 2);
  c.restore(); c.restore();
  eyes(c, s, 0, 4, 17, 22, 27, ph >= 2, '#2a0a40');
  c.lineWidth = 4; c.strokeStyle = '#111';
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    const ex = side * 27 + (k - 1) * 9;
    c.beginPath(); c.moveTo(ex, -16); c.lineTo(ex + (k - 1) * 4, -26); c.stroke();
  }
  if (s.mouth > 0) { oval(c, 0, 50, 16, 13); fs(c, '#600', 4); }
  else { c.beginPath(); c.moveTo(-22, 44); c.quadraticCurveTo(0, 62, 22, 44); c.quadraticCurveTo(0, 52, -22, 44); fs(c, '#e8245a', 3); }
}

function drawSawbones(c, s) {
  const t = s.t, ph = s.phase;
  c.translate(0, Math.sin(t * 5) * 3);
  for (const side of [-1, 1]) {
    c.beginPath(); c.moveTo(side * 40, 20); c.lineTo(side * 100, 28);
    c.lineWidth = 10; c.strokeStyle = '#111'; c.stroke();
    sawShape(c, side * 104, 28, 44, t * (8 + ph * 5) * side, 14);
  }
  const jo = s.mouth > 0 ? 18 : Math.max(0, Math.sin(t * 9)) * 5;
  rrect(c, -38, 26 + jo, 76, 36, 12); fs(c, '#e6dfc8', 5);
  c.lineWidth = 3; c.strokeStyle = '#111';
  for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 13, 28 + jo); c.lineTo(i * 13, 42 + jo); c.stroke(); }
  oval(c, 0, -14, 68, 60); fs(c, '#f2ecd9', 6);
  c.beginPath(); c.moveTo(-66, -30); c.quadraticCurveTo(0, -100, 66, -30); c.quadraticCurveTo(0, -52, -66, -30); fs(c, '#c62828', 5);
  for (let i = 0; i < 3; i++) { oval(c, -30 + i * 30, -52, 4, 4); c.fillStyle = '#fff'; c.fill(); }
  c.beginPath(); c.moveTo(62, -36); c.quadraticCurveTo(95, -40 + Math.sin(t * 10) * 8, 104, -20); c.lineTo(66, -26); c.closePath(); fs(c, '#c62828', 4);
  for (const side of [-1, 1]) {
    oval(c, side * 25, -10, 18, 20); fs(c, '#111', 3);
    const big = ph >= 2 && side > 0 ? 1.6 : 1;
    oval(c, side * 25 + s.lx * 5, -8 + s.ly * 5, 5 * big, 5 * big); c.fillStyle = '#ff3b2f'; c.fill();
  }
  c.beginPath(); c.moveTo(0, 6); c.lineTo(-8, 20); c.lineTo(8, 20); c.closePath(); fs(c, '#111', 2);
  c.fillStyle = '#fff';
  for (let i = -2; i <= 2; i++) { rrect(c, i * 13 - 5, 26, 10, 12, 3); fs(c, '#fff', 2); }
  if (ph >= 1) {
    c.beginPath(); c.moveTo(-50, -40); c.lineTo(-38, -30); c.lineTo(-44, -18); c.lineTo(-34, -8);
    c.lineWidth = 3; c.strokeStyle = '#111'; c.stroke();
  }
}

function drawTick(c, s) {
  const t = s.t, ph = s.phase;
  c.translate(0, Math.abs(Math.sin(t * 4)) * -8);
  for (const side of [-1, 1]) {
    c.beginPath(); c.moveTo(side * 30, 70); c.lineTo(side * 38, 98); c.lineWidth = 8; c.strokeStyle = '#111'; c.stroke();
    oval(c, side * 44, 100, 18, 9); fs(c, '#222', 3);
  }
  for (const side of [-1, 1]) {
    c.beginPath(); c.arc(side * 50, -72, 24, Math.PI, 0); c.closePath(); fs(c, '#d9a521', 5);
  }
  c.save(); c.translate(0, -70); c.rotate(Math.sin(t * (14 + ph * 6)) * 0.7);
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -30); c.lineWidth = 5; c.strokeStyle = '#111'; c.stroke();
  oval(c, 0, -32, 7, 7); fs(c, '#d9a521', 3);
  c.restore();
  oval(c, 0, 0, 80, 80); fs(c, '#d9a521', 6);
  oval(c, 0, 0, 64, 64); fs(c, ['#fff6dc', '#ffe6c8', '#ffc9b8'][ph], 4);
  c.lineWidth = 3; c.strokeStyle = '#111';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU, r1 = i % 3 ? 54 : 48;
    c.beginPath(); c.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); c.lineTo(Math.cos(a) * 60, Math.sin(a) * 60); c.stroke();
  }
  const mA = t * (2 + ph * 2) - Math.PI / 2, hA = t * 0.5 - Math.PI / 2;
  c.lineWidth = 6; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(hA) * 34, Math.sin(hA) * 34); c.stroke();
  c.lineWidth = 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(mA) * 52, Math.sin(mA) * 52); c.stroke();
  eyes(c, s, 0, -18, 12, 15, 22, ph >= 1);
  c.beginPath();
  c.moveTo(0, 12);
  c.bezierCurveTo(-14, 4, -30, 10, -34, 22); c.bezierCurveTo(-22, 18, -12, 22, 0, 16);
  c.bezierCurveTo(12, 22, 22, 18, 34, 22); c.bezierCurveTo(30, 10, 14, 4, 0, 12);
  fs(c, '#4a2c12', 3);
  if (s.mouth > 0) { oval(c, 0, 36, 12, 10); fs(c, '#600', 3); }
  else { c.beginPath(); c.moveTo(-12, 34); c.quadraticCurveTo(0, ph >= 2 ? 30 : 42, 12, 34); c.lineWidth = 4; c.stroke(); }
  oval(c, 0, 0, 5, 5); fs(c, '#111', 0);
}

function drawNull(c, s) {
  const t = s.t, ph = s.phase;
  const n = 4 + ph * 2;
  for (let i = 0; i < n; i++) {
    const a = t * (1 + ph * 0.5) + (i / n) * TAU;
    c.save(); c.translate(Math.cos(a) * 125, Math.sin(a) * 58); c.rotate(t * 3 + i);
    c.fillStyle = '#000'; c.fillRect(-9, -9, 18, 18);
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.strokeRect(-9, -9, 18, 18);
    c.restore();
  }
  c.save();
  c.rotate(Math.sin(t * 1.3) * 0.08 + (Math.random() < 0.06 ? rand(-0.25, 0.25) : 0));
  c.fillStyle = '#050505'; c.fillRect(-72, -72, 144, 144);
  c.lineWidth = 4;
  c.strokeStyle = 'rgba(255,0,90,.8)'; c.strokeRect(-72 + 3, -72, 144, 144);
  c.strokeStyle = 'rgba(0,240,255,.8)'; c.strokeRect(-72 - 3, -72, 144, 144);
  c.strokeStyle = '#fff'; c.strokeRect(-72, -72, 144, 144);
  const blink = (t % 3.3) < 0.12 ? 0.1 : 1;
  oval(c, 0, 0, 46, 28 * blink); fs(c, '#fff', 0);
  if (blink === 1) {
    oval(c, s.lx * 14, s.ly * 8, 18, 18); c.fillStyle = ['#ff2a6d', '#ff2a2a', '#ff0000'][ph]; c.fill();
    oval(c, s.lx * 14, s.ly * 8, 4, 14); c.fillStyle = '#000'; c.fill();
  }
  if (ph >= 1) {
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2;
    for (let i = 0; i < 4 + ph * 3; i++) {
      const y = rand(-70, 70);
      c.beginPath(); c.moveTo(-70, y); c.lineTo(rand(-30, 70), y); c.stroke();
    }
  }
  c.restore();
}

// ---------------------------------------------------------------- squares
// The boss casts these onto you before its attacks. Each boss has its own set.
const SOULS = {
  red:    { name: 'RED SQUARE',     desc: 'normal',              col: '#ff2424', m: {} },
  blue:   { name: 'BLUE SQUARE',    desc: 'gravity pulls DOWN',  col: '#2a8cff', m: { grav: { x: 0, y: 1 } } },
  blueUp: { name: 'BLUE SQUARE ↑',  desc: 'gravity pulls UP',    col: '#3fa6ff', m: { grav: { x: 0, y: -1 } } },
  blueL:  { name: 'BLUE SQUARE ←',  desc: 'gravity pulls LEFT',  col: '#1f74e0', m: { grav: { x: -1, y: 0 } } },
  blueR:  { name: 'BLUE SQUARE →',  desc: 'gravity pulls RIGHT', col: '#1f74e0', m: { grav: { x: 1, y: 0 } } },
  purple: { name: 'PURPLE SQUARE',  desc: 'controls reversed',   col: '#c45cff', m: { reverse: true } },
  cyan:   { name: 'CYAN SQUARE',    desc: 'slippery as ice',     col: '#7ff6ff', m: { ice: true } },
  yellow: { name: 'YELLOW SQUARE',  desc: 'hyper speed',         col: '#ffe600', m: { spd: 1.7 } },
  orange: { name: 'ORANGE SQUARE',  desc: 'heavy and slow',      col: '#ff8a1f', m: { spd: 0.6 } },
  slow:   { name: 'CLOCK SQUARE',   desc: 'time slows down',     col: '#9fe8d0', m: { time: 0.55 } },
  fast:   { name: 'TURBO SQUARE',   desc: 'time speeds up',      col: '#ff5a8a', m: { time: 1.45 } },
  giant:  { name: 'GIANT SQUARE',   desc: 'you are huge',        col: '#ff4a4a', m: { size: 1.8 } },
  shadow: { name: 'SHADOW SQUARE',  desc: 'lights out',          col: '#a0a0a0', m: { dark: true } },
};
const baseM = () => ({ time: 1, grav: null, reverse: false, ice: false, spd: 1, size: 1, dark: false, gscale: 1, swim: false, wind: false, autorun: false });
function soulDesc(k) {
  const s = SOULS[k];
  return s.m.grav ? s.desc + '  ·  JUMP: ' + keyList('jump') : s.desc;
}

// ---------------------------------------------------------------- bosses
// Each boss has a fixed pattern per phase: a list of [attack, square] steps that loops.
// Attacks joined with '+' run at the same time. You win by surviving BOSS_DUR seconds (times the MODE).
const _ = null;
const BOSSES1 = [
  {
    name: 'KING CUBERT', title: 'RULER OF BLOCK ISLE', r: 80, island: 0,
    bullet: '#ffd23f', laser: '#ffe680', bg: ['#3a1c0c', '#120804'], ray: '#ffb347',
    intro: [
      'KING CUBERT blocks the way!',
      'His crown is cracked. His eyes glow red.',
      'Something black drips from under the crown.',
    ],
    talk: [[
      'A SQUARE?! In MY kingdom?!',
      'Every square bows to the crown... and the crown bows to... to the NULL.',
      "No! That's not... GUARDS! ...Where are all my guards?",
    ], [
      "Why won't you just BREAK?!",
      "There's a voice in my head. It says: DELETE THE SQUARE.",
      "...I don't want to. But I can't stop!",
    ]],
    freed: [
      "Ugh... my head. It's... quiet again.",
      'That black thing. The NULL. It crawled out of the sea and into my crown.',
      'It took the other rulers too. Queen Vortex is next, on Spiral Isle.',
      'Please, little square. Save her!',
    ],
    souls: ['red', 'blue', 'purple'],
    patterns: [
      [['rain', 'red'], ['aimed', 'red'], ['boneFloor', 'blue'], ['boneWall', 'blue'], ['aimed', 'purple']],
      [['boneWall', 'red'], ['rain', 'purple'], ['boneFloor', 'blue'], ['ringBurst', 'red'], ['slam', 'blue']],
      [['slam', 'red'], ['boneWall', 'blue'], ['crossfire', 'purple'], ['boneFloor', 'blue'], ['laserSweep', 'red']],
    ],
    music: { root: 65.41, bpm: 160, bass: [0, _, 12, _, 0, _, 10, _, 7, _, 12, _, 3, _, 5, 6, 0, _, 12, _, 0, _, 10, _, 3, _, 5, _, 7, _, 10, _],
      // royal brass march
      lead: [12, _, 15, _, 19, _, 17, 15, 12, _, 10, _, 12, _, _, _, 15, _, 17, _, 19, _, 22, _, 24, _, 22, 19, 17, _, 15, _],
      leadWave: 'square', leadVol: 0.022, leadLen: 0.13,
      drums: { k: 'k...k...k...k...', s: '....s.......s...', h: '..h...h...h...h.' } },
    draw: drawCubert,
  },
  {
    name: 'QUEEN VORTEX', title: 'RULER OF SPIRAL ISLE', r: 74, island: 1,
    bullet: '#c18bff', laser: '#e9c8ff', bg: ['#1f0b3a', '#08020f'], ray: '#b07cff',
    intro: [
      'QUEEN VORTEX swirls into view!',
      'Her spirals are spinning the wrong way.',
    ],
    talk: [[
      'Ooh, a little square~! Shall we dance?',
      'Round and round... the Null LOVES it when things go round...',
      '...it makes it so hard to think~',
    ], [
      'STOP. STOP DODGING.',
      'The spiral wants you. The VOID wants you.',
      'Help... me... — ahaha, I mean, DISAPPEAR!',
    ]],
    freed: [
      'Oh my... the world stopped spinning.',
      'I felt so cold inside. Like a hole where my magic should be.',
      'King Sawbones guards the Rust Reef. If the Null has him too...',
      '...those saws will be very unpleasant. Be careful, darling.',
    ],
    souls: ['red', 'cyan', 'purple', 'blueUp'],
    patterns: [
      [['spiral', 'red'], ['ringBurst', 'cyan'], ['homing', 'red'], ['aimed', 'purple']],
      [['spiral', 'cyan'], ['bouncers', 'red'], ['closingRing', 'purple'], ['homing', 'cyan'], ['boneFloor', 'blueUp']],
      [['spiral', 'purple'], ['closingRing', 'cyan'], ['laserSweep', 'red'], ['bouncers', 'blueUp'], ['homing', 'purple']],
    ],
    music: { root: 73.42, bpm: 170, bass: [0, _, 0, 12, _, 0, 3, _, 5, _, 5, 17, _, 5, 3, _, 0, _, 0, 12, _, 0, 3, _, 7, _, 6, _, 5, _, 3, _],
      // spooky carnival swirl
      lead: [12, 13, 12, _, 15, _, 17, _, 20, _, 19, _, 17, _, 15, _, 12, 13, 12, _, 15, _, 20, _, 19, _, 17, _, 15, 13, 12, _],
      leadWave: 'sine', leadVol: 0.04, leadLen: 0.16, bassWave: 'triangle', bassVol: 0.06,
      drums: { k: 'k.......k.k.....', s: '....s.......s...', h: 'hhhhhhhhhhhhhhhh' } },
    draw: drawVortex,
  },
  {
    name: 'KING SAWBONES', title: 'RULER OF THE RUST REEF', r: 72, island: 2,
    bullet: '#efe8d2', laser: '#ff5a48', bg: ['#2a0d0d', '#0a0303'], ray: '#ff6a4d',
    intro: [
      'KING SAWBONES rattles in, blades screaming!',
      'Black goo leaks out between his bones.',
    ],
    talk: [[
      "Heh. Heh heh. You're quick, kid.",
      'My saws used to build ships for the whole sea.',
      'Now they just... cut. The Null LIKES cutting.',
    ], [
      "ALL FOUR CORNERS. I'LL TAKE ALL FOUR!",
      "Grrk... rattle... it's in my marrow...",
      "Keep movin', kid. Don't let me catch you!",
    ]],
    freed: [
      '...Ack. Feels like I just lost a hundred pounds of rust.',
      "Kid, that thing ain't a monster. It's a VIRUS. It copies itself into whatever it touches.",
      'The old clock on Clockwork Cay was the first one it got.',
      "Go on. Time's tickin'.",
    ],
    souls: ['blue', 'blueL', 'blueR', 'orange', 'yellow'],
    patterns: [
      [['saws', 'blue'], ['sniper', 'yellow'], ['boneFloor', 'blue'], ['charge', 'orange']],
      [['saws', 'blue'], ['boneWall', 'blueL'], ['crossfire', 'yellow'], ['sniper', 'orange'], ['charge', 'yellow']],
      [['saws', 'blueR'], ['zones', 'yellow'], ['boneWall', 'blue'], ['charge', 'orange'], ['bouncers', 'blueL'], ['sniper', 'yellow']],
    ],
    music: { root: 55, bpm: 180, bass: [0, 0, _, 0, 12, _, 0, _, 3, 3, _, 3, 15, _, 3, _, 5, 5, _, 5, 17, _, 5, _, 6, _, 7, _, 10, _, 12, _],
      // grinding rock riff
      lead: [12, _, 12, 15, _, 17, _, 18, 19, _, _, 19, 18, 17, 15, _, 12, _, 12, 15, _, 17, _, 18, 22, _, 19, _, 18, _, 17, _],
      leadWave: 'sawtooth', leadVol: 0.02, leadLen: 0.1, bassWave: 'sawtooth', bassVol: 0.025,
      drums: { k: 'k.k...k.k.k...k.', s: '....s.......s..s', h: 'h.h.h.h.h.h.h.h.' } },
    draw: drawSawbones,
  },
  {
    name: 'KING TICK-TOCK', title: 'RULER OF CLOCKWORK CAY', r: 82, island: 3,
    bullet: '#ffe08a', laser: '#ffd34d', bg: ['#0c1f2a', '#02080c'], ray: '#7fd8ff',
    intro: [
      'KING TICK-TOCK winds himself up.',
      'His hands are spinning backwards.',
      'You are running out of time.',
    ],
    talk: [[
      'Tick... tock... I have counted every second since it came.',
      'Four hundred thousand, two hundred and six.',
      'It promised me MORE time. It LIED.',
    ], [
      'SLOW. FAST. SLOW. FAST. WHICH ONE IS IT?!',
      'My gears grind... the Null is rewriting my clockwork!',
      'Your time... is... UP!',
    ]],
    freed: [
      '...Ding. The correct hour, at last.',
      'The Null lives at the heart of the sea, on the Core. It fed on all four of us.',
      'Now that we are free, it is weak.',
      "Finish it, little square. It's time.",
    ],
    souls: ['slow', 'fast', 'red', 'blue'],
    patterns: [
      [['clockHands', 'red'], ['sniper', 'slow'], ['rain', 'fast'], ['laserGrid', 'red']],
      [['clockHands', 'slow'], ['laserGrid', 'fast'], ['crossfire', 'red'], ['ringBurst', 'fast'], ['slam', 'blue']],
      [['clockHands', 'fast'], ['laserGrid', 'slow'], ['laserSweep', 'fast'], ['closingRing', 'red'], ['zones', 'fast']],
    ],
    music: { root: 61.74, bpm: 150, bass: [0, _, 7, _, 12, _, 7, _, 0, _, 7, _, 12, _, 7, _, 5, _, 12, _, 17, _, 12, _, 3, _, 10, _, 15, _, 10, _],
      // music-box clockwork with a tick-tock beat
      lead: [24, _, 31, _, 36, _, 31, _, 24, _, 31, _, 36, _, 31, _, 29, _, 36, _, 41, _, 36, _, 27, _, 34, _, 39, _, 34, _],
      leadWave: 'sine', leadVol: 0.035, leadLen: 0.09, bassWave: 'triangle', bassVol: 0.06,
      drums: { k: 'k.......k.......', s: '........s.......', h: '................', t: 't...t...t...t...' } },
    draw: drawTick,
  },
  {
    name: 'THE NULL', title: 'THE VIRUS AT THE CORE', r: 80, island: 4,
    bullet: '#ffffff', laser: '#ff2a6d', bg: ['#0a0a0a', '#000000'], ray: '#ffffff', glitch: true,
    intro: [
      'THE NULL fills the room.',
      'There is no ruler here. Only the virus.',
      'It is just you and the void now.',
    ],
    talk: [[
      'S Q U A R E . . .',
      'Y O U   R E M O V E D   M Y   H O S T S',
      'I   W I L L   C O P Y   M Y S E L F   I N T O   Y O U',
    ], [
      'E R R O R . . .   E R R O R . . .',
      'W H Y   C A N T   I   O V E R W R I T E   Y O U',
      'Y O U   A R E   O N L Y   A   S Q U A R E',
    ]],
    last: [
      'N O . . .   N O T   L I K E   T H I S . . .',
      'N U L L   P O I N T E R   E X C E P T I O N',
    ],
    after: [
      'The Null breaks apart into a million tiny pixels...',
      '...and every last one of them fades away.',
      'The Square Sea is free.',
    ],
    souls: ['red', 'shadow', 'giant', 'purple', 'cyan', 'yellow', 'orange', 'blue', 'blueUp', 'blueR', 'slow', 'fast'],
    patterns: [
      [['laserGrid', 'red'], ['spiral', 'shadow'], ['saws', 'blue'], ['homing', 'giant'], ['zones', 'purple']],
      [['charge', 'yellow'], ['spiral', 'cyan'], ['boneWall', 'blueUp'], ['closingRing', 'shadow'], ['sniper', 'orange'], ['laserGrid', 'giant']],
      [['clockHands', 'purple'], ['saws', 'blueR'], ['slam', 'fast'], ['laserSweep', 'shadow'], ['bouncers+rain', 'giant'], ['laserGrid', 'slow'], ['spiral+crossfire', 'blue']],
    ],
    music: { root: 49, bpm: 190, bass: [0, 0, 12, 0, 0, 12, 0, 13, 0, 0, 12, 0, 15, 13, 12, 10, 0, 0, 12, 0, 0, 12, 0, 13, 7, 7, 6, 6, 5, 5, 3, 1],
      // detuned, broken, chromatic dread
      lead: [12, _, _, 13, _, _, 12, _, 18, _, _, 17, _, _, 15, _, 12, _, _, 13, _, _, 12, _, 24, 23, 22, 21, 20, 19, 18, _],
      leadWave: 'sawtooth', leadVol: 0.018, leadLen: 0.14, detune: true,
      drums: { k: 'k..k..k.k..k..k.', s: '....s..s....s.s.', h: 'hhhhhhhhhhhhhhhh' } },
    draw: drawNull,
  },
];

let BOSSES = BOSSES1;

// calm-ish theme for the title and boss-select screens
const MENU_MUSIC = {
  root: 65.41, bpm: 112, bassWave: 'triangle', bassVol: 0.07, bassLen: 0.2,
  bass: [0, _, _, _, 7, _, _, _, 5, _, _, _, 7, _, _, _, 3, _, _, _, 10, _, _, _, 8, _, _, _, 7, _, _, _],
  lead: [12, _, 15, _, 19, _, 15, _, 17, _, 15, _, 14, _, _, _, 15, _, 19, _, 22, _, 19, _, 20, _, 19, _, 17, _, _, _],
  leadWave: 'triangle', leadVol: 0.035, leadLen: 0.22,
  drums: { k: 'k.......k.......', s: '................', h: '....h.......h...' },
};

// ---------------------------------------------------------------- global state
let state = 'chapters'; // the game opens on the chapter select
let F = null;        // current fight
let sel = 0;         // island the boat is at on the map
let titleSel = 0;    // title menu choice
let setSel = 0, setCol = 0;
let selRow = 0;      // select screen row: 0 boss, 1 mode, 2 hits
let confirmReset = false, resetDone = 0;
let gT = 0;          // global clock

// ---------------------------------------------------------------- fight helpers (used by attacks)
function at(d, fn) { F.sched.push({ t: F.wt + d, fn }); }
function rep(n, iv, fn, d0 = 0) { for (let i = 0; i < n; i++) at(d0 + i * iv, () => fn(i)); return d0 + n * iv; }
function orb(x, y, vx, vy, o = {}) {
  const b = Object.assign({ type: 'orb', x, y, vx, vy, r: 7, t: 0, col: F.def.bullet }, o);
  b.r *= F.Z;
  F.bullets.push(b);
  return b;
}
function laser(o) {
  const b = Object.assign({ type: 'laser', x: 0, y: 0, ang: 0, len: 1800, w: 16, warn: 0.8, active: 0.5, rot: 0, t: 0, col: F.def.laser }, o);
  if (b.follow) { b.ox = b.x - F.boss.x; b.oy = b.y - F.boss.y; }
  if (!b.rel) b.w *= F.Z;
  b.warn /= F.W;
  F.bullets.push(b);
  if (!o.silent) sfx.charge();
  return b;
}
function aimAt(x, y) { return Math.atan2(F.p.y - y, F.p.x - x); }
function mark(x, y, life) { fx({ kind: 'mark', x, y, life, sz: 18, col: '#f44' }); }
function ringOf(x, y, k, sp, off = 0, r = 7) {
  for (let j = 0; j < k; j++) {
    const a = off + (j / k) * TAU;
    orb(x + Math.cos(a) * 30, y + Math.sin(a) * 30, Math.cos(a) * sp, Math.sin(a) * sp, { r });
  }
}
// where the gap in a bone wall goes; with gravity on it stays low enough to jump into
function gapPos(o, frac) {
  const g = F.M.grav, lo = o === 'v' ? A.t : A.l, hi = o === 'v' ? A.b : A.r;
  if (g) {
    const along = o === 'v' ? g.y : g.x;
    if (along > 0) return hi - 45 - frac * 50;
    if (along < 0) return lo + 45 + frac * 50;
  }
  return lo + 70 + frac * (hi - lo - 140);
}
// which wall is the floor right now
function floorSide() {
  const g = F.M.grav;
  return !g ? 'b' : g.y > 0 ? 'b' : g.y < 0 ? 't' : g.x < 0 ? 'l' : 'r';
}
// the boss only moves as part of its attacks
function moveBoss(x, y, dur, hop = false, land = null) {
  const b = F.boss;
  b.mv = { x0: b.ax, y0: b.ay, x1: x, y1: y, t: 0, dur, hop, land };
}

// ---------------------------------------------------------------- attacks
// Each attack pre-rolls all of its random numbers up front (from the seeded generator)
// and schedules its bullets, then returns how long it lasts in world seconds.
const ATK = {
  rain() {
    const n = Math.round(55 * F.D), iv = 0.075 / F.D;
    const v = Array.from({ length: n }, () => [sr(A.l + 8, A.r - 8), sr(-25, 25), sr(200, 260)]);
    rep(n, iv, i => { orb(v[i][0], A.t - 8, v[i][1], v[i][2] * F.S, { r: 8 }); sfx.drop(); });
    return n * iv + 2.4;
  },
  aimed() {
    const v = 6, iv = 0.5 / F.S, k = 3 + Math.min(3, F.phase + (F.mode >= 3 ? 1 : 0));
    rep(v, iv, () => {
      const b = F.boss, a = aimAt(b.x, b.y);
      for (let j = -k; j <= k; j++) {
        const aa = a + j * 0.16;
        orb(b.x + Math.cos(aa) * 50, b.y + Math.sin(aa) * 50, Math.cos(aa) * 300 * F.S, Math.sin(aa) * 300 * F.S, { r: 8 });
      }
      b.mouth = 0.25; sfx.fire();
    });
    return v * iv + 1.2;
  },
  boneWall() {
    const n = Math.round(5 + 3 * F.D), iv = 0.85 / F.D, horizOK = F.idx >= 2 || F.mode >= 3;
    const v = Array.from({ length: n }, () => [sc(0.5) ? 1 : -1, horizOK && sc(0.4), R()]);
    const sp = (300 + 20 * F.idx) * F.S;
    rep(n, iv, i => {
      const [dir, horiz, frac] = v[i];
      if (!horiz) F.bullets.push({ type: 'wall', o: 'v', pos: dir > 0 ? A.l - 16 : A.r + 2, th: 14 * F.Z, v: dir * sp, gc: gapPos('v', frac), gh: 90, t: 0 });
      else F.bullets.push({ type: 'wall', o: 'h', pos: dir > 0 ? A.t - 16 : A.b + 2, th: 14 * F.Z, v: dir * sp * 0.75, gc: gapPos('h', frac), gh: 96, t: 0 });
      sfx.whoosh();
    });
    return n * iv + A.w / sp + 0.2;
  },
  boneFloor() {
    const n = Math.round(10 + 4 * F.D), iv = 0.6 / F.D, dir = sc(0.5) ? 1 : -1;
    const lens = Array.from({ length: n }, () => sr(26, 58));
    const sp = (260 + 20 * F.idx) * F.S;
    rep(n, iv, i => {
      const side = floorSide(), alongX = side === 'b' || side === 't';
      const lo = alongX ? A.l : A.t, hi = alongX ? A.r : A.b;
      F.bullets.push({ type: 'bone', side, pos: dir > 0 ? lo - 14 : hi + 2, v: dir * sp, len: lens[i], th: 12 * F.Z, t: 0 });
      sfx.whoosh();
    });
    return n * iv + A.w / sp;
  },
  ringBurst() {
    const n = Math.round(6 + 3 * F.D), iv = 0.6 / F.D;
    const v = Array.from({ length: n }, () => [sr(A.l + 60, A.r - 60), sr(A.t + 60, A.b - 60), sr(0, TAU)]);
    rep(n, iv, i => {
      const [x, y, off] = v[i];
      mark(x, y, 0.6);
      at(0.6, () => { ringOf(x, y, Math.round(14 + 4 * F.D), 180 * F.S, off, 7); sfx.ring(); });
    });
    return n * iv + 3;
  },
  spiral() {
    const arms = 4 + Math.min(3, F.phase), dur = 5, iv = 0.13 / Math.sqrt(F.D), n = Math.floor(dur / iv);
    const spin = (1.3 + 0.3 * F.phase) * (sc(0.5) ? 1 : -1), off = sr(0, TAU);
    F.boss.mouth = 0.6;
    rep(n, iv, i => {
      const b = F.boss;
      for (let a = 0; a < arms; a++) {
        const ang = off + i * iv * spin + (a / arms) * TAU;
        orb(b.x + Math.cos(ang) * 45, b.y + Math.sin(ang) * 45, Math.cos(ang) * 170 * F.S, Math.sin(ang) * 170 * F.S, { r: 7 });
      }
      // from phase 2 on, a second spiral turns the other way
      if (F.phase >= 1 && i % 2 === 0) for (let a = 0; a < 3; a++) {
        const ang = -off - i * iv * spin * 0.8 + (a / 3) * TAU;
        orb(b.x, b.y, Math.cos(ang) * 130 * F.S, Math.sin(ang) * 130 * F.S, { r: 9, col: '#fff' });
      }
      sfx.spiralTick();
    }, 0.5);
    return 0.5 + dur + 1.5;
  },
  bouncers() {
    const n = Math.round(5 + 3 * F.D);
    const v = Array.from({ length: n }, () => sr(0, TAU));
    rep(n, 0.35, i => {
      const b = F.boss, a = v[i];
      orb(b.x + Math.cos(a) * 50, b.y + Math.sin(a) * 50, Math.cos(a) * 230 * F.S, Math.sin(a) * 230 * F.S, { r: 11, bounce: 4, life: 7 });
      b.mouth = 0.2; sfx.ring();
    });
    return n * 0.35 + 4;
  },
  homing() {
    const n = Math.round(5 + 2 * F.D), iv = 0.45 / F.S;
    const v = Array.from({ length: n }, () => sr(0, TAU));
    rep(n, iv, i => {
      const b = F.boss, a = v[i];
      orb(b.x + Math.cos(a) * 50, b.y + Math.sin(a) * 50, Math.cos(a) * 200, Math.sin(a) * 200, {
        r: 9, homing: 2.0 * F.S, homeTime: 2.4, life: 5, spd: 220 * F.S, missile: true,
      });
      b.mouth = 0.2; sfx.missile();
    });
    return n * iv + 3;
  },
  laserSweep() {
    const rot = 0.9 * F.S * (sc(0.5) ? 1 : -1), act = Math.PI / Math.abs(rot), a0 = sr(0, TAU);
    laser({ x: F.boss.x, y: F.boss.y, follow: true, ang: a0, rot, warn: 1.0, active: act, w: 18 });
    if (F.phase >= 2) laser({ x: F.boss.x, y: F.boss.y, follow: true, ang: a0 + Math.PI, rot, warn: 1.0, active: act, w: 18, silent: true });
    F.boss.mouth = 1 + act;
    return 1.0 + act + 0.5;
  },
  laserGrid() {
    const cols = 6, rows = 4, waves = Math.round(2 + F.D), iv = 1.3 / F.S;
    const v = Array.from({ length: waves }, () => ({
      safeR: sri(0, rows - 1), safeC: sri(0, cols - 1),
      hr: Array.from({ length: rows }, () => sc(0.8)), vc: Array.from({ length: cols }, () => sc(0.8)),
    }));
    rep(waves, iv, i => {
      const w = v[i];
      for (let r = 0; r < rows; r++) if (r !== w.safeR && w.hr[r]) laser({ rel: true, fx: 0, fy: (r + 0.5) / rows, ang: 0, warn: 1.0, active: 0.4, w: (A.h / rows) * 0.5, silent: true });
      for (let c = 0; c < cols; c++) if (c !== w.safeC && w.vc[c]) laser({ rel: true, fx: (c + 0.5) / cols, fy: 0, ang: Math.PI / 2, warn: 1.0, active: 0.4, w: (A.w / cols) * 0.5, silent: true });
      sfx.charge();
    });
    return waves * iv + 1.6;
  },
  sniper() {
    const n = Math.round(4 + 2 * F.D), iv = 0.75 / F.S;
    rep(n, iv, () => laser({ x: F.boss.x, y: F.boss.y, follow: true, track: 0.55, warn: 0.8, active: 0.15, w: 14 }));
    return n * iv + 1.2;
  },
  crossfire() {
    const n = Math.round(16 + 8 * F.D), iv = 0.2 / F.D, sides = F.phase >= 1 ? 4 : 2;
    const v = Array.from({ length: n }, () => sr(-60, 60));
    rep(n, iv, i => {
      const side = i % sides, sp = 320 * F.S;
      if (side < 2) { // from the left / right wall at your height
        const left = side === 0, y = clamp(F.p.y + v[i], A.t + 8, A.b - 8);
        orb(left ? A.l - 10 : A.r + 10, y, (left ? 1 : -1) * sp, 0, { r: 8 });
      } else { // from the floor / ceiling at your x
        const top = side === 2, x = clamp(F.p.x + v[i], A.l + 8, A.r - 8);
        orb(x, top ? A.t - 10 : A.b + 10, 0, (top ? 1 : -1) * sp, { r: 8 });
      }
      sfx.drop();
    });
    return n * iv + 2.8;
  },
  saws() {
    const n = Math.round(4 + 2 * F.D), iv = 0.9 / F.S;
    const v = Array.from({ length: n }, () => [sc(0.5) ? 1 : -1, sri(0, 3), sr(240, 300), sr(0, TAU), sc(0.6)]);
    rep(n, iv, i => {
      const [dir, sideI, sp, ang, extra] = v[i];
      const side = F.M.grav ? floorSide() : ['b', 't', 'l', 'r'][sideI];
      const alongX = side === 'b' || side === 't';
      F.bullets.push({
        type: 'saw', side, r: 26 * Math.min(F.Z, 1.3), t: 0, spin: dir * 12,
        x: alongX ? (dir > 0 ? A.l - 30 : A.r + 30) : 0, y: alongX ? 0 : (dir > 0 ? A.t - 30 : A.b + 30),
        vx: alongX ? dir * sp * F.S : 0, vy: alongX ? 0 : dir * sp * F.S,
      });
      if (extra) {
        const b = F.boss;
        F.bullets.push({ type: 'saw', x: b.x, y: b.y, r: 18 * F.Z, vx: Math.cos(ang) * 220 * F.S, vy: Math.sin(ang) * 220 * F.S, t: 0, spin: 14, bounce: 3, life: 6 });
      }
      sfx.sawBuzz();
    });
    return n * iv + 3.2;
  },
  closingRing() {
    const waves = Math.round(3 + F.D), iv = 1.3 / F.S, k = 48, Rr = 600;
    const gaps = Array.from({ length: waves }, () => sri(0, k - 1));
    rep(waves, iv, i => {
      const cx = F.boss.x, cy = F.boss.y, sp = 150 * F.S;
      for (let j = 0; j < k; j++) {
        if ((j - gaps[i] + k) % k < 5) continue;
        const a = (j / k) * TAU;
        orb(cx + Math.cos(a) * Rr, cy + Math.sin(a) * Rr, -Math.cos(a) * sp, -Math.sin(a) * sp, { r: 8, life: (Rr - 40) / sp });
      }
      sfx.ring();
    });
    return waves * iv + Rr / (150 * F.S);
  },
  clockHands() {
    const dur = 5, spin = (0.8 + 0.25 * F.phase) * F.S, dir = sc(0.5) ? 1 : -1, a0 = sr(0, TAU);
    laser({ x: F.boss.x, y: F.boss.y, follow: true, ang: a0, rot: spin * dir, warn: 1.0, active: dur, w: 14 });
    if (F.phase >= 1 || F.idx === 4) laser({ x: F.boss.x, y: F.boss.y, follow: true, ang: a0 + Math.PI * 0.66, rot: -spin * dir * 0.7, warn: 1.0, active: dur, w: 10, silent: true });
    // the clock spits out 'seconds' while the hands turn
    const nt = Math.round(10 * F.D), offs = sr(0, TAU);
    rep(nt, dur / nt, i => {
      const b = F.boss, a = offs + i * 2.4;
      orb(b.x, b.y, Math.cos(a) * 160 * F.S, Math.sin(a) * 160 * F.S, { r: 8 });
    }, 1.2);
    if (F.phase >= 2) {
      const xs = Array.from({ length: 14 }, () => sr(A.l + 10, A.r - 10));
      rep(14, 0.32, i => orb(xs[i], A.t - 8, 0, 220 * F.S, { r: 8 }), 1.2);
    }
    F.boss.mouth = dur + 1;
    return dur + 1.6;
  },
  zones() {
    const cols = 6, rows = 4, waves = Math.round(3 + F.D), iv = 1.0 / F.S;
    const v = Array.from({ length: waves }, () => ({ safe: sri(0, cols * rows - 1), on: Array.from({ length: cols * rows }, () => sc(0.6)) }));
    rep(waves, iv, i => {
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const k = r * cols + c;
        if (k === v[i].safe || !v[i].on[k]) continue;
        F.bullets.push({ type: 'zone', fx: c / cols, fy: r / rows, fw: 1 / cols, fh: 1 / rows, warn: 0.8 / F.W, active: 0.4, t: 0 });
      }
      sfx.charge();
    });
    return waves * iv + 1.4;
  },
  // the boss rushes between corners; the red line shows its path
  charge() {
    const corners = [[A.l + 100, A.t + 90], [A.r - 100, A.t + 90], [A.r - 100, A.b - 90], [A.l + 100, A.b - 90]];
    const start = sri(0, 3), stepDir = sc(0.5) ? 1 : 3, n = 3 + (F.phase >= 1 ? 1 : 0), gap = 1.3 / F.S;
    let t = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = corners[(start + i * stepDir) % 4];
      at(t, () => {
        const b = F.boss;
        fx({ kind: 'line', x: b.x, y: b.y, x2: x, y2: y, life: 0.7, col: '#ff3b3b' });
        b.mouth = 0.9; sfx.charge();
      });
      at(t + 0.7, () => {
        sfx.whoosh();
        moveBoss(x, y, 0.3, false, () => { ringOf(x, y, 18, 170 * F.S, 0.26 * i); F.shake = 8; sfx.ring(); });
      });
      t += gap + 0.3;
    }
    at(t, () => moveBoss(BX, BY, 0.7));
    return t + 0.9;
  },
  // the boss leaps onto where you are standing; get out of the shadow
  slam() {
    const n = 4, gap = 1.5 / F.S;
    let t = 0;
    for (let i = 0; i < n; i++) {
      at(t, () => {
        const tx = clamp(F.p.x, A.l + 80, A.r - 80), ty = clamp(F.p.y, A.t + 80, A.b - 80);
        fx({ kind: 'shadow', x: tx, y: ty, sz: F.bossR, life: 0.9 / F.W });
        F.boss.mouth = 0.9; sfx.jump();
        moveBoss(tx, ty, 0.9 / F.W, true, () => { ringOf(tx, ty, 24, 180 * F.S, 0.2 * i); F.shake = 12; sfx.boom(); });
      });
      t += gap;
    }
    at(t, () => moveBoss(BX, BY, 0.8, true));
    return t + 1.0;
  },
};

// ---------------------------------------------------------------- particles
function fx(o) { F.fx.push(Object.assign({ t: 0, life: 0.5, vx: 0, vy: 0, sz: 4, col: '#fff', kind: 'sq' }, o)); }
function burst(x, y, col, n = 8, sp = 200) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(sp * 0.3, sp);
    fx({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, col, sz: rand(2, 5), life: rand(0.3, 0.6) });
  }
}
function updateFx(dt) {
  for (const p of F.fx) {
    p.t += dt;
    if (p.kind === 'shard') p.vy += 700 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'sq') { p.vx *= 0.94; p.vy *= 0.94; }
  }
  F.fx = F.fx.filter(p => p.t < p.life);
}

// ---------------------------------------------------------------- fight lifecycle
function newPlayer() {
  return { x: BX, y: A.b - 60, vx: 0, vy: 0, hp: save.hp, max: save.hp, inv: 0, dashT: 0, dashCD: 0, dx: 0, dy: -1,
    grounded: false, wasGrounded: false, coyote: 0, jumpBuf: 0, jumpHeld: false, morph: 0 };
}

function startFight(idx, tutorial = false, retry = false) {
  const def = tutorial ? TUTOR : BOSSES[idx];
  F = {
    idx, def, tut: tutorial ? { step: 0, t: 0, n: 0, hits: 0 } : null,
    mode: tutorial ? 0 : save.mode, phase: 0, stage: 'talk', stageT: 0, rt: 0, wt: 0, time: 0, surv: 0,
    bullets: [], fx: [], sched: [],
    boss: { x: BX, y: BY, ax: BX, ay: BY, amp: 0, t: 0, flash: 0, mouth: 0, lx: 0, ly: 1, lift: 0, mv: null },
    bossR: def.r * BOSS_SCALE * 0.75,
    p: newPlayer(), soul: 'red', M: baseM(), cast: null, timeScale: 1,
    stepI: 0, nextAtk: 0, hits: 0, dashes: 0, talk: null, clip: null, freed: false, gone: false,
    shake: 0, hitstop: 0, flash: 0, banner: null, koT: 0, deadT: 0, resT: 0,
  };
  setDS();
  if (!tutorial) {
    F.plan = planPhases();
    F.dur = F.plan.reduce((a, p) => a + p.len, 0);
  }
  state = 'fight';
  if (retry) { beginReady(); return; }
  const intro = def.intro.map(t => ['*', t]);
  startTalk(intro, tutorial ? () => { F.stage = 'fight'; music.start(F.def.music); tutorialNext(); } : beginReady);
}
// D = bullet density, S = bullet speed
// Z = bullet size, W = how much quicker warnings are, driftA = how far the boss wanders
function setDS() {
  const md = MODES[F.mode];
  F.D = md.dens * (1 + 0.15 * F.idx + 0.25 * F.phase);
  F.S = md.spd * 0.9 * (1 + 0.06 * F.idx + 0.12 * F.phase);
  F.Z = md.size * (1 + 0.05 * F.phase);
  F.W = Math.sqrt(md.spd);
  F.driftA = (40 + 30 * F.phase) * md.move;
}
function beginReady() {
  F.stage = 'ready'; F.stageT = 0;
  music.start(F.def.music);
  sfx.ready();
}
function pauseGame() { state = 'pause'; music.stop(); }

// the boss's transformation spell: it glows, fires a bolt at you, and you change
const CAST_T = 1.0, CAST_HIT = 0.6;
function startCast(soul) {
  F.cast = { t: 0, soul, hit: false };
  F.boss.mouth = CAST_T;
  sfx.castStart();
}
function updateCast(dt) {
  const c = F.cast;
  if (!c) return;
  c.t += dt;
  if (!c.hit && c.t >= CAST_HIT) { c.hit = true; applySoul(c.soul); }
  if (c.t >= CAST_T) F.cast = null;
}
function applySoul(k) {
  const prevGrav = JSON.stringify(F.M.grav);
  F.soul = k;
  const M = baseM();
  Object.assign(M, SOULS[k].m);
  F.M = M;
  if (JSON.stringify(M.grav) !== prevGrav) { F.p.vx = 0; F.p.vy = 0; }
  const p = F.p, col = SOULS[k].col;
  p.morph = 0.45;
  fx({ kind: 'ring', x: p.x, y: p.y, col, sz: 8, life: 0.5 });
  fx({ kind: 'ring', x: p.x, y: p.y, col: '#fff', sz: 2, life: 0.35 });
  burst(p.x, p.y, col, 14, 220);
  F.banner = { text: SOULS[k].name, sub: soulDesc(k), col, t: 0 };
  F.shake = Math.max(F.shake, 5);
  sfx.soul(k);
}

// ---------------------------------------------------------------- phase planning
// Every phase is a whole number of pattern steps, and the length of each step is
// known in advance, so a phase ends exactly when its last attack does.
const PHASE_LEAD = [0.3, 0.6, 0.6]; // pause before the first attack of each phase
// how long one step's attack lasts, worked out by running it on a scratch copy of the fight
// which attack step n of a phase uses. The Dice King rolls for his; the rolls are seeded,
// so they come out the same every time and the phase can still be planned exactly.
function stepAt(ph, n) {
  const f = F, base = CH * 10000 + (f.idx + 1) * 1000 + ph * 100;
  if (f.def.dice) {
    seed(base + 50 + n);
    const roll = sri(1, 6), [atk, soul] = f.def.dice[ph][roll - 1];
    return { atk, soul, key: base + roll, roll };
  }
  const pat = f.def.patterns[ph], k = n % pat.length, [atk, soul] = pat[k];
  return { atk, soul, key: base + k };
}
function dryDur(atk, key) {
  const f = F, keep = [f.sched, f.bullets, f.fx, f.boss.mv, f.boss.mouth, f.shake, audio.muted];
  f.sched = []; f.bullets = []; f.fx = []; audio.muted = true;
  seed(key);
  sr(0, 1); sr(0, 1); // same numbers runAI uses for the boss's new spot
  let d = 0;
  for (const a of atk.split('+')) d = Math.max(d, ATK[a]());
  [f.sched, f.bullets, f.fx, f.boss.mv, f.boss.mouth, f.shake, audio.muted] = keep;
  return d;
}
const stepSpan = d => d * (1 - 0.05 * F.mode) + 0.25;
function planPhases() {
  const f = F, plans = [], target = fightDur(f.idx, f.mode) / 3;
  let soul = 'red';
  for (let ph = 0; ph < 3; ph++) {
    f.phase = ph; setDS();
    let t = PHASE_LEAD[ph], n = 0;
    while (t < target) {
      const st = stepAt(ph, n);
      t += (st.roll ? DICE_T : 0) + (st.soul !== soul ? CAST_T : 0) + stepSpan(dryDur(st.atk, st.key));
      soul = st.soul; n++;
    }
    plans.push({ len: t, count: n });
  }
  f.phase = 0; setDS();
  return plans;
}
// the real length of a fight (whole attacks, so a bit over the target), for the map
const durCache = {};
function realDur(i, m) {
  const k = CH + ':' + i + ':' + m;
  if (!(k in durCache)) {
    const keepF = F, keepState = state, keepMode = save.mode;
    save.mode = m; startFight(i); durCache[k] = F.dur;
    F = keepF; state = keepState; save.mode = keepMode;
  }
  return durCache[k];
}
const phaseStart = ph => F.plan.slice(0, ph).reduce((a, p) => a + p.len, 0);

// ---------------------------------------------------------------- talking
// lines are [speaker, text]; speaker '*' is the narrator, 'boss' is the current boss
function startTalk(lines, done) {
  F.stage = 'talk';
  F.talk = { lines, i: 0, t: 0, done };
}
function updateTalk(dt) {
  const k = F.talk, line = k.lines[k.i][1];
  const prev = Math.floor(k.t * 45);
  k.t += dt;
  const shown = Math.floor(k.t * 45);
  if (shown > prev && shown <= line.length && line[shown - 1] !== ' ' && shown % 2 === 0) sfx.text();
  if (k.lines[k.i][0] === 'boss' && shown < line.length) F.boss.mouth = 0.1;
  if (mtap('ok') && k.t > 0.12) {
    if (shown < line.length) k.t = line.length / 45;
    else if (++k.i >= k.lines.length) { F.talk = null; k.done(); }
    else k.t = 0;
  }
}

function clearBullets() {
  for (const b of F.bullets) if (b.type === 'orb' || b.type === 'saw') burst(b.x, b.y, b.col || '#fff', 2, 120);
  F.bullets = [];
  F.sched = [];
}
// the last step of a phase has finished: talk, then start the next phase
function endPhase() {
  const f = F;
  clearBullets();
  f.cast = null;
  f.surv = phaseStart(f.phase + 1);
  if (f.phase >= 2) { knockout(); return; }
  moveBoss(BX, BY, 0.6);
  f.shake = 10;
  sfx.phase();
  startTalk(f.def.talk[f.phase].map(t => ['boss', t]), () => phaseUp(f.phase + 1));
}
function phaseUp(ph) {
  F.phase = ph;
  setDS();
  F.stage = 'fight';
  F.stepI = 0;
  F.nextAtk = F.wt + PHASE_LEAD[ph];
  F.shake = 14; F.flash = 0.3;
  sfx.boom();
  burst(F.boss.x, F.boss.y, '#fff', 30, 400);
}
function knockout() {
  F.stage = 'ko'; F.koT = 0;
  clearBullets();
  F.cast = null;
  moveBoss(BX, BY, 0.5);
  music.stop();
  sfx.ko();
  F.shake = 16;
}
function hurt() {
  const p = F.p;
  F.shake = 10; F.hitstop = 0.1; F.flash = 0.25;
  sfx.hurt();
  burst(p.x, p.y, '#f33', 14, 260);
  p.inv = 1.3;
  if (F.tut) { F.tut.hits++; return; } // the tutorial never kills you
  p.hp--;
  F.hits++;
  if (p.hp <= 0) { state = 'dead'; F.deadT = 0; F.shattered = false; music.stop(); }
}
function finishFight() {
  const f = F, medal = medalFor(f.hits);
  const newUnlock = f.idx + 2 > save.unlocked && f.idx < 4;
  save.unlocked = Math.max(save.unlocked, Math.min(5, f.idx + 2));
  const best = save.best[f.idx];
  const score = r => (r.mode || 0) * 100 + r.medal * 20 - r.hp;
  const rec = { medal, hp: f.p.max, mode: f.mode };
  if (!best || score(rec) > score(best)) save.best[f.idx] = rec;
  if (f.idx === 4) save.beatAll = true;
  persist();
  f.result = { medal, newUnlock };
  f.resT = 0;
  sfx.win();
  state = 'results';
}

// ---------------------------------------------------------------- after the fight
// kings: the Null's virus is pulled out of them. The Null itself breaks apart.
function startClip() {
  const f = F;
  f.stage = 'clip';
  f.clip = { t: 0, kind: CH === 1 ? 'befriend' : f.idx === 4 ? 'erase' : 'purify', flashed: false };
  music.stop();
  sfx.castStart();
}
function updateClip(dt) {
  const f = F, c = f.clip, b = f.boss;
  c.t += dt;
  const end = c.kind === 'erase' ? 3.2 : 3.0;
  // chapter 2: the shaman calms down and hearts float up
  if (c.kind === 'befriend' && Math.random() < 0.35) {
    fx({ kind: 'heart', x: b.x + rand(-60, 60), y: b.y + rand(-20, 40), vx: rand(-20, 20), vy: rand(-110, -60), sz: rand(8, 14), life: 1.6 });
  }
  // dark pixels of the virus pour out of the boss
  if (c.kind !== 'befriend' && c.t < end - 0.6 && Math.random() < 0.7) {
    const a = rand(0, TAU), r = rand(10, F.bossR);
    fx({
      kind: 'virus', x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r,
      vx: c.kind === 'erase' ? Math.cos(a) * rand(60, 220) : rand(-40, 40),
      vy: c.kind === 'erase' ? Math.sin(a) * rand(60, 220) : rand(-260, -120),
      sz: rand(4, 10), life: rand(0.8, 1.6), col: pick(['#000', '#1a0026', '#ff2a6d', '#000']),
    });
    if (Math.random() < 0.15) sfx.zap();
  }
  f.shake = c.t < end - 0.6 ? 3 + c.t * 2 : f.shake;
  if (!c.flashed && c.t >= end - 0.6) {
    c.flashed = true;
    f.whiteFlash = 1;
    if (c.kind === 'erase') { f.gone = true; burst(b.x, b.y, '#fff', 60, 500); sfx.boom(); }
    else { f.freed = true; burst(b.x, b.y, c.kind === 'befriend' ? '#ff8ab0' : '#ffe680', 40, 300); sfx.unlock(); }
  }
  if (c.t >= end) {
    f.clip = null;
    const lines = c.kind === 'erase' ? f.def.after.map(t => ['*', t]) : f.def.freed.map(t => ['boss', t]);
    startTalk(lines, finishFight);
  }
}

// ---------------------------------------------------------------- fight update
function updateFight(dt) {
  const f = F;
  if (tap('pause') && f.stage !== 'talk') { pauseGame(); return; }
  f.rt += dt;
  f.shake = Math.max(0, f.shake - dt * 40);
  f.flash = Math.max(0, f.flash - dt);
  f.whiteFlash = Math.max(0, (f.whiteFlash || 0) - dt * 1.5);
  if (f.hitstop > 0) { f.hitstop -= dt; return; }

  if (f.stage === 'talk') {
    updateTalk(dt);
    updateBoss(dt);
    updateFx(dt);
    return;
  }
  if (f.stage === 'clip') {
    updateClip(dt);
    updateBoss(dt);
    updateFx(dt);
    return;
  }
  if (f.stage === 'ready') {
    f.stageT += dt;
    if (f.stageT - dt <= 0.9 && f.stageT > 0.9) sfx.fight();
    if (f.stageT > 1.5) { f.stage = 'fight'; f.nextAtk = f.wt + PHASE_LEAD[0]; }
  }
  f.timeScale += (f.M.time - f.timeScale) * Math.min(1, dt * 6);
  const wdt = dt * f.timeScale;
  f.wt += wdt;
  if (f.stage === 'fight') {
    f.time += dt;
    if (!f.tut) f.surv = Math.min(f.surv + wdt, phaseStart(f.phase + 1));
    if (f.p.hp === 1 && f.p.max > 1) { f.beatT = (f.beatT || 0) - dt; if (f.beatT <= 0) { f.beatT = 1.1; sfx.heartbeat(); } }
  }
  if (f.stage === 'ko') {
    f.koT += dt;
    if (Math.floor(f.koT * 10) !== Math.floor((f.koT - dt) * 10)) {
      burst(f.boss.x + rand(-60, 60), f.boss.y + rand(-55, 55), pick(['#fff', '#ffd23f', '#f84']), 12, 300);
      if (Math.random() < 0.4) sfx.pop();
    }
    if (f.koT > 1.6) {
      // the Null gets some last words before it falls apart
      if (f.def.last) startTalk(f.def.last.map(t => ['boss', t]), startClip);
      else startClip();
      return;
    }
  }
  updateBoss(wdt);
  if (f.stage === 'fight') { runSched(); if (f.tut) updateTutorial(dt); else runAI(); }
  updateCast(wdt);
  updateDice(wdt);
  updatePlayer(wdt); // the square speeds up / slows down with time too
  updateBullets(wdt);
  updateFx(dt);
  if (f.stage === 'fight') collide();
  if (f.banner) f.banner.t += dt;
}

function runSched() {
  const now = F.wt, due = [];
  F.sched = F.sched.filter(e => (e.t <= now ? (due.push(e), false) : true));
  for (const e of due) e.fn();
}
// play one step of the boss's fixed pattern (changing your square first if needed)
function playStep(atk, soul, seedKey, after) {
  const f = F;
  const go = () => {
    seed(seedKey);
    // the boss moves to a new (fixed) spot for every step of its pattern
    const tx = sr(A.l + 170, A.r - 170), ty = sr(A.t + 130, A.b - 150);
    if (!/charge|slam/.test(atk)) moveBoss(tx, ty, 0.6 / F.W);
    let dur = 0;
    for (const a of atk.split('+')) dur = Math.max(dur, ATK[a]());
    f.nextAtk = f.wt + stepSpan(dur);
    if (after) after(dur);
  };
  if (soul && soul !== f.soul) {
    startCast(soul);
    f.nextAtk = Infinity;
    at(CAST_T, go);
  } else go();
}
function runAI() {
  const f = F;
  if (f.cast || f.wt < f.nextAtk) return;
  if (f.stepI >= f.plan[f.phase].count) { endPhase(); return; }
  const st = stepAt(f.phase, f.stepI);
  f.stepI++;
  if (st.roll) { // the Dice King rolls first; the number picks the attack
    startDice(st);
    f.nextAtk = Infinity;
    at(DICE_T, () => playStep(st.atk, st.soul, st.key));
  } else playStep(st.atk, st.soul, st.key);
}

function updateBoss(dt) {
  const b = F.boss;
  b.t += dt; b.flash -= dt; b.mouth -= dt;
  if (b.mv) {
    const m = b.mv;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur), e = m.hop ? k : ease(k);
    b.ax = lerp(m.x0, m.x1, e); b.ay = lerp(m.y0, m.y1, e);
    b.lift = m.hop ? Math.sin(k * Math.PI) * 90 : 0;
    if (k >= 1) { b.mv = null; b.lift = 0; if (m.land) m.land(); }
  }
  // while it isn't rushing somewhere, the boss keeps drifting around its spot
  const amp = F.stage === 'fight' && !b.mv ? F.driftA : 0;
  b.amp += (amp - b.amp) * Math.min(1, dt * 2);
  b.x = clamp(b.ax + Math.sin(b.t * 0.8) * b.amp, A.l + 60, A.r - 60);
  b.y = clamp(b.ay + Math.sin(b.t * 1.1 + 1) * b.amp * 0.6, A.t + 60, A.b - 60);
  const dx = F.p.x - b.x, dy = F.p.y - b.y, l = Math.hypot(dx, dy) || 1;
  b.lx = dx / l; b.ly = dy / l;
}

function updatePlayer(dt) {
  const p = F.p, M = F.M;
  let ix = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  let iy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  if (M.reverse) { ix = -ix; iy = -iy; }
  // EMBER SQUARE: with no input you keep running the way you were going
  if (M.autorun && !ix && !iy && !M.grav) { ix = Math.round(p.dx); iy = Math.round(p.dy); }
  if (ix || iy) { const l = Math.hypot(ix, iy); p.dx = ix / l; p.dy = iy / l; }
  const spd = 210 * M.spd, ph = 8 * M.size;
  p.inv = Math.max(0, p.inv - dt);
  p.morph = Math.max(0, p.morph - dt);
  p.dashCD -= dt;

  if (tap('dash') && p.dashCD <= 0) {
    let dx = ix, dy = iy;
    if (!dx && !dy) { dx = p.dx; dy = p.dy; }
    const l = Math.hypot(dx, dy) || 1;
    p.vx = (dx / l) * 760; p.vy = (dy / l) * 760;
    p.dashT = 0.15; p.dashCD = 0.6;
    p.inv = Math.max(p.inv, 0.22);
    F.dashes++;
    sfx.dash();
  }

  if (p.dashT > 0) {
    p.dashT -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    fx({ kind: 'after', x: p.x, y: p.y, sz: ph, col: SOULS[F.soul].col, life: 0.2 });
    if (p.dashT <= 0) {
      if (M.grav) { if (M.grav.y) p.vy = 0; else p.vx = 0; }
      else { p.vx *= 0.3; p.vy *= 0.3; }
    }
  } else if (M.grav) {
    const g = M.grav, vert = g.y !== 0, s = vert ? g.y : g.x;
    const away = vert ? iy === -s : ix === -s;
    const jh = held('jump') || away;
    if (jh && !p.jumpHeld) p.jumpBuf = 0.12;
    p.jumpHeld = jh;
    p.jumpBuf -= dt;
    let along = vert ? p.vy : p.vx;
    let perp = vert ? p.vx : p.vy;
    const tgt = (vert ? ix : iy) * spd;
    perp = M.ice ? perp + (tgt - perp) * Math.min(1, dt * 3) : tgt;
    const G = 1500 * M.gscale;
    along += s * G * dt;
    if ((p.grounded || p.coyote > 0) && p.jumpBuf > 0) {
      along = -s * 560; p.jumpBuf = 0; p.coyote = 0; p.grounded = false;
      sfx.jump();
    } else if (M.swim && p.jumpBuf > 0) { // WATER SQUARE: swim strokes in mid-air
      along = -s * 300; p.jumpBuf = 0;
      sfx.jump();
    }
    if (!jh && along * s < 0) along += s * G * dt * 1.4;
    along = clamp(along, -900, 900);
    if (vert) { p.vy = along; p.vx = perp; } else { p.vx = along; p.vy = perp; }
    p.x += p.vx * dt; p.y += p.vy * dt;
  } else {
    const diag = ix && iy ? Math.SQRT1_2 : 1;
    const tx = ix * spd * diag, ty = iy * spd * diag;
    if (M.ice) { const k = Math.min(1, dt * 2.5); p.vx += (tx - p.vx) * k; p.vy += (ty - p.vy) * k; }
    else { p.vx = tx; p.vy = ty; }
    p.x += p.vx * dt; p.y += p.vy * dt;
  }

  // GREEN SQUARE: the wind keeps changing direction and pushes you along
  if (M.wind && p.dashT <= 0) {
    p.x += Math.sin(F.wt * 0.7) * 150 * dt;
    if (Math.random() < 0.3) fx({ kind: 'sq', x: rand(A.l, A.r), y: rand(A.t, A.b), vx: Math.sign(Math.sin(F.wt * 0.7)) * 500, vy: 0, sz: 2, col: 'rgba(220,255,240,.6)', life: 0.4 });
  }
  // stay inside the arena; touching the wall gravity pulls toward = standing on it
  const g = M.grav;
  p.grounded = false;
  if (p.x < A.l + ph) { p.x = A.l + ph; if (p.vx < 0) p.vx = 0; if (g && g.x < 0) p.grounded = true; }
  if (p.x > A.r - ph) { p.x = A.r - ph; if (p.vx > 0) p.vx = 0; if (g && g.x > 0) p.grounded = true; }
  if (p.y < A.t + ph) { p.y = A.t + ph; if (p.vy < 0) p.vy = 0; if (g && g.y < 0) p.grounded = true; }
  if (p.y > A.b - ph) { p.y = A.b - ph; if (p.vy > 0) p.vy = 0; if (g && g.y > 0) p.grounded = true; }
  if (p.grounded && !p.wasGrounded && g) sfx.land();
  p.wasGrounded = p.grounded;
  if (p.grounded) p.coyote = 0.08; else p.coyote -= dt;
}

function boneRect(b) {
  if (b.side === 'b') return { x: b.pos, y: A.b - b.len, w: b.th, h: b.len };
  if (b.side === 't') return { x: b.pos, y: A.t, w: b.th, h: b.len };
  if (b.side === 'l') return { x: A.l, y: b.pos, w: b.len, h: b.th };
  return { x: A.r - b.len, y: b.pos, w: b.len, h: b.th };
}
function wallRects(b) {
  if (b.o === 'v') {
    const gt = b.gc - b.gh / 2, gb = b.gc + b.gh / 2;
    return [{ x: b.pos, y: A.t, w: b.th, h: gt - A.t }, { x: b.pos, y: gb, w: b.th, h: A.b - gb }];
  }
  const gl = b.gc - b.gh / 2, gr = b.gc + b.gh / 2;
  return [{ x: A.l, y: b.pos, w: gl - A.l, h: b.th }, { x: gr, y: b.pos, w: A.r - gr, h: b.th }];
}
function laserSeg(b) {
  let x = b.x, y = b.y;
  if (b.rel) { x = A.l + b.fx * A.w; y = A.t + b.fy * A.h; }
  return [x, y, x + Math.cos(b.ang) * b.len, y + Math.sin(b.ang) * b.len];
}
function zoneRect(b) { return { x: A.l + b.fx * A.w, y: A.t + b.fy * A.h, w: b.fw * A.w, h: b.fh * A.h }; }

function updateBullets(dt) {
  const p = F.p, later = [];
  for (const b of F.bullets) {
    b.t += dt;
    if (b.type === 'orb' || b.type === 'saw') {
      if (b.homing && b.t < b.homeTime) {
        const want = Math.atan2(p.y - b.y, p.x - b.x);
        let cur = Math.atan2(b.vy, b.vx);
        const d = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
        cur += clamp(d, -b.homing * dt, b.homing * dt);
        b.vx = Math.cos(cur) * b.spd; b.vy = Math.sin(cur) * b.spd;
      }
      if (b.ay) b.vy += b.ay * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.wave) { // sways sideways while it travels
        const w = b.wave, off = Math.sin(b.t * w.f + w.ph) * w.amp;
        if (w.axis === 'x') b.x = w.c0 + off; else b.y = w.c0 + off;
      }
      if (b.orbit) { // part of a moving funnel (tornado)
        const o = b.orbit, a = o.ph + o.w * b.t;
        b.x = o.cx0 + o.vx * b.t + Math.cos(a) * o.rad;
        b.y = o.cy + o.dy + Math.sin(a) * o.rad * 0.25;
      }
      if (b.side === 'b') b.y = A.b - b.r * 0.55;
      else if (b.side === 't') b.y = A.t + b.r * 0.55;
      else if (b.side === 'l') b.x = A.l + b.r * 0.55;
      else if (b.side === 'r') b.x = A.r - b.r * 0.55;
      if (b.bounce > 0) {
        if ((b.x < A.l + b.r && b.vx < 0) || (b.x > A.r - b.r && b.vx > 0)) { b.vx *= -1; b.bounce--; sfx.bounce(); }
        if ((b.y < A.t + b.r && b.vy < 0) || (b.y > A.b - b.r && b.vy > 0)) { b.vy *= -1; b.bounce--; sfx.bounce(); }
      }
      if (b.spin) b.a = (b.a || 0) + b.spin * dt;
      if (b.life && b.t > b.life) {
        b.dead = true; burst(b.x, b.y, b.col || '#fff', 4, 100);
        if (b.pop !== undefined) later.push(b); // bubbles / fireballs burst into a ring
      }
      if (b.x < -150 || b.x > W + 150 || b.y < -150 || b.y > H + 150) b.dead = true;
    } else if (b.type === 'bone') {
      b.pos += b.v * dt;
      const alongX = b.side === 'b' || b.side === 't';
      const lo = alongX ? A.l : A.t, hi = alongX ? A.r : A.b;
      if ((b.v > 0 && b.pos > hi + 40) || (b.v < 0 && b.pos + b.th < lo - 40)) b.dead = true;
    } else if (b.type === 'wall') {
      b.pos += b.v * dt;
      const lo = b.o === 'v' ? A.l : A.t, hi = b.o === 'v' ? A.r : A.b;
      if ((b.v > 0 && b.pos > hi + 40) || (b.v < 0 && b.pos + b.th < lo - 40)) b.dead = true;
    } else if (b.type === 'laser') {
      if (b.follow) { b.x = F.boss.x + b.ox; b.y = F.boss.y + b.oy; }
      if (b.track && b.t < b.track) b.ang = Math.atan2(p.y - b.y, p.x - b.x);
      if (b.t > b.warn) {
        b.ang += b.rot * dt;
        if (!b.fired) { b.fired = true; if (!b.silent) sfx.laser(); else sfx.zap(); F.shake = Math.max(F.shake, 3); }
      }
      if (b.t > b.warn + b.active) b.dead = true;
    } else if (b.type === 'zone') {
      if (b.t > b.warn && !b.fired) { b.fired = true; sfx.zap(); }
      if (b.t > b.warn + b.active) b.dead = true;
    }
  }
  F.bullets = F.bullets.filter(b => !b.dead);
  for (const b of later) { ringOf(b.x, b.y, b.popN || 8, 150 * F.S, b.pop, 6); sfx.pop(); }
}

function collide() {
  const p = F.p, ph = 8 * F.M.size;
  if (p.inv > 0 || p.dashT > 0) return;
  const px = p.x - ph + 2, py = p.y - ph + 2, pw = ph * 2 - 4;
  // touching the boss hurts (unless it is up in the air)
  const b = F.boss;
  if (b.lift < 25 && Math.hypot(clamp(b.x, p.x - ph, p.x + ph) - b.x, clamp(b.y, p.y - ph, p.y + ph) - b.y) < F.bossR) { hurt(); return; }
  for (const o of F.bullets) {
    if (o.type === 'orb' || o.type === 'saw') {
      const cx = clamp(o.x, p.x - ph, p.x + ph), cy = clamp(o.y, p.y - ph, p.y + ph);
      if (Math.hypot(o.x - cx, o.y - cy) < o.r * (o.type === 'saw' ? 0.85 : 0.8)) { hurt(); if (o.type === 'orb') o.dead = true; return; }
    } else if (o.type === 'bone') {
      const r = boneRect(o);
      if (overlap(px, py, pw, pw, r.x, r.y, r.w, r.h)) { hurt(); return; }
    } else if (o.type === 'wall') {
      for (const r of wallRects(o)) if (r.w > 0 && r.h > 0 && overlap(px, py, pw, pw, r.x, r.y, r.w, r.h)) { hurt(); return; }
    } else if (o.type === 'laser') {
      if (o.t > o.warn && o.t < o.warn + o.active) {
        const [x1, y1, x2, y2] = laserSeg(o);
        if (segDist(p.x, p.y, x1, y1, x2, y2) < o.w / 2 + ph * 0.7) { hurt(); return; }
      }
    } else if (o.type === 'zone') {
      if (o.t > o.warn) {
        const r = zoneRect(o);
        if (overlap(px, py, pw, pw, r.x + 4, r.y + 4, r.w - 8, r.h - 8)) { hurt(); return; }
      }
    }
  }
}

// ---------------------------------------------------------------- main update + menus
function update(dt) {
  gT += dt;
  if (mtap('mute')) audio.muted = !audio.muted;
  // menu theme on the menu screens, once the browser lets us play audio
  const menuish = state === 'title' || state === 'map' || state === 'settings' || state === 'movie' || state === 'chapters';
  if (menuish && audio.ac && (!music.on || music.def !== menuMusic())) music.start(menuMusic());
  switch (state) {
    case 'chapters': updateChapters(); break;
    case 'title': updateTitle(); break;
    case 'settings': updateSettings(); break;
    case 'map': updateMap(dt); break;
    case 'movie': updateMovie(dt); break;
    case 'fight': updateFight(dt); break;
    case 'pause':
      if (mtap('ok') || tap('pause') || mtap('back')) { state = 'fight'; if (F.stage === 'fight' || F.stage === 'ready') music.start(F.def.music); }
      else if (mtap('quit')) { state = 'map'; music.stop(); }
      break;
    case 'dead':
      F.deadT += dt;
      if (F.deadT > 0.55 && !F.shattered) {
        F.shattered = true;
        sfx.shatter();
        for (let i = 0; i < 7; i++) fx({ kind: 'shard', x: F.p.x, y: F.p.y, vx: rand(-160, 160), vy: rand(-320, -80), col: SOULS[F.soul].col, sz: rand(3, 5), life: 1.6 });
      }
      if (F.deadT - dt <= 1.2 && F.deadT > 1.2) sfx.gameOver();
      updateFx(dt);
      if (F.deadT > 1.4) {
        if (mtap('ok')) { sfx.confirm(); startFight(F.idx, false, true); }
        else if (mtap('back') || mtap('quit')) state = 'map';
      }
      break;
    case 'results':
      F.resT += dt;
      updateFx(dt);
      if (F.resT > 0.8 && mtap('ok')) {
        sfx.confirm();
        sel = Math.min(F.idx + 1, save.unlocked - 1);
        if (F.idx === 4) playMovie(CH === 1 ? ENDING_MOVIE2 : ENDING_MOVIE, () => { state = 'map'; });
        else if (CH === 1) playMovie(FRIEND_MOVIES[F.idx], () => { state = 'map'; });
        else state = 'map';
      }
      break;
  }
}

// ---------------------------------------------------------------- chapters
const CHAPTERS = [
  { name: 'THE SQUARE SEA', blurb: 'Free four rulers infected by the Null virus.' },
  { name: 'THE QUOLY LANDS', blurb: 'Befriend four shamans, then face the Dice King.' },
];
let chapSel = 0;
function setChapter(ch) {
  persist();          // file away the chapter we are leaving
  CH = ch;
  loadProgress(ch);
  BOSSES = ch === 1 ? BOSSES2 : BOSSES1;
  ISLANDS = ch === 1 ? LANDS2 : ISLANDS1;
  sel = 0; selRow = 0; titleSel = 0;
  persist();
}
const chapterProgress = ch => { const o = ch === CH ? save : save.chapters[ch] || {}; return Object.keys(o.best || {}).length; };
function updateChapters() {
  if (mtap('left') || mtap('right') || mtap('up') || mtap('down')) { chapSel ^= 1; sfx.select(); }
  if (mtap('ok')) { sfx.confirm(); setChapter(chapSel); state = 'title'; music.stop(); }
}
function menuMusic() { return state !== 'chapters' && CH === 1 ? MENU_MUSIC2 : MENU_MUSIC; }
// the background behind a fight: the boss's island (chapter 1) or land (chapter 2)
function drawLandScene(i, t, dark, freed) {
  if (CH === 1 && !(F && F.def.tutor)) drawQuolyScene(i, t, dark);
  else drawIslandScene(i, t, dark, freed);
}

const TITLE_MENU = ['PLAY', 'STORY', 'TUTORIAL', 'SETTINGS'];
function goToMap() { state = 'map'; sel = Math.min(sel, save.unlocked - 1); }
function updateTitle() {
  if (mtap('back')) { state = 'chapters'; sfx.select(); return; }
  if (mtap('up')) { titleSel = (titleSel + 3) % 4; sfx.select(); }
  if (mtap('down')) { titleSel = (titleSel + 1) % 4; sfx.select(); }
  if (!mtap('ok')) return;
  sfx.confirm();
  const pick = TITLE_MENU[titleSel];
  if (pick === 'PLAY') {
    // first time: the story video, then the tutorial, then the map
    const afterStory = () => { if (!save.didTutorial) startFight(0, true); else goToMap(); };
    if (!save.seenIntro) { save.seenIntro = true; persist(); playMovie(CH === 1 ? INTRO_MOVIE2 : INTRO_MOVIE, afterStory); }
    else afterStory();
  } else if (pick === 'STORY') playMovie(CH === 1 ? INTRO_MOVIE2 : INTRO_MOVIE, () => { state = 'title'; });
  else if (pick === 'TUTORIAL') startFight(0, true);
  else { state = 'settings'; setSel = 0; setCol = 0; }
}

function updateSettings() {
  if (rebind) return;
  if (confirmReset) { // "are you sure?" box
    if (mtap('ok')) { resetProgress(); confirmReset = false; resetDone = 2; sfx.shatter(); }
    else if (mtap('back')) { confirmReset = false; sfx.select(); }
    return;
  }
  const n = ACTIONS.length, rows = n + 5; // actions, MUSIC, SOUND EFFECTS, RESET KEYS, RESET PROGRESS, BACK
  if (mtap('up')) { setSel = (setSel + rows - 1) % rows; sfx.select(); }
  if (mtap('down')) { setSel = (setSel + 1) % rows; sfx.select(); }
  const d = mtap('right') ? 1 : mtap('left') ? -1 : 0;
  if (d && setSel < n) { setCol ^= 1; sfx.select(); }
  if (d && (setSel === n || setSel === n + 1)) { // volume sliders, 0..10
    const k = setSel === n ? 'musicVol' : 'sfxVol';
    save[k] = clamp(save[k] + d, 0, 10);
    audio.setVolumes(); persist(); sfx.select();
  }
  if (mtap('back')) { state = 'title'; return; }
  if (mtap('ok')) {
    if (setSel < n) { rebind = { a: ACTIONS[setSel][0], slot: setCol }; sfx.select(); }
    else if (setSel === n + 2) { resetKeys(); sfx.confirm(); }
    else if (setSel === n + 3) { confirmReset = true; sfx.warn(); }
    else if (setSel === n + 4) { state = 'title'; sfx.confirm(); }
  }
}


// ---------------------------------------------------------------- the islands of the Square Sea
const ISLANDS1 = [
  { name: 'BLOCK ISLE',    x: 200, y: 450, sky: ['#ffd98a', '#ff9a52'], sea: '#2f7fb8', ground: '#5cbf4a', ground2: '#3f8f32', sand: '#f2d38a' },
  { name: 'SPIRAL ISLE',   x: 225, y: 190, sky: ['#c7a4ff', '#6a3fc4'], sea: '#3a4fa8', ground: '#8f5ad6', ground2: '#5e3496', sand: '#dcc2ff' },
  { name: 'RUST REEF',     x: 735, y: 190, sky: ['#ffb08a', '#a8402a'], sea: '#2c5a78', ground: '#8a4a2c', ground2: '#5c2c18', sand: '#c98a5a' },
  { name: 'CLOCKWORK CAY', x: 760, y: 450, sky: ['#b8ecff', '#3f8fc4'], sea: '#246a9a', ground: '#4fb8a8', ground2: '#2f7f74', sand: '#efe0b0' },
  { name: 'THE CORE',      x: 480, y: 320, sky: ['#000', '#000'],       sea: '#06060c', ground: '#1c1c22', ground2: '#08080a', sand: '#2a2a33' },
];
let ISLANDS = ISLANDS1;
const islandFreed = i => !!save.best[i];

function gear(c, x, y, r, a, col) {
  c.save(); c.translate(x, y); c.rotate(a);
  c.beginPath();
  for (let i = 0; i < 16; i++) {
    const rr = i % 2 ? r : r * 1.25, a0 = (i / 16) * TAU, a1 = ((i + 1) / 16) * TAU;
    c.arc(0, 0, rr, a0, a1);
  }
  c.closePath(); fs(c, col, 2.5);
  oval(c, 0, 0, r * 0.35, r * 0.35); fs(c, '#222', 2);
  c.restore();
}

// one island, drawn around (x, y). `freed` = the Null has been driven out of it.
function drawIsland(c, i, x, y, s, freed, t) {
  const isl = ISLANDS1[i];
  c.save(); c.translate(x, y); c.scale(s, s);
  c.lineJoin = 'round'; c.lineCap = 'round';
  oval(c, 0, 14, 116, 30); c.fillStyle = 'rgba(0,0,0,.25)'; c.fill();
  oval(c, 0, 7 + Math.sin(t * 2 + i) * 1.5, 110, 29); c.fillStyle = 'rgba(255,255,255,.55)'; c.fill();
  oval(c, 0, 0, 100, 27); fs(c, isl.sand, 3);
  oval(c, 0, -6, 84, 21); fs(c, isl.ground, 3);
  oval(c, -20, -10, 40, 9); c.fillStyle = isl.ground2; c.fill();

  if (i === 0) { // Block Isle: block hills and a castle with a crown on top
    for (const [bx, by, w, h] of [[-78, -30, 26, 24], [-56, -40, 30, 34], [-30, -24, 22, 18], [52, -26, 24, 20]]) {
      rrect(c, bx, by, w, h, 3); fs(c, '#6fd65a', 2.5);
      c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(bx + 3, by + 3, w * 0.4, 4);
    }
    c.fillStyle = '#c9c2b4'; c.strokeStyle = '#111'; c.lineWidth = 2.5;
    rrect(c, -6, -70, 50, 50, 2); fs(c, '#d8d0c0', 2.5);
    for (const tx of [-12, 34]) { rrect(c, tx, -86, 18, 66, 2); fs(c, '#cfc6b4', 2.5); }
    rrect(c, 12, -42, 14, 22, 6); fs(c, '#5a3a20', 2);
    c.beginPath(); c.moveTo(4, -100); c.lineTo(4, -86); c.lineTo(26, -86); c.lineTo(26, -100); c.lineTo(20, -92); c.lineTo(15, -102); c.lineTo(10, -92); c.closePath();
    fs(c, '#ffd23f', 2);
  } else if (i === 1) { // Spiral Isle: lollipop trees with swirls, and crystals
    for (const [tx, h, r] of [[-56, 56, 20], [-14, 44, 15], [46, 62, 22]]) {
      c.beginPath(); c.moveTo(tx, -14); c.lineTo(tx, -14 - h); c.lineWidth = 5; c.strokeStyle = '#3a1c5a'; c.stroke();
      oval(c, tx, -14 - h, r, r); fs(c, '#c58bff', 2.5);
      c.beginPath();
      for (let a = 0; a < 12; a += 0.3) c.lineTo(tx + Math.cos(a + t) * a * r / 13, -14 - h + Math.sin(a + t) * a * r / 13);
      c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.stroke();
    }
    for (const [cx, ch] of [[18, 26], [70, 18], [-80, 16]]) {
      c.beginPath(); c.moveTo(cx - 7, -12); c.lineTo(cx, -12 - ch); c.lineTo(cx + 7, -12); c.closePath(); fs(c, '#7ff6ff', 2);
    }
  } else if (i === 2) { // Rust Reef: half-buried gears, a crane and a big saw
    gear(c, -50, -22, 18, t * 0.5, '#b0642e');
    gear(c, -20, -16, 11, -t * 0.8, '#c97a3c');
    c.beginPath(); c.moveTo(30, -14); c.lineTo(30, -96); c.lineTo(80, -96); c.lineWidth = 6; c.strokeStyle = '#3a1e10'; c.stroke();
    c.beginPath(); c.moveTo(30, -60); c.lineTo(55, -96); c.lineWidth = 3; c.stroke();
    c.beginPath(); c.moveTo(78, -96); c.lineTo(78, -66); c.lineWidth = 2; c.strokeStyle = '#222'; c.stroke();
    sawShape(c, 78, -54, 13, t * 3, 10);
    for (const [bx, by] of [[-74, -12], [62, -10]]) { rrect(c, bx - 10, by - 3, 20, 6, 3); fs(c, '#efe8d2', 2); }
  } else if (i === 3) { // Clockwork Cay: a clock tower and gears
    rrect(c, -22, -92, 44, 80, 3); fs(c, '#e6d6a8', 2.5);
    c.beginPath(); c.moveTo(-28, -92); c.lineTo(0, -124); c.lineTo(28, -92); c.closePath(); fs(c, '#2f7f74', 2.5);
    oval(c, 0, -66, 15, 15); fs(c, '#fff6dc', 2.5);
    c.lineWidth = 2.5; c.strokeStyle = '#111';
    c.beginPath(); c.moveTo(0, -66); c.lineTo(Math.cos(t * 2) * 11, -66 + Math.sin(t * 2) * 11); c.stroke();
    c.beginPath(); c.moveTo(0, -66); c.lineTo(Math.cos(t * 0.3) * 7, -66 + Math.sin(t * 0.3) * 7); c.stroke();
    rrect(c, -7, -34, 14, 22, 6); fs(c, '#5a3a20', 2);
    gear(c, -62, -20, 14, t, '#d9a521');
    gear(c, 58, -18, 11, -t * 1.3, '#d9a521');
  } else { // The Core: the Null's black spire, or a calm monument once it is gone
    if (!freed) {
      for (const [sx, sh] of [[-60, 40], [-30, 70], [30, 64], [62, 36], [0, 100]]) {
        c.beginPath(); c.moveTo(sx - 12, -10); c.lineTo(sx + rand(-1, 1), -10 - sh); c.lineTo(sx + 12, -10); c.closePath();
        c.fillStyle = '#050505'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#ff2a6d'; c.stroke();
      }
      c.save(); c.translate(0, -132 + Math.sin(t * 2) * 5); c.rotate(t * 0.6);
      c.fillStyle = '#000'; c.fillRect(-16, -16, 32, 32); c.lineWidth = 2; c.strokeStyle = '#fff'; c.strokeRect(-16, -16, 32, 32);
      oval(c, 0, 0, 9, 5); c.fillStyle = '#fff'; c.fill(); oval(c, 0, 0, 3, 4); c.fillStyle = '#ff2a2a'; c.fill();
      c.restore();
    } else {
      rrect(c, -16, -66, 32, 54, 3); fs(c, '#f4f4f4', 2.5);
      rrect(c, -9, -59, 18, 18, 2); fs(c, '#ff2424', 2);
      c.beginPath(); c.moveTo(16, -66); c.lineTo(16, -104); c.lineWidth = 3; c.strokeStyle = '#111'; c.stroke();
      c.beginPath(); c.moveTo(16, -104); c.lineTo(40 + Math.sin(t * 4) * 3, -96); c.lineTo(16, -88); c.closePath(); fs(c, '#ffd23f', 2);
    }
  }
  c.restore();
  // the Null's infection: a dark haze and glitching pixels over the island
  if (!freed && i < 4) {
    c.save();
    c.globalAlpha = 0.45;
    oval(c, x, y - 30 * s, 110 * s, 70 * s); c.fillStyle = '#1a0026'; c.fill();
    c.globalAlpha = 0.9;
    for (let k = 0; k < 8; k++) {
      const a = t * 0.7 + k * 0.8, px = x + Math.cos(a * 1.3 + k) * 80 * s, py = y - 40 * s + Math.sin(a + k * 2) * 40 * s;
      c.fillStyle = k % 3 ? '#000' : '#ff2a6d';
      c.fillRect(px, py, 5 * s, 5 * s);
    }
    c.restore();
  }
}

// full-screen version of an island, used behind the fights (made a little darker)
function drawIslandScene(i, t, dark = 0.35, freed = false) {
  const isl = ISLANDS1[i];
  if (i === 4) { // the Null fights in the void: pure black with faint static
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    for (let k = 0; k < 6; k++) ctx.fillRect(0, rand(0, H), W, rand(1, 3));
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  g.addColorStop(0, isl.sky[0]); g.addColorStop(1, isl.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  oval(ctx, 790, 120, 54, 54); ctx.fillStyle = 'rgba(255,250,220,.85)'; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (let k = 0; k < 4; k++) {
    const cx = ((t * (8 + k * 3) + k * 260) % (W + 300)) - 150, cy = 80 + k * 55;
    oval(ctx, cx, cy, 70, 18); ctx.fill(); oval(ctx, cx + 30, cy - 10, 40, 16); ctx.fill();
  }
  const sg = ctx.createLinearGradient(0, H * 0.5, 0, H);
  sg.addColorStop(0, isl.sea); sg.addColorStop(1, '#0a1a2a');
  ctx.fillStyle = sg; ctx.fillRect(0, H * 0.5, W, H * 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2;
  for (let k = 0; k < 8; k++) {
    const wy = H * 0.53 + k * 26, off = (t * 30 + k * 70) % 80;
    ctx.beginPath();
    for (let x = -80 + off; x < W; x += 80) { ctx.moveTo(x, wy); ctx.quadraticCurveTo(x + 20, wy - 6, x + 40, wy); }
    ctx.stroke();
  }
  drawIsland(ctx, i, W / 2, H * 0.86, 3.6, freed, t);
  if (dark) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------- the world map
let mapAnim = null; // { from, to, t } while the boat sails
function updateMap(dt) {
  if (mapAnim) { mapAnim.t += dt / 0.7; if (mapAnim.t >= 1) mapAnim = null; return; }
  if (mtap('up')) { selRow = (selRow + 2) % 3; sfx.select(); }
  if (mtap('down')) { selRow = (selRow + 1) % 3; sfx.select(); }
  const d = mtap('right') ? 1 : mtap('left') ? -1 : 0;
  if (d) {
    if (selRow === 0) {
      const to = clamp(sel + d, 0, save.unlocked - 1);
      if (to !== sel) { mapAnim = { from: sel, to, t: 0 }; sel = to; sfx.whoosh(); }
      else audio.tone(120, 0.1, 'square', 0.05);
    } else if (selRow === 1) { save.mode = clamp(save.mode + d, 0, MODES.length - 1); persist(); sfx.select(); }
    else { save.hp = clamp(save.hp + d, 1, 15); persist(); sfx.select(); }
  }
  if (mtap('unlock')) { save.unlocked = 5; persist(); sfx.unlock(); }
  if (mtap('back')) { state = 'title'; return; }
  if (mtap('ok')) { sfx.confirm(); startFight(sel); }
}
function boatPos() {
  if (!mapAnim) return [ISLANDS[sel].x, ISLANDS[sel].y + 34];
  const a = ISLANDS[mapAnim.from], b = ISLANDS[mapAnim.to], k = ease(mapAnim.t);
  return [lerp(a.x, b.x, k), lerp(a.y + 34, b.y + 34, k) - Math.sin(k * Math.PI) * 30];
}
function drawBoat(x, y, col) {
  const bob = Math.sin(gT * 3) * 2;
  ctx.save(); ctx.translate(x, y + bob);
  ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.lineTo(12, 9); ctx.lineTo(-12, 9); ctx.closePath(); fs(ctx, '#8a5a2c', 2.5);
  ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(2, -30); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, -28); ctx.lineTo(18, -8); ctx.lineTo(4, -8); ctx.closePath(); fs(ctx, '#fff', 2);
  ctx.fillStyle = col; ctx.fillRect(-12, -12, 12, 12); ctx.strokeStyle = '#000'; ctx.strokeRect(-12, -12, 12, 12);
  ctx.restore();
}
function drawSea(t, dark = 0) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2f86c4'); g.addColorStop(1, '#174a78');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2;
  for (let k = 0; k < 16; k++) {
    const y = 20 + k * 45, off = (t * 20 + k * 37) % 120;
    ctx.beginPath();
    for (let x = -120 + off; x < W; x += 120) { ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 15, y - 5, x + 30, y); }
    ctx.stroke();
  }
  // the Null's dark stain spreading from the middle of the sea
  if (CH === 0 && !islandFreed(4)) {
    const r = ctx.createRadialGradient(480, 320, 20, 480, 320, 260);
    r.addColorStop(0, 'rgba(10,0,20,.75)'); r.addColorStop(1, 'rgba(10,0,20,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  }
  if (dark) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, W, H); }
}
function renderMap() {
  if (CH === 1) drawQuolyMap(); else drawSeaMap();
  drawMapPanel();
}
function drawQuolyMap() {
  drawQuolyMapBg(gT);
  text('THE QUOLY LANDS', W / 2, 36, 40, '#fff', 'center', true, 6);
  for (let i = 0; i < 4; i++) { // roads between the lands, in the order you visit them
    const a = LANDS2[i], b = LANDS2[i + 1], open = i + 1 < save.unlocked;
    ctx.save();
    ctx.setLineDash([10, 8]); ctx.lineDashOffset = -gT * 20;
    ctx.strokeStyle = open ? 'rgba(110,70,30,.9)' : 'rgba(110,70,30,.3)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 40); ctx.lineTo(b.x, b.y + 40); ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 5; i++) {
    const L = LANDS2[i], locked = i >= save.unlocked, friend = islandFreed(i), on = i === sel && !mapAnim;
    drawPlace2(ctx, i, L.x, L.y, i === 4 ? 0.95 : 0.8, gT);
    if (locked) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; oval(ctx, L.x, L.y - 30, 100, 70); ctx.fill();
      text('?', L.x, L.y - 36, 40, '#ccc', 'center', true, 4);
    } else {
      drawBossAt(BOSSES[i], { t: gT + i, phase: 0, flash: 0, mouth: 0, lx: 0, ly: 0.5 }, L.x - 64, L.y - 70, 0.2);
      if (friend) drawHeart(L.x + 52, L.y - 80, 12);
    }
    text(L.name, L.x, L.y + 62, on ? 18 : 15, on ? '#ffd23f' : locked ? '#777' : '#fff', 'center', false, 4);
    if (on) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; oval(ctx, L.x, L.y + 2, 96 + Math.sin(gT * 5) * 4, 28); ctx.stroke(); }
  }
  const [wx, wy] = boatPos();
  drawWalker(wx, wy + 6, '#ff2424');
  if (save.beatAll) text('★ FRIEND OF THE WHOLE KINGDOM ★', W / 2, 70, 16, '#ffd23f', 'center', true, 4);
}
function drawSeaMap() {
  drawSea(gT);
  text('THE SQUARE SEA', W / 2, 36, 40, '#fff', 'center', true, 6);
  // sea routes between the islands, in the order you free them
  for (let i = 0; i < 4; i++) {
    const a = ISLANDS[i], b = ISLANDS[i + 1], open = i + 1 < save.unlocked;
    ctx.save();
    ctx.setLineDash([8, 8]); ctx.lineDashOffset = -gT * 20;
    ctx.strokeStyle = open ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.2)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 34); ctx.lineTo(b.x, b.y + 34); ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 5; i++) {
    const isl = ISLANDS[i], locked = i >= save.unlocked, freed = islandFreed(i), on = i === sel && !mapAnim;
    drawIsland(ctx, i, isl.x, isl.y, i === 4 ? 0.95 : 0.8, freed, gT);
    if (locked) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; oval(ctx, isl.x, isl.y - 20, 100, 70); ctx.fill();
      text('?', isl.x, isl.y - 30, 40, '#888', 'center', true, 4);
    } else {
      // the ruler, waiting on its island (infected until you beat it)
      drawBossAt(BOSSES[i], { t: gT + i, phase: 0, flash: 0, mouth: 0, lx: 0, ly: 0.5, corrupt: !freed && i < 4 }, isl.x - 62, isl.y - 70, 0.2);
      if (freed && i < 4) text('✓', isl.x + 50, isl.y - 76, 22, '#7f7', 'center', false, 4);
    }
    text(isl.name, isl.x, isl.y + 62, on ? 18 : 15, on ? '#ffd23f' : locked ? '#777' : '#fff', 'center', false, 4);
    if (on) {
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
      oval(ctx, isl.x, isl.y + 2, 96 + Math.sin(gT * 5) * 4, 30); ctx.stroke();
    }
  }
  const [bx, by] = boatPos();
  drawBoat(bx, by, '#ff2424');
  if (save.beatAll) text('★ THE SQUARE SEA IS FREE ★', W / 2, 70, 16, '#ffd23f', 'center', true, 4);
}
// info + options under either map
function drawMapPanel() {
  rrect(ctx, 150, 540, 660, 172, 12); fs(ctx, 'rgba(0,0,0,.72)', 3, '#fff');
  const row = (r, y, h = 38) => { if (selRow === r) { rrect(ctx, 166, y - 18, 628, h, 8); fs(ctx, 'rgba(255,210,63,.12)', 2, '#ffd23f'); } };
  const d = BOSSES[sel], best = save.best[sel];
  row(0, 562, 46);
  text((sel > 0 ? '◀ ' : '   ') + ISLANDS[sel].name + '  ·  ' + d.name + (sel < save.unlocked - 1 ? ' ▶' : '   '), W / 2, 562, 19, '#fff', 'center', false, 3);
  const status = best ? (CH === 1 ? 'FRIEND' : 'FREED') + '  ·  best: ' + MEDALS[best.medal].name + ' on ' + MODES[best.mode || 0].name
    : (CH === 1 ? (sel === 4 ? 'the ruler of the kingdom' : 'not your friend yet') : sel === 4 ? 'the virus itself' : 'INFECTED by the Null') + '  ·  survive ' + Math.round(realDur(sel, save.mode)) + 's';
  text(status, W / 2, 582, 12, best ? MEDALS[best.medal].col : '#ff8aa8');
  const md = MODES[save.mode], di = diffInfo(save.hp);
  row(1, 618);
  text('MODE  ' + (save.mode > 0 ? '◀ ' : '   ') + md.name + (save.mode < MODES.length - 1 ? ' ▶' : '   '), W / 2, 618, 20, md.col, 'center', true, 4);
  row(2, 658);
  text('HITS  ' + (save.hp > 1 ? '◀ ' : '   ') + di.name + ' (' + save.hp + ')' + (save.hp < 15 ? ' ▶' : '   '), W / 2, 658, 20, di.col, 'center', true, 4);
  text('↑ ↓ row   ← → change / ' + (CH === 1 ? 'walk' : 'sail') + '   ENTER fight   ESC title   U unlock all', W / 2, 696, 13, '#ccc');
}

// ---------------------------------------------------------------- movies (story video, ending)
let MOV = null;
function playMovie(scenes, done) { MOV = { scenes, i: 0, t: 0, done }; state = 'movie'; }
function updateMovie(dt) {
  const m = MOV, sc = m.scenes[m.i];
  const prev = Math.floor(m.t * 40);
  m.t += dt;
  const n = Math.floor(m.t * 40);
  if (n > prev && n <= sc.text.length && n % 3 === 0) sfx.text();
  const next = () => { m.i++; m.t = 0; if (m.i >= m.scenes.length) { MOV = null; m.done(); } };
  if (mtap('back')) { MOV = null; m.done(); return; }
  if (mtap('ok')) { if (n < sc.text.length) m.t = sc.text.length / 40; else next(); }
  else if (m.t > sc.dur) next();
}
function renderMovie() {
  const m = MOV, sc = m.scenes[m.i];
  sc.draw(clamp(m.t / sc.dur, 0, 1), m.t);
  // letterbox + caption
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, 40); ctx.fillRect(0, H - 120, W, 120);
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  wrapText(sc.text.slice(0, Math.floor(m.t * 40)), W - 120).forEach((ln, i) => ctx.fillText(ln, W / 2, H - 88 + i * 28));
  text('ENTER next    ESC skip', W - 16, 22, 12, '#777', 'right');
  text((m.i + 1) + ' / ' + m.scenes.length, 16, 22, 12, '#777', 'left');
}
function wrapText(s, maxW) {
  const out = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out;
}
const kingState = (i, t, corrupt) => ({ t, phase: 0, flash: 0, mouth: 0, lx: 0, ly: 0.4, corrupt });
function mapScene(corruptUpTo, t, nullCol) {
  drawSea(t);
  for (let i = 0; i < 5; i++) {
    const isl = ISLANDS[i];
    drawIsland(ctx, i, isl.x, isl.y, i === 4 ? 0.95 : 0.8, i >= corruptUpTo && i !== 4, t);
    if (i < 4) drawBossAt(BOSSES[i], kingState(i, t + i, i < corruptUpTo), isl.x - 62, isl.y - 70, 0.2);
  }
  if (nullCol) { ctx.fillStyle = nullCol; ctx.fillRect(0, 0, W, H); }
}
const INTRO_MOVIE = [
  { dur: 6, text: 'Long ago, four rulers watched over the islands of the Square Sea.',
    draw: (k, t) => { mapScene(0, t); } },
  ...[0, 1, 2, 3].map(i => ({
    dur: 3.4,
    text: ['KING CUBERT ruled BLOCK ISLE, where everything is a perfect cube.', 'QUEEN VORTEX ruled SPIRAL ISLE, and kept its magic turning.',
      'KING SAWBONES ruled the RUST REEF, and built ships for the whole sea.', 'KING TICK-TOCK ruled CLOCKWORK CAY, and kept time for everyone.'][i],
    draw: (k, t) => { drawIslandScene(i, t, 0, true); drawBossAt(BOSSES[i], kingState(i, t, false), W / 2, 300 - k * 20, 1.1 + k * 0.1); },
  })),
  { dur: 5, text: 'Then, from the empty heart of the sea, something woke up.',
    draw: (k, t) => {
      mapScene(0, t);
      const r = ctx.createRadialGradient(480, 320, 5, 480, 320, 60 + k * 500);
      r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    } },
  { dur: 6, text: 'THE NULL. A virus that copies itself into everything it touches.',
    draw: (k, t) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#ff2a6d'; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) { // tendrils reaching for the four islands
        const isl = ISLANDS[i];
        ctx.beginPath(); ctx.moveTo(480, 330);
        for (let s = 1; s <= 12; s++) {
          const f = (s / 12) * k;
          ctx.lineTo(lerp(480, isl.x, f) + rand(-8, 8), lerp(330, isl.y, f) + rand(-8, 8));
        }
        ctx.stroke();
      }
      drawBossAt(BOSSES[4], { t, phase: Math.min(2, Math.floor(k * 3)), flash: 0, mouth: 0, lx: Math.sin(t), ly: 0 }, 480, 320, 1.2);
    } },
  { dur: 6, text: 'One by one, the rulers were infected. Their lands went dark.',
    draw: (k, t) => { mapScene(Math.min(4, Math.floor(k * 5)), t, 'rgba(10,0,20,' + (k * 0.3) + ')'); } },
  { dur: 5, text: 'Only one tiny shape was too simple for the virus to copy...',
    draw: (k, t) => {
      drawSea(t, 0.3);
      const x = lerp(120, 480, k);
      ctx.save(); ctx.translate(x, 360); ctx.scale(3, 3); ctx.translate(-x, -360);
      drawBoat(x, 360, '#ff2424');
      ctx.restore();
    } },
  { dur: 5, text: '...a SQUARE. Survive the infected rulers, drive out the virus, and free the Square Sea!',
    draw: (k, t) => {
      drawBG(BOSSES[0], t);
      const y = 300 + Math.abs(Math.sin(t * 4)) * -30;
      ctx.fillStyle = '#ff2424'; ctx.fillRect(W / 2 - 30, y - 30, 60, 60);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.strokeRect(W / 2 - 30, y - 30, 60, 60);
      text('SQUAREHEAD', W / 2, 150, 90 * Math.min(1, 0.5 + k), '#ffd23f', 'center', true, 10);
    } },
];
const ENDING_MOVIE = [
  { dur: 5, text: 'With the Null deleted, the dark stain faded from the Square Sea.',
    draw: (k, t) => { drawIslandScene(4, t); ctx.fillStyle = `rgba(255,255,255,${1 - k})`; ctx.fillRect(0, 0, W, H); } },
  { dur: 6, text: 'The four rulers sailed to the heart of the sea, free at last.',
    draw: (k, t) => {
      drawSea(t);
      for (let i = 0; i < 5; i++) drawIsland(ctx, i, ISLANDS[i].x, ISLANDS[i].y, i === 4 ? 0.95 : 0.8, true, t);
      for (let i = 0; i < 4; i++) {
        const isl = ISLANDS[i];
        drawBossAt(BOSSES[i], kingState(i, t + i, false), lerp(isl.x, 480 + (i - 1.5) * 70, k), lerp(isl.y - 70, 250, k), 0.25);
      }
    } },
  { dur: 6, text: '...and they crowned the little square that saved them all.',
    draw: (k, t) => {
      drawIslandScene(0, t, 0, true);
      for (let i = 0; i < 4; i++) drawBossAt(BOSSES[i], kingState(i, t + i, false), 150 + i * 220 - (i > 1 ? 0 : 0), 300, 0.55);
      const y = 420;
      ctx.fillStyle = '#ff2424'; ctx.fillRect(W / 2 - 24, y - 24, 48, 48);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(W / 2 - 24, y - 24, 48, 48);
      const cy = lerp(60, y - 40, Math.min(1, k * 1.4)); // the crown drops onto the square
      ctx.beginPath(); ctx.moveTo(W / 2 - 22, cy + 14); ctx.lineTo(W / 2 - 22, cy - 6); ctx.lineTo(W / 2 - 10, cy + 4); ctx.lineTo(W / 2, cy - 12);
      ctx.lineTo(W / 2 + 10, cy + 4); ctx.lineTo(W / 2 + 22, cy - 6); ctx.lineTo(W / 2 + 22, cy + 14); ctx.closePath(); fs(ctx, '#ffd23f', 3);
      for (let i = 0; i < 30; i++) { ctx.fillStyle = pick(['#ff2424', '#2a8cff', '#ffe600', '#7ff6ff', '#c45cff']); ctx.fillRect((i * 97 + t * 60) % W, (i * 53 + t * 140) % (H - 160) + 40, 6, 6); }
    } },
  { dur: 6, text: 'THE END.  Thanks for playing!  Now try it on a harder MODE...',
    draw: (k, t) => { drawBG(BOSSES[0], t); text('THE END', W / 2, 260, 100, '#ffd23f', 'center', true, 10); } },
];

// ---------------------------------------------------------------- tutorial
function drawSage(c, s) {
  const t = s.t;
  c.translate(0, Math.sin(t * 2) * 6);
  rrect(c, -60, -60, 120, 120, 18); fs(c, '#e8e2d0', 6);
  c.beginPath(); c.moveTo(-50, 10); c.quadraticCurveTo(0, 150 + Math.sin(t * 3) * 6, 50, 10); c.quadraticCurveTo(0, 40, -50, 10); fs(c, '#fff', 4);
  c.beginPath(); c.moveTo(-70, -58); c.lineTo(0, -120); c.lineTo(70, -58); c.closePath(); fs(c, '#3a5ab8', 5);
  oval(c, 22, -96, 6, 6); fs(c, '#ffe14d', 2);
  for (const side of [-1, 1]) { oval(c, side * 24, -14, 16, 14); fs(c, 'rgba(200,230,255,.6)', 4); }
  c.beginPath(); c.moveTo(-8, -14); c.lineTo(8, -14); c.lineWidth = 4; c.strokeStyle = '#111'; c.stroke();
  for (const side of [-1, 1]) { oval(c, side * 24 + s.lx * 4, -14 + s.ly * 3, 4, 4); c.fillStyle = '#111'; c.fill(); }
  if (s.mouth > 0) { oval(c, 0, 18, 9, 6); fs(c, '#600', 3); }
}
const TUTOR = {
  name: 'THE OLD SAGE', title: 'TEACHER OF SQUARES', r: 70, island: 0, tutor: true,
  bullet: '#9fe8d0', laser: '#ffffff', patterns: [],
  intro: ['An old square with a long beard floats over the waves.', "He doesn't look infected. Just very, very old."],
  music: MENU_MUSIC, draw: drawSage,
};
const moveKeys = () => ['up', 'left', 'down', 'right'].map(a => keyName(BIND[a][0])).join(' ');
const TUT_STEPS = [
  { say: ['Ah! A square! The only shape the Null virus could not copy.', 'The four rulers of the Square Sea are infected. They will attack anything that moves.',
    'You cannot fight them. Nobody can. But you can OUTLAST them.', "Survive until a ruler's timer runs out, and the virus will leave their body.", 'Let me teach you. First: move around.'],
    goal: () => 'Touch the 3 stars  (move: ' + moveKeys() + ')',
    start() { F.tut.n = 0; F.tut.star = tutStar(0); }, check: () => F.tut.n >= 3 },
  { say: ['Good! Now the most important trick: the DASH.', 'While you dash you are invincible. Nothing can touch you.'],
    goal: () => 'Dash 3 times  (' + keyList('dash') + ')',
    start() { F.dashes = 0; }, check: () => F.dashes >= 3 },
  { say: ['Some attacks cannot be outrun. A sweeping laser, for example.', 'Wait until it is right next to you, then DASH through it!'],
    goal: () => 'DASH through the laser  (' + keyList('dash') + ')', attack: ['laserSweep', null], noHits: true },
  { say: ['Now just dodge. Keep moving and look for the gaps.'],
    goal: () => 'Survive the rain', attack: ['rain', null] },
  { say: ['The rulers will also change what kind of square you are.', 'Watch closely...'],
    goal: () => 'BLUE SQUARE: jump over the bones  (' + keyList('jump') + ')', attack: ['boneFloor', 'blue'] },
  { say: ['Each ruler has its own squares. Read the name when you change!', "The bar at the top is the ruler's time. When it runs out, you win.",
    'Get hit less for a better medal: bronze, silver, gold... DIAMOND.', 'And between rounds, the rulers like to talk. Listen. They are not evil, only sick.',
    'Now sail to BLOCK ISLE, little square, and free King Cubert!'], last: true },
];
function tutStar(n) {
  const spots = [[A.l + 140, A.t + 120], [A.r - 140, A.t + 160], [A.l + 260, A.b - 100]];
  return { x: spots[n][0], y: spots[n][1] };
}
function tutorialNext() {
  const tu = F.tut;
  const s = TUT_STEPS[tu.step];
  if (s.last) {
    if (F.soul !== 'red') applySoul('red');
    startTalk(s.say.map(t => ['boss', t]), finishTutorial);
    return;
  }
  startTalk(s.say.map(t => ['boss', t]), () => { F.stage = 'fight'; tutorialStart(); });
}
function tutorialStart() {
  const tu = F.tut, s = TUT_STEPS[tu.step];
  tu.t = 0; tu.hits0 = tu.hits; tu.end = Infinity;
  if (s.start) s.start();
  if (s.attack) {
    playStep(s.attack[0], s.attack[1], 90000 + tu.step, d => { tu.end = F.wt + d + 0.3; });
  }
}
function updateTutorial(dt) {
  const tu = F.tut, s = TUT_STEPS[tu.step];
  tu.t += dt;
  if (tu.star && Math.hypot(F.p.x - tu.star.x, F.p.y - tu.star.y) < 26) {
    tu.n++; sfx.unlock(); burst(tu.star.x, tu.star.y, '#ffe14d', 16, 200);
    tu.star = tu.n < 3 ? tutStar(tu.n) : null;
  }
  const done = s.check ? s.check() : F.wt >= tu.end;
  if (!done) return;
  clearBullets();
  if (s.noHits && tu.hits > tu.hits0) { // got hit by the laser: try again
    startTalk([['boss', 'Ouch! Try again. DASH right as the laser reaches you.']], () => { F.stage = 'fight'; tutorialStart(); });
    return;
  }
  tu.step++;
  sfx.confirm();
  tutorialNext();
}
function finishTutorial() {
  save.didTutorial = true; persist();
  music.stop();
  state = 'map'; sel = 0;
}

// ================================================================ CHAPTER 2: THE QUOLY LANDS
// After freeing the Square Sea, the square sails off looking for adventure, lands in a giant
// kingdom and, without knowing it, steps on the Holy Grounds where the people believe their god
// lives. To be forgiven it has to befriend the Wind, Earth, Water and Fire shamans, in that
// order, and then face the Dice King, who rolls a die to pick each of his attacks.

// ---------------------------------------------------------------- chapter 2 squares
Object.assign(SOULS, {
  gust:  { name: 'GREEN SQUARE', desc: 'the wind pushes you around',  col: '#5fe08a', m: { wind: true } },
  stone: { name: 'STONE SQUARE', desc: 'heavy gravity, short jumps',  col: '#a39484', m: { grav: { x: 0, y: 1 }, gscale: 1.5, spd: 0.8 } },
  swim:  { name: 'WATER SQUARE', desc: 'floaty, JUMP again to swim up', col: '#4ab0ff', m: { grav: { x: 0, y: 1 }, gscale: 0.35, swim: true } },
  ember: { name: 'EMBER SQUARE', desc: "you can't stop moving!",      col: '#ff6a1a', m: { autorun: true } },
});

// ---------------------------------------------------------------- chapter 2 attacks
// walls of bone (or fire) sweeping across with a gap
function wallAttack(col, horizOK) {
  const n = Math.round(5 + 3 * F.D), iv = 0.85 / F.D;
  const v = Array.from({ length: n }, () => [sc(0.5) ? 1 : -1, horizOK && sc(0.4), R()]);
  const sp = (300 + 20 * F.idx) * F.S;
  rep(n, iv, i => {
    const [dir, horiz, frac] = v[i];
    if (!horiz) F.bullets.push({ type: 'wall', o: 'v', pos: dir > 0 ? A.l - 16 : A.r + 2, th: 14 * F.Z, v: dir * sp, gc: gapPos('v', frac), gh: 90, t: 0, col });
    else F.bullets.push({ type: 'wall', o: 'h', pos: dir > 0 ? A.t - 16 : A.b + 2, th: 14 * F.Z, v: dir * sp * 0.75, gc: gapPos('h', frac), gh: 96, t: 0, col });
    sfx.whoosh();
  });
  return n * iv + A.w / sp + 0.2;
}
Object.assign(ATK, {
  // wind: rows of leaves blown across the arena, swaying up and down
  gale() {
    const n = Math.round(10 + 5 * F.D), iv = 0.35 / F.D, dir = sc(0.5) ? 1 : -1, sp = 260 * F.S;
    const v = Array.from({ length: n }, () => [sr(A.t + 40, A.b - 40), sr(0, TAU)]);
    rep(n, iv, i => {
      const [y0, ph] = v[i];
      for (let k = 0; k < 3; k++) {
        orb(dir > 0 ? A.l - 10 - k * 26 : A.r + 10 + k * 26, y0, dir * sp, 0, { r: 7, col: '#c9f5d8', wave: { axis: 'y', c0: y0, amp: 45, f: 3, ph: ph + k * 0.6 } });
      }
      sfx.whoosh();
    });
    return n * iv + (A.w + 80) / sp;
  },
  // wind: spinning funnels that cross the arena
  tornado() {
    const n = 2 + (F.phase >= 1 ? 1 : 0) + (F.mode >= 3 ? 1 : 0), iv = 1.2 / F.S, sp = 150 * F.S;
    const v = Array.from({ length: n }, () => [sc(0.5) ? 1 : -1, sr(A.t + 140, A.b - 140), sr(0, TAU)]);
    rep(n, iv, i => {
      const [dir, cy, ph] = v[i], cx0 = dir > 0 ? A.l - 60 : A.r + 60, k = 12;
      for (let j = 0; j < k; j++) {
        orb(cx0, cy, 0, 0, { r: 8, col: '#e8fff4', life: (A.w + 160) / sp, orbit: { cx0, cy, vx: dir * sp, rad: 14 + j * 7, w: 5, ph: ph + j * 0.9, dy: (j - k / 2) * 15 } });
      }
      sfx.whoosh();
    });
    return n * iv + (A.w + 160) / sp;
  },
  // earth: boulders drop where their shadows are, then crack into pebbles
  rockfall() {
    const n = Math.round(8 + 4 * F.D), iv = 0.45 / F.D, warn = 0.9 / F.W;
    const v = Array.from({ length: n }, () => [sr(A.l + 40, A.r - 40), sr(A.t + 60, A.b - 40), sr(0, TAU)]);
    rep(n, iv, i => {
      const [x, y, off] = v[i];
      fx({ kind: 'shadow', x, y: y - 20, sz: 30 * F.Z, life: warn });
      at(warn, () => {
        orb(x, y, 0, 0, { r: 24, life: 0.35, col: '#8a6a4a' });
        ringOf(x, y, 8, 150 * F.S, off, 6);
        F.shake = Math.max(F.shake, 5); sfx.land();
      });
    });
    return n * iv + warn + 2.2;
  },
  // earth: stone pillars burst out of the ground in alternating columns
  pillars() {
    const waves = Math.round(3 + F.D), iv = 1.0 / F.S, cols = 8;
    const holes = Array.from({ length: waves }, () => sri(0, cols - 1));
    rep(waves, iv, i => {
      for (let c = 0; c < cols; c++) {
        if ((c + i) % 2 || (F.phase >= 1 && c === holes[i])) continue;
        F.bullets.push({ type: 'zone', fx: c / cols, fy: 0, fw: 1 / cols, fh: 1, warn: 0.85 / F.W, active: 0.45, t: 0, col: '#a07a52' });
      }
      sfx.charge();
    });
    return waves * iv + 1.4;
  },
  // water: rows of droplets roll down the screen, rippling side to side, with a gap
  waves() {
    const n = Math.round(5 + 2 * F.D), iv = 0.9 / F.S, k = 14, sp = 160 * F.S;
    const v = Array.from({ length: n }, () => [sri(0, k - 3), sr(0, TAU)]);
    rep(n, iv, i => {
      const [gap, ph] = v[i];
      for (let j = 0; j < k; j++) {
        if (j >= gap && j < gap + 3) continue;
        const x0 = A.l + ((j + 0.5) * A.w) / k;
        orb(x0, A.t - 10, 0, sp, { r: 9, col: '#6ec3ff', wave: { axis: 'x', c0: x0, amp: 30, f: 2.2, ph } });
      }
      sfx.whoosh();
    });
    return n * iv + (A.h + 20) / sp;
  },
  // water: big slow bubbles rise up and pop into rings
  bubbles() {
    const n = Math.round(6 + 3 * F.D), iv = 0.5 / F.D;
    const v = Array.from({ length: n }, () => [sr(A.l + 40, A.r - 40), sr(1.4, 2.6), sr(0, TAU)]);
    rep(n, iv, i => {
      const [x, life, off] = v[i];
      orb(x, A.b + 10, 0, -150 * F.S, { r: 16, col: '#a8e4ff', life, pop: off, popN: 8 });
      sfx.drop();
    });
    return n * iv + 3.4;
  },
  // fire: lobbed fireballs land near you and burst into embers
  fireballs() {
    const n = Math.round(6 + 3 * F.D), iv = 0.55 / F.S, T = 1.3 / F.W;
    const v = Array.from({ length: n }, () => [sr(-1, 1), sr(-1, 1), sr(0, TAU)]);
    rep(n, iv, i => {
      const b = F.boss, [dx, dy, off] = v[i];
      const tx = clamp(F.p.x + dx * 110, A.l + 30, A.r - 30), ty = clamp(F.p.y + dy * 80, A.t + 40, A.b - 30);
      const vy0 = -380, g = (2 * (ty - b.y - vy0 * T)) / (T * T);
      orb(b.x, b.y, (tx - b.x) / T, vy0, { r: 12, col: '#ff7a2a', ay: g, life: T, pop: off, popN: 10 });
      b.mouth = 0.3; sfx.fire();
    });
    return n * iv + T + 2.2;
  },
  // fire: burning walls with a gap
  flamewall() { return wallAttack('#ff8a2a', true); },
});

// ---------------------------------------------------------------- chapter 2 boss art
function drawWind(c, s) {
  const t = s.t, ph = s.phase;
  c.translate(0, Math.sin(t * 2.2) * 8);
  c.lineWidth = 6; c.strokeStyle = 'rgba(220,255,240,.75)';
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    for (let a = 0; a < 5; a += 0.2) { const r = 70 + a * 12 + i * 10, q = a + t * (2 + i) + i * 2; c.lineTo(Math.cos(q) * r, Math.sin(q) * r * 0.45 + 20); }
    c.stroke();
  }
  c.beginPath(); c.moveTo(0, -40);
  c.quadraticCurveTo(-72, 40, -62 + Math.sin(t * 4) * 7, 92); c.lineTo(62 + Math.sin(t * 4 + 1) * 7, 92);
  c.quadraticCurveTo(72, 40, 0, -40);
  fs(c, ['#7fe0a8', '#5fcf90', '#3fb070'][ph], 5);
  rrect(c, -40, 20, 80, 12, 5); fs(c, '#f2d060', 3);
  for (let k = -2; k <= 2; k++) { // feather headdress
    c.save(); c.translate(k * 14, -86); c.rotate(k * 0.3 + Math.sin(t * 5 + k) * 0.08);
    oval(c, 0, -24, 8, 26); fs(c, ['#fff', '#9fe8c0', '#f2d060'][Math.abs(k) % 3], 3);
    c.restore();
  }
  oval(c, 0, -50, 40, 42); fs(c, '#f2e6c8', 5);
  oval(c, 0, -46, 32, 33); fs(c, '#a0703a', 4); // wooden mask
  c.lineWidth = 3; c.strokeStyle = '#3a2410';
  c.beginPath(); c.moveTo(-26, -30); c.lineTo(26, -30); c.stroke();
  eyes(c, s, 0, -54, 10, 12, 14, ph >= 2);
  if (s.mouth > 0) { oval(c, 0, -26, 8, 6); fs(c, '#3a1a0a', 2); }
}
function drawEarth(c, s) {
  const t = s.t, ph = s.phase;
  c.translate(0, Math.abs(Math.sin(t * 2)) * -5);
  // staff with a glowing crystal
  c.beginPath(); c.moveTo(92, 100); c.lineTo(92, -70); c.lineWidth = 9; c.strokeStyle = '#5a3a20'; c.stroke();
  c.beginPath(); c.moveTo(92, -112); c.lineTo(80, -84); c.lineTo(92, -66); c.lineTo(104, -84); c.closePath(); fs(c, '#ffc84a', 3);
  for (const side of [-1, 1]) { oval(c, side * 82, 30, 26, 22); fs(c, '#8a6a4a', 5); }
  const pts = [[0, -88], [48, -74], [80, -30], [78, 30], [52, 78], [0, 92], [-52, 80], [-80, 30], [-78, -32], [-46, -76]];
  c.beginPath(); pts.forEach(([x, y]) => c.lineTo(x, y)); c.closePath();
  fs(c, ['#a08060', '#8f6a4a', '#7a4a3a'][ph], 6);
  for (const [mx, my, mw] of [[-30, -78, 22], [20, -82, 26], [56, -60, 14]]) { oval(c, mx, my, mw, 9); c.fillStyle = '#5fae4a'; c.fill(); }
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.35)';
  c.beginPath(); c.moveTo(-60, 10); c.lineTo(-40, 30); c.lineTo(-48, 52); c.stroke();
  eyes(c, s, 0, -16, 16, 18, 30, ph >= 1);
  c.beginPath(); c.moveTo(-30, 30); c.lineTo(30, 30); c.lineTo(24, s.mouth > 0 ? 52 : 40); c.lineTo(-24, s.mouth > 0 ? 52 : 40); c.closePath(); fs(c, '#3a2410', 3);
  c.fillStyle = '#e8e0cc'; for (let i = -2; i <= 2; i++) c.fillRect(i * 11 - 4, 30, 8, 7);
}
function drawWater(c, s) {
  const t = s.t, ph = s.phase;
  c.translate(0, Math.sin(t * 1.8) * 10);
  c.beginPath(); c.moveTo(0, -100);
  c.bezierCurveTo(30, -60, 76, -20, 74, 26); c.arc(0, 26, 74, 0, Math.PI); c.bezierCurveTo(-76, -20, -30, -60, 0, -100);
  fs(c, ['#4ab0ff', '#2a8ae0', '#1f5fc0'][ph], 6);
  oval(c, -30, -10, 10, 22); c.fillStyle = 'rgba(255,255,255,.4)'; c.fill();
  c.lineWidth = 5; c.strokeStyle = '#bfe8ff';
  for (const side of [-1, 1]) { // wave hair
    c.beginPath();
    for (let k = 0; k < 3; k++) c.arc(side * (40 + k * 16), -40 + k * 18 + Math.sin(t * 3 + k) * 3, 10, side > 0 ? Math.PI : 0, side > 0 ? 0 : Math.PI, side < 0);
    c.stroke();
  }
  eyes(c, s, 0, 0, 15, 19, 26, ph >= 2);
  if (s.mouth > 0) { oval(c, 0, 40, 12, 9); fs(c, '#0a2a5a', 3); }
  else { c.beginPath(); c.arc(0, 32, 14, 0.2, Math.PI - 0.2); c.lineWidth = 4; c.strokeStyle = '#0a2a5a'; c.stroke(); }
  for (let i = -3; i <= 3; i++) { oval(c, i * 15, 72 - Math.abs(i) * 4, 6, 5); fs(c, '#ffd0e0', 2); }
}
function drawFire(c, s) {
  const t = s.t, ph = s.phase;
  c.translate(0, Math.sin(t * 6) * 3);
  const flame = (r, col, lw) => {
    c.beginPath();
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI / 2 + (i / 20) * TAU, up = Math.max(0, -Math.sin(a));
      const rr = r * (1 + up * (0.6 + (i % 2 ? 0 : 0.35 + Math.sin(t * 10 + i) * 0.15)));
      c.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * rr + 10);
    }
    c.closePath(); fs(c, col, lw);
  };
  flame(74, ['#ff8a2a', '#ff5a1a', '#ff2a1a'][ph], 6);
  flame(46, '#ffd23f', 0);
  for (const side of [-1, 1]) { // horns
    c.beginPath(); c.moveTo(side * 30, -40); c.quadraticCurveTo(side * 60, -70, side * 46, -104); c.quadraticCurveTo(side * 44, -70, side * 16, -50); c.closePath(); fs(c, '#2a1a1a', 3);
  }
  eyes(c, s, 0, 0, 14, 16, 26, ph >= 1, '#ff3a00');
  if (s.mouth > 0) { c.beginPath(); c.moveTo(-20, 32); c.lineTo(-8, 44); c.lineTo(0, 34); c.lineTo(8, 44); c.lineTo(20, 32); c.lineTo(0, 56); c.closePath(); fs(c, '#4a0a00', 3); }
  else { c.beginPath(); c.moveTo(-20, 34); c.lineTo(20, 34); c.lineWidth = 4; c.strokeStyle = '#4a0a00'; c.stroke(); }
}
function drawDie(c, x, y, size, face, rot) {
  c.save(); c.translate(x, y); c.rotate(rot);
  rrect(c, -size / 2, -size / 2, size, size, size * 0.18); fs(c, '#fff', Math.max(2, size * 0.06));
  const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[face] || [];
  c.fillStyle = face === 1 ? '#d02020' : '#111';
  for (const [px, py] of P) { oval(c, px * size * 0.27, py * size * 0.27, size * 0.09, size * 0.09); c.fill(); }
  c.restore();
}
function drawDiceKing(c, s) {
  const t = s.t, ph = s.phase;
  c.translate(0, Math.sin(t * 2) * 5);
  c.beginPath(); c.moveTo(-58, 0); c.lineTo(-92, 112); c.lineTo(92, 112); c.lineTo(58, 0); c.closePath(); fs(c, ['#b8202a', '#a01020', '#7a0a20'][ph], 6);
  rrect(c, -70, -6, 140, 26, 12); fs(c, '#fff', 4);
  c.fillStyle = '#111'; for (let i = -3; i <= 3; i++) c.fillRect(i * 18 - 2, 4, 4, 6);
  // scepter topped with a spinning die
  c.beginPath(); c.moveTo(98, 100); c.lineTo(98, -40); c.lineWidth = 7; c.strokeStyle = '#d9a521'; c.stroke();
  drawDie(c, 98, -58, 30, 1 + Math.floor(t * 3) % 6, t * 2);
  // the head is a giant die
  c.beginPath(); c.moveTo(-60, -66); c.lineTo(-40, -86); c.lineTo(80, -86); c.lineTo(60, -66); c.closePath(); fs(c, '#e6e6e6', 5);
  c.beginPath(); c.moveTo(60, -66); c.lineTo(80, -86); c.lineTo(80, 24); c.lineTo(60, 44); c.closePath(); fs(c, '#cfcfcf', 5);
  rrect(c, -60, -66, 120, 110, 10); fs(c, '#fff', 5);
  // its top face shows the last number it rolled
  c.save(); c.translate(10, -76); c.transform(1, 0, -1, 0.33, 0, 0);
  const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[s.face || 6];
  c.fillStyle = '#c62828';
  for (const [px, py] of P) { oval(c, px * 30, py * 18, 6, 6); c.fill(); }
  c.restore();
  eyes(c, s, 0, -26, 14, 17, 26, ph >= 1);
  c.beginPath(); // mustache
  c.moveTo(0, 2); c.bezierCurveTo(-14, -6, -32, 2, -36, 14); c.bezierCurveTo(-22, 8, -12, 12, 0, 8);
  c.bezierCurveTo(12, 12, 22, 8, 36, 14); c.bezierCurveTo(32, 2, 14, -6, 0, 2);
  fs(c, '#4a2c12', 2);
  if (s.mouth > 0) { oval(c, 0, 24, 10, 7); fs(c, '#600', 3); }
  c.beginPath(); // crown
  c.moveTo(-40, -86); c.lineTo(-44, -124); c.lineTo(-20, -102); c.lineTo(0, -132); c.lineTo(20, -102); c.lineTo(44, -124); c.lineTo(40, -86); c.closePath();
  fs(c, '#ffd23f', 4);
  for (const gx of [-44, 0, 44]) { oval(c, gx, gx ? -124 : -132, 5, 5); fs(c, '#2a8cff', 2); }
}

// ---------------------------------------------------------------- chapter 2 music
const MUSIC2 = [
  { root: 69.3, bpm: 150, bass: [0, _, 7, _, 12, _, 7, _, 5, _, 12, _, 17, _, 12, _, 3, _, 10, _, 15, _, 10, _, 5, _, 12, _, 7, _, _, _],
    lead: [24, _, 26, 28, _, 31, _, 28, 26, _, 24, _, 21, _, _, _, 24, _, 26, 28, _, 33, _, 31, 28, _, 26, _, 24, _, _, _],
    leadWave: 'sine', leadVol: 0.045, leadLen: 0.18, bassWave: 'triangle', bassVol: 0.06,
    drums: { k: 'k.......k.......', s: '....s.......s...', h: '..h...h...h...h.' } },
  { root: 49, bpm: 118, bass: [0, 0, _, _, 0, _, _, _, 3, 3, _, _, 5, _, _, _, 0, 0, _, _, 0, _, 7, _, 6, _, 5, _, 3, _, _, _],
    lead: [12, _, _, _, 15, _, 12, _, 10, _, _, _, 7, _, _, _, 12, _, _, _, 15, _, 17, _, 18, _, 17, _, 15, _, _, _],
    leadWave: 'square', leadVol: 0.022, leadLen: 0.25, bassWave: 'sawtooth', bassVol: 0.04, bassLen: 0.2,
    drums: { k: 'k..k..k.k.......', s: '....s.......s...', h: '................' } },
  { root: 65.41, bpm: 140, bass: [0, _, _, 7, _, _, 12, _, 5, _, _, 12, _, _, 17, _, 3, _, _, 10, _, _, 15, _, 7, _, _, 14, _, _, 19, _],
    lead: [24, 28, 31, 36, 31, 28, 24, 28, 29, 33, 36, 41, 36, 33, 29, 33, 27, 31, 34, 39, 34, 31, 27, 31, 31, 35, 38, 43, 38, 35, 31, 35],
    leadWave: 'triangle', leadVol: 0.03, leadLen: 0.09, bassWave: 'triangle', bassVol: 0.07,
    drums: { k: 'k.......k.......', s: '........s.......', h: 'h.h.h.h.h.h.h.h.' } },
  { root: 58.27, bpm: 185, bass: [0, 0, 12, 0, 0, 12, 0, 10, 0, 0, 12, 0, 13, 12, 10, 7, 0, 0, 12, 0, 0, 12, 0, 10, 5, 5, 3, 3, 2, 2, 1, 1],
    lead: [12, _, 15, _, 17, _, 18, 17, 15, _, 12, _, 10, 12, _, _, 12, _, 15, _, 17, _, 20, _, 22, _, 20, 18, 17, _, 15, _],
    leadWave: 'sawtooth', leadVol: 0.02, leadLen: 0.1, bassWave: 'sawtooth', bassVol: 0.025,
    drums: { k: 'k.k...k.k.k...k.', s: '....s.......s..s', h: 'h.h.h.h.h.h.h.h.' } },
  { root: 61.74, bpm: 168, bass: [0, _, 7, _, 0, _, 7, _, 5, _, 12, _, 5, _, 12, _, 3, _, 10, _, 3, _, 10, _, 7, _, 14, _, 7, 9, 11, 12],
    lead: [24, _, 24, 26, 28, _, 24, _, 29, _, 28, _, 26, _, _, _, 27, _, 27, 29, 31, _, 27, _, 33, _, 31, _, 29, 28, 26, _],
    leadWave: 'square', leadVol: 0.025, leadLen: 0.12,
    drums: { k: 'k...k...k...k...', s: '....s.......s...', h: '..hh..hh..hh..hh' } },
];
const MENU_MUSIC2 = {
  root: 73.42, bpm: 104, bassWave: 'triangle', bassVol: 0.07, bassLen: 0.22,
  bass: [0, _, _, _, 5, _, _, _, 7, _, _, _, 5, _, _, _, 3, _, _, _, 5, _, _, _, 7, _, _, _, 0, _, _, _],
  lead: [12, _, 14, _, 16, _, 19, _, 17, _, 16, _, 14, _, _, _, 15, _, 17, _, 19, _, 21, _, 19, _, 17, _, 16, _, _, _],
  leadWave: 'sine', leadVol: 0.04, leadLen: 0.24,
  drums: { k: 'k.......k.......', s: '................', h: '....h.......h...' },
};

// ---------------------------------------------------------------- chapter 2 bosses
const BOSSES2 = [
  {
    name: 'ZEPHYRA', title: 'SHAMAN OF WIND', r: 76, island: 0,
    bullet: '#c9f5d8', laser: '#e8fff4', bg: ['#2a5a6a', '#0c2028'], ray: '#bfffe0',
    intro: ['A gust of wind knocks you off your feet.', 'ZEPHYRA, SHAMAN OF WIND, floats down from the peaks.', '"You walked on the Holy Grounds. The wind does not forgive so easily."'],
    talk: [[
      "Hmph. You're quick on your feet, for a trespasser.",
      "The wind whispers that you didn't know about the Holy Grounds...",
      "But the wind also LIES sometimes. Let's see what you're made of!",
    ], [
      'Still standing? The storm is only getting started!',
      "...You're not like the thieves who came before. You don't even fight back.",
      "Fine. Survive THIS, and I'll listen.",
    ]],
    freed: [
      '*pant* ...Alright. Alright! You win, little square.',
      'A thief would have run. A villain would have fought. You just... endured.',
      "I believe you didn't mean to anger the King. I'll be your friend!",
      "But the others won't be so easy. Go to STONE HOLLOW. Granitus is... stubborn.",
    ],
    souls: ['gust', 'red', 'yellow', 'blueUp'],
    patterns: [
      [['gale', 'gust'], ['aimed', 'red'], ['tornado', 'gust'], ['crossfire', 'yellow']],
      [['tornado', 'gust'], ['gale', 'yellow'], ['homing', 'red'], ['boneFloor', 'blueUp'], ['gale+aimed', 'gust']],
      [['tornado+gale', 'gust'], ['laserSweep', 'yellow'], ['spiral', 'gust'], ['closingRing', 'red'], ['tornado', 'blueUp']],
    ],
    music: MUSIC2[0], draw: drawWind,
  },
  {
    name: 'GRANITUS', title: 'SHAMAN OF EARTH', r: 80, island: 1,
    bullet: '#c9a27a', laser: '#ffc84a', bg: ['#5a3a20', '#1a0e06'], ray: '#ffcf8a',
    intro: ['The ground rumbles. Rocks roll down the canyon walls.', 'GRANITUS, SHAMAN OF EARTH, rises out of the stone.', '"Zephyra likes you? Zephyra likes EVERYONE."'],
    talk: [[
      'The Holy Grounds are older than this mountain. Older than ME!',
      'For a thousand years, no foot has touched them.',
      'Then YOU came along. With your... square little feet.',
    ], [
      "You are like a pebble in my shoe. Small, but you don't go away.",
      'Hrmm. Rocks are patient. Maybe squares are too.',
      "ONE MORE QUAKE! If you're still here, we talk.",
    ]],
    freed: [
      '...Hrmm. You did not crack.',
      'A rock respects anything that does not crack.',
      "Very well, little pebble. I am your friend now. Don't tell Zephyra it was this quick.",
      'Marina waits at MIRROR LAKE. She sees the truth in her water.',
    ],
    souls: ['stone', 'red', 'orange', 'blue'],
    patterns: [
      [['rockfall', 'red'], ['pillars', 'stone'], ['boneFloor', 'stone'], ['slam', 'red']],
      [['pillars', 'orange'], ['rockfall', 'stone'], ['saws', 'stone'], ['slam', 'orange'], ['boneWall', 'blue']],
      [['rockfall+pillars', 'red'], ['slam', 'stone'], ['zones', 'orange'], ['charge', 'red'], ['rockfall', 'stone']],
    ],
    music: MUSIC2[1], draw: drawEarth,
  },
  {
    name: 'MARINA', title: 'SHAMAN OF WATER', r: 76, island: 2,
    bullet: '#6ec3ff', laser: '#bfe8ff', bg: ['#0c3a5a', '#02101c'], ray: '#7fd4e8',
    intro: ['The air turns cool and misty.', 'MARINA, SHAMAN OF WATER, rises out of the mirror-still lake.', '"I have seen your reflection, square. Now let me see what is under it."'],
    talk: [[
      'Water shows the truth. Your reflection is... surprisingly kind.',
      'But a reflection can be fooled. Bodies cannot.',
      "Swim with me, little square. Don't sink!",
    ], [
      'The lake says you came from far away. From the Square Sea.',
      'You freed four rulers there? And now you dodge my waves without a word...',
      'The tide is turning. Show me you can turn with it!',
    ]],
    freed: [
      '*splash* ...The water is calm again. So is my heart.',
      "You didn't know about the Holy Grounds. The lake has never lied to me.",
      "Friends, then! I'll tell the King what I saw.",
      "But Ignis, the Fire Shaman, is the King's oldest friend. He will be the hardest. Be brave.",
    ],
    souls: ['swim', 'cyan', 'red', 'purple'],
    patterns: [
      [['waves', 'red'], ['bubbles', 'swim'], ['spiral', 'cyan'], ['waves', 'swim']],
      [['bubbles', 'swim'], ['waves', 'cyan'], ['closingRing', 'red'], ['homing', 'purple'], ['bubbles+waves', 'swim']],
      [['waves', 'purple'], ['bubbles', 'swim'], ['spiral+bubbles', 'cyan'], ['laserGrid', 'red'], ['waves+crossfire', 'swim']],
    ],
    music: MUSIC2[2], draw: drawWater,
  },
  {
    name: 'IGNIS', title: 'SHAMAN OF FIRE', r: 78, island: 3,
    bullet: '#ff7a2a', laser: '#ffb04a', bg: ['#5a1008', '#1a0402'], ray: '#ff8a4a',
    intro: ['The heat hits you like a wall.', 'IGNIS, SHAMAN OF FIRE, steps out of the burning crater.', '"Three shamans call you friend? Then they have gone SOFT!"'],
    talk: [[
      'The King trusts me above everyone. I will not let a stranger trick him!',
      'The Holy Grounds are where our god lives! Do you understand what you did?!',
      'BURN, trespasser!',
    ], [
      "Why won't you burn?! Why won't you run?!",
      '...The others said you never once fought back. Not once.',
      "Is that courage? Or are you just stubborn? LET'S FIND OUT!",
    ]],
    freed: [
      "...My fire has gone out. And I don't even feel angry anymore.",
      'You could have run away a hundred times. You stayed. You listened.',
      'I was wrong about you, square. Even fire can admit that. I am your friend.',
      "Now go to the HOLY GROUNDS. The Dice King is waiting. I'll be right behind you.",
    ],
    souls: ['ember', 'red', 'fast', 'yellow'],
    patterns: [
      [['fireballs', 'red'], ['flamewall', 'ember'], ['rain', 'red'], ['fireballs', 'ember']],
      [['flamewall', 'ember'], ['fireballs', 'fast'], ['laserSweep', 'red'], ['ringBurst', 'ember'], ['charge', 'yellow']],
      [['fireballs+rain', 'ember'], ['flamewall', 'fast'], ['clockHands', 'red'], ['fireballs', 'ember'], ['flamewall+aimed', 'yellow']],
    ],
    music: MUSIC2[3], draw: drawFire,
  },
  {
    name: 'THE DICE KING', title: 'RULER OF THE QUOLY LANDS', r: 84, island: 4,
    bullet: '#ffd23f', laser: '#ffe680', bg: ['#3a1a5a', '#120620'], ray: '#ffd23f',
    intro: ['Golden light pours over the Holy Grounds.', 'THE DICE KING rises from his throne, a giant die in his hand.', '"So. All four shamans call you friend. Let FATE decide if I will too!"'],
    talk: [[
      'Every choice in my kingdom is made by the dice. Every single one!',
      'The dice chose my shamans. The dice chose my crown. The dice chose... my lunch.',
      'And now the dice will choose your doom! ROLL!',
    ], [
      'Hmm! You keep surviving. The dice are... confused!',
      '...Do you know why no one may step on the Holy Grounds?',
      'Because we were afraid. Afraid to disturb a god we have never seen. ROLL AGAIN!',
    ]],
    freed: [
      '...Six. I rolled a six. The luckiest number in the whole kingdom.',
      'You walked onto the Holy Grounds and nothing bad happened. No thunder. No angry god.',
      'Maybe the god WANTED a visitor. Maybe it was lonely... like me.',
      'Little square, from today you are a friend of the King, and of all the Quoly Lands!',
    ],
    souls: ['gust', 'stone', 'swim', 'ember', 'red', 'purple', 'fast'],
    // the die picks the attack: [face 1..6] for each phase
    dice: [
      [['gale', 'gust'], ['rockfall', 'stone'], ['waves', 'swim'], ['fireballs', 'ember'], ['aimed', 'red'], ['spiral', 'red']],
      [['tornado', 'gust'], ['pillars', 'stone'], ['bubbles', 'swim'], ['flamewall', 'ember'], ['laserGrid', 'red'], ['slam', 'purple']],
      [['tornado+gale', 'gust'], ['rockfall+pillars', 'stone'], ['bubbles+waves', 'swim'], ['fireballs+rain', 'ember'], ['zones+aimed', 'purple'], ['clockHands', 'fast']],
    ],
    music: MUSIC2[4], draw: drawDiceKing,
  },
];

// ---------------------------------------------------------------- the Dice King's roll
const DICE_T = 1.3;
function startDice(st) {
  F.dice = { t: 0, roll: st.roll, atk: st.atk, shown: 1 };
  F.boss.mouth = DICE_T;
  sfx.castStart();
}
function updateDice(dt) {
  const d = F.dice;
  if (!d) return;
  const before = d.t;
  d.t += dt;
  if (d.t < 0.9) {
    if (Math.floor(d.t * 14) !== Math.floor(before * 14)) { d.shown = 1 + Math.floor(Math.random() * 6); audio.tone(rand(500, 900), 0.03, 'square', 0.04); }
  } else if (before < 0.9) {
    d.shown = d.roll; F.lastRoll = d.roll;
    sfx.land(); audio.tone(880, 0.15, 'square', 0.06); F.shake = 6;
  }
  if (d.t > DICE_T + 1.2) F.dice = null;
}
function drawDiceRoll() {
  const d = F.dice, b = F.boss;
  const k = Math.min(1, d.t / 0.9), x = b.x + (1 - k) * 160 * Math.sin(d.t * 7), y = Math.max(A.t + 70, b.y - F.bossR * 2.7) - Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 40;
  drawDie(ctx, x, y, 54, d.shown, d.t < 0.9 ? d.t * 14 : 0);
  if (d.t >= 0.9) {
    const name = d.atk.split('+').map(a => a.toUpperCase()).join(' + ');
    text('ROLLED ' + d.roll + ':  ' + name, x, y - 44, 18, '#ffe14d', 'center', true, 5);
  }
}

// ---------------------------------------------------------------- the lands of the kingdom
const LANDS2 = [
  { name: 'WHISPERING PEAKS', x: 175, y: 180, sky: ['#9fdcff', '#eafaff'], ground: '#8fc8a0', far: '#9ab4c8' },
  { name: 'STONE HOLLOW',     x: 185, y: 450, sky: ['#ffcf8a', '#e8955a'], ground: '#c98a5a', far: '#b06a40' },
  { name: 'MIRROR LAKE',      x: 775, y: 450, sky: ['#7fd4e8', '#2f7f9a'], ground: '#5fae6a', far: '#3f7f8a' },
  { name: 'EMBER CRATER',     x: 780, y: 180, sky: ['#5a1a10', '#c8401a'], ground: '#4a3030', far: '#2a1010' },
  { name: 'THE HOLY GROUNDS', x: 480, y: 310, sky: ['#3a1a5a', '#e0aa4a'], ground: '#e8d8a8', far: '#7a5aa0' },
];
function drawPlace2(c, i, x, y, s, t) {
  const L = LANDS2[i];
  c.save(); c.translate(x, y); c.scale(s, s);
  c.lineJoin = 'round'; c.lineCap = 'round';
  oval(c, 0, 8, 104, 26); c.fillStyle = 'rgba(0,0,0,.2)'; c.fill();
  oval(c, 0, 0, 98, 24); fs(c, L.ground, 3);
  if (i === 0) { // mountains with snow, a windmill and prayer flags
    for (const [mx, mh, mw] of [[-46, 90, 44], [10, 116, 52], [58, 72, 38]]) {
      c.beginPath(); c.moveTo(mx - mw, 0); c.lineTo(mx, -mh); c.lineTo(mx + mw, 0); c.closePath(); fs(c, '#8a9aa8', 3);
      c.beginPath(); c.moveTo(mx - mw * 0.3, -mh * 0.7); c.lineTo(mx, -mh); c.lineTo(mx + mw * 0.3, -mh * 0.7); c.lineTo(mx + mw * 0.1, -mh * 0.62); c.lineTo(mx - mw * 0.1, -mh * 0.72); c.closePath(); fs(c, '#fff', 2);
    }
    c.beginPath(); c.moveTo(-82, -4); c.lineTo(-82, -40); c.lineWidth = 4; c.strokeStyle = '#5a3a20'; c.stroke();
    for (let k = 0; k < 4; k++) { const a = t * 3 + (k * Math.PI) / 2; c.beginPath(); c.moveTo(-82, -40); c.lineTo(-82 + Math.cos(a) * 18, -40 + Math.sin(a) * 18); c.lineWidth = 4; c.strokeStyle = '#fff'; c.stroke(); }
    c.beginPath(); c.moveTo(-46, -90); c.quadraticCurveTo(-18, -70, 10, -116); c.lineWidth = 1.5; c.strokeStyle = '#333'; c.stroke();
    ['#e23', '#ffd23f', '#2a8cff', '#5fe08a'].forEach((col, k) => { c.fillStyle = col; c.fillRect(-40 + k * 12, -86 - k * 5 + Math.sin(t * 6 + k) * 2, 7, 9); });
  } else if (i === 1) { // canyon mesas, stone pillars and a crystal
    for (const [mx, mw, mh] of [[-50, 60, 50], [34, 70, 70]]) {
      rrect(c, mx - mw / 2, -mh, mw, mh, 4); fs(c, '#b06a40', 3);
      c.fillStyle = 'rgba(255,220,180,.35)'; for (let k = 1; k < 4; k++) c.fillRect(mx - mw / 2 + 2, -mh + k * (mh / 4), mw - 4, 3);
    }
    for (const px of [-86, 80]) { rrect(c, px - 6, -40, 12, 40, 3); fs(c, '#9a8a78', 2.5); }
    c.beginPath(); c.moveTo(0, -4); c.lineTo(-9, -24); c.lineTo(0, -46); c.lineTo(9, -24); c.closePath(); fs(c, '#ffc84a', 2.5);
  } else if (i === 2) { // a lake fed by a waterfall, with lily pads
    rrect(c, 40, -70, 46, 70, 6); fs(c, '#6a8a7a', 3);
    c.fillStyle = 'rgba(190,235,255,.9)'; c.fillRect(48, -66, 14, 62);
    oval(c, -10, -4, 70, 16); fs(c, '#3a9adf', 3);
    c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 2;
    for (let k = 0; k < 3; k++) { oval(c, -10, -4, 20 + ((t * 15 + k * 18) % 55), 4 + ((t * 15 + k * 18) % 55) / 5); c.stroke(); }
    for (const [lx, ly] of [[-50, -6], [-24, 2], [14, -8]]) { oval(c, lx, ly, 8, 3); c.fillStyle = '#4faf4a'; c.fill(); }
  } else if (i === 3) { // a volcano with a lava top and smoke
    c.beginPath(); c.moveTo(-84, 0); c.lineTo(-24, -96); c.lineTo(24, -96); c.lineTo(84, 0); c.closePath(); fs(c, '#3a2a2a', 3);
    c.beginPath(); c.moveTo(-24, -96); c.quadraticCurveTo(0, -84, 24, -96); c.lineTo(10, -60); c.lineTo(4, -20); c.lineTo(-4, -60); c.closePath(); fs(c, '#ff6a1a', 2);
    for (let k = 0; k < 3; k++) { const q = (t * 0.6 + k / 3) % 1; oval(c, Math.sin(k + t) * 8, -104 - q * 60, 10 + q * 14, 8 + q * 10); c.fillStyle = `rgba(120,110,110,${0.6 * (1 - q)})`; c.fill(); }
  } else { // the King's palace and the glowing ring of the Holy Grounds
    rrect(c, -56, -70, 112, 66, 3); fs(c, '#f2d78a', 3);
    for (const tx of [-66, 50]) { rrect(c, tx, -96, 16, 92, 2); fs(c, '#e8c870', 3); drawDie(c, tx + 8, -104, 16, 5, 0.2); }
    rrect(c, -14, -36, 28, 32, 12); fs(c, '#7a3a1a', 2);
    drawDie(c, 0, -86, 22, 6, Math.sin(t) * 0.2);
    c.save(); c.globalAlpha = 0.5 + Math.sin(t * 3) * 0.2;
    oval(c, 0, 10, 60, 10); c.lineWidth = 4; c.strokeStyle = '#fff6a0'; c.stroke();
    c.restore();
  }
  c.restore();
}
// full-screen land behind the fights (darkened)
function drawQuolyScene(i, t, dark = 0.35) {
  const L = LANDS2[i];
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.65);
  g.addColorStop(0, L.sky[0]); g.addColorStop(1, L.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = L.far; // distant hills
  ctx.beginPath(); ctx.moveTo(0, H * 0.62);
  for (let x = 0; x <= W; x += 60) ctx.lineTo(x, H * 0.62 - 40 - Math.sin(x * 0.013 + i) * 40 - Math.sin(x * 0.031) * 18);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = L.ground; ctx.fillRect(0, H * 0.7, W, H * 0.3);
  drawPlace2(ctx, i, W / 2, H * 0.9, 3.3, t);
  // a little weather for each land
  if (i === 0) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; for (let k = 0; k < 14; k++) { const x = ((t * 500 + k * 173) % (W + 200)) - 100, y = 60 + ((k * 97) % 420); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y); ctx.stroke(); } }
  if (i === 3) { for (let k = 0; k < 24; k++) { ctx.fillStyle = k % 2 ? '#ffb04a' : '#ff5a1a'; ctx.fillRect((k * 131 + Math.sin(t + k) * 30) % W, H - ((t * 60 + k * 53) % H), 3, 3); } }
  if (i === 4) { ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff6a0'; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(140 + k * 170, 0); ctx.lineTo(200 + k * 170, 0); ctx.lineTo(260 + k * 170 + Math.sin(t + k) * 30, H); ctx.lineTo(120 + k * 170, H); ctx.fill(); } ctx.restore(); }
  if (dark) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, W, H); }
}
// a tiny citizen of the kingdom (they come in all shapes)
function drawCitizen(x, y, shape, col, t) {
  const by = y + Math.abs(Math.sin(t * 6 + x)) * -6;
  ctx.save(); ctx.translate(x, by);
  ctx.beginPath();
  if (shape === 0) ctx.arc(0, 0, 14, 0, TAU);
  else if (shape === 1) { ctx.moveTo(0, -16); ctx.lineTo(15, 12); ctx.lineTo(-15, 12); ctx.closePath(); }
  else { ctx.moveTo(0, -15); ctx.lineTo(13, 0); ctx.lineTo(0, 15); ctx.lineTo(-13, 0); ctx.closePath(); }
  fs(ctx, col, 3);
  for (const ex of [-5, 5]) { ctx.fillStyle = '#fff'; ctx.fillRect(ex - 2, -4, 4, 5); ctx.fillStyle = '#111'; ctx.fillRect(ex - 1, -2, 2, 3); }
  ctx.restore();
}
function drawWalker(x, y, col) {
  const step = Math.sin(gT * 10);
  ctx.save(); ctx.translate(x, y - Math.abs(step) * 3);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(-6 + step * 3, 14); ctx.moveTo(4, 6); ctx.lineTo(6 - step * 3, 14); ctx.stroke();
  ctx.fillStyle = col; ctx.fillRect(-9, -12, 18, 18); ctx.strokeRect(-9, -12, 18, 18);
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(-6, -9, 6, 4);
  ctx.restore();
}
function drawQuolyMapBg(t) {
  ctx.fillStyle = '#2f86c4'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#d9c890'; // the big continent
  ctx.beginPath();
  for (let a = 0; a <= TAU + 0.01; a += 0.1) {
    const r = 1 + Math.sin(a * 3) * 0.05 + Math.sin(a * 7 + 1) * 0.03;
    ctx.lineTo(480 + Math.cos(a) * 455 * r, 330 + Math.sin(a) * 300 * r);
  }
  ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#8a7a50'; ctx.stroke();
  ctx.fillStyle = 'rgba(110,170,80,.55)';
  for (const [gx, gy, gr] of [[320, 230, 120], [640, 260, 110], [480, 470, 150], [300, 420, 80]]) { oval(ctx, gx, gy, gr, gr * 0.6); ctx.fill(); }
  ctx.strokeStyle = '#4a9adf'; ctx.lineWidth = 6; // a river
  ctx.beginPath(); ctx.moveTo(775, 470); ctx.bezierCurveTo(700, 560, 600, 520, 560, 640); ctx.stroke();
  for (let k = 0; k < 26; k++) { const tx = 90 + ((k * 337) % 780), ty = 90 + ((k * 211) % 470); oval(ctx, tx, ty, 7, 7); ctx.fillStyle = '#3f8f3a'; ctx.fill(); }
}

// ---------------------------------------------------------------- chapter 2 videos
const quolyMapScene = (t, friendsUpTo = 0) => {
  drawQuolyMapBg(t);
  for (let i = 0; i < 5; i++) {
    const L = LANDS2[i];
    drawPlace2(ctx, i, L.x, L.y, i === 4 ? 0.95 : 0.8, t);
    drawBossAt(BOSSES2[i], kingState(i, t + i, false), L.x - 64, L.y - 70, 0.2);
    if (i < friendsUpTo) drawHeart(L.x + 52, L.y - 80, 12);
  }
};
function drawHeart(x, y, s) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.moveTo(0, s * 0.9);
  ctx.bezierCurveTo(-s * 1.6, -s * 0.2, -s * 0.6, -s * 1.3, 0, -s * 0.4);
  ctx.bezierCurveTo(s * 0.6, -s * 1.3, s * 1.6, -s * 0.2, 0, s * 0.9);
  fs(ctx, '#ff4a7a', 2.5);
  ctx.restore();
}
const INTRO_MOVIE2 = [
  { dur: 5, text: 'After freeing the Square Sea, the little square had peace and quiet.',
    draw: (k, t) => { drawSea(t); for (let i = 0; i < 5; i++) drawIsland(ctx, i, ISLANDS1[i].x, ISLANDS1[i].y, 0.8, true, t); drawBoat(480, 420, '#ff2424'); } },
  { dur: 5, text: '...It was VERY bored. It wanted more adventure!',
    draw: (k, t) => { drawSea(t, 0.2); ctx.save(); ctx.translate(480, 380); ctx.scale(3, 3); drawBoat(0, 0, '#ff2424'); ctx.restore(); text('?', 540, 250, 60, '#fff', 'center', true, 6); } },
  { dur: 5, text: 'So it sailed past the edge of every map it knew...',
    draw: (k, t) => { drawSea(t, 0.35 + k * 0.3); ctx.save(); ctx.translate(lerp(100, 860, k), 380); ctx.scale(2, 2); drawBoat(0, 0, '#ff2424'); ctx.restore(); } },
  { dur: 6, text: '...until a giant land rose out of the fog: the QUOLY LANDS, a mighty kingdom.',
    draw: (k, t) => { ctx.save(); ctx.globalAlpha = 1; drawQuolyMapBg(t); ctx.restore(); ctx.fillStyle = `rgba(220,230,240,${0.9 - k * 0.9})`; ctx.fillRect(0, 0, W, H); } },
  { dur: 6, text: 'Its people lived by one sacred rule...',
    draw: (k, t) => { drawQuolyScene(4, t, 0.1); for (let i = 0; i < 9; i++) drawCitizen(120 + i * 90, 520, i % 3, ['#ffcf4a', '#7fd4e8', '#ff8aa8', '#9fe8a0'][i % 4], t); } },
  { dur: 7, text: 'NOBODY may ever step on the HOLY GROUNDS. The people believe that is where their god lives.',
    draw: (k, t) => {
      drawQuolyScene(4, t, 0.25);
      ctx.save(); ctx.globalAlpha = 0.6 + Math.sin(t * 3) * 0.2; oval(ctx, W / 2, 470, 220, 50); ctx.lineWidth = 8; ctx.strokeStyle = '#fff6a0'; ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff6a0'; ctx.beginPath(); ctx.moveTo(W / 2 - 60, 0); ctx.lineTo(W / 2 + 60, 0); ctx.lineTo(W / 2 + 220, 470); ctx.lineTo(W / 2 - 220, 470); ctx.fill(); ctx.restore();
    } },
  { dur: 6, text: 'The square knew nothing about that. It just went exploring...',
    draw: (k, t) => { drawQuolyScene(4, t, 0.2); ctx.save(); ctx.globalAlpha = 0.5; oval(ctx, W / 2, 470, 220, 50); ctx.lineWidth = 8; ctx.strokeStyle = '#fff6a0'; ctx.stroke(); ctx.restore(); drawWalker(lerp(60, W / 2 - 230, k), 480, '#ff2424'); } },
  { dur: 5, text: '...and walked right onto the Holy Grounds.',
    draw: (k, t) => {
      drawQuolyScene(4, t, 0.2);
      oval(ctx, W / 2, 470, 220, 50); ctx.lineWidth = 8; ctx.strokeStyle = '#fff6a0'; ctx.stroke();
      drawWalker(lerp(W / 2 - 230, W / 2, Math.min(1, k * 1.6)), 480, '#ff2424');
      if (k > 0.65) { ctx.fillStyle = `rgba(255,0,0,${0.3 + Math.sin(t * 20) * 0.2})`; ctx.fillRect(0, 0, W, H); if (Math.random() < 0.1) sfx.warn(); }
    } },
  { dur: 6, text: '"BLASPHEMY! A STRANGER ON THE HOLY GROUNDS!" roared the DICE KING.',
    draw: (k, t) => { drawQuolyScene(4, t, 0.3); drawBossAt(BOSSES2[4], { t, phase: 2, flash: 0, mouth: Math.sin(t * 12) > 0 ? 1 : 0, lx: 0, ly: 0.5, face: 1 + Math.floor(t * 4) % 6 }, W / 2, 280, 1.2 + k * 0.2); } },
  { dur: 7, text: '"WIND! EARTH! WATER! FIRE! My shamans will judge this trespasser!"',
    draw: (k, t) => { drawQuolyMapBg(t); for (let i = 0; i < 4; i++) { const f = Math.min(1, Math.max(0, k * 5 - i)); drawBossAt(BOSSES2[i], kingState(i, t + i, false), 150 + i * 220, 320, 0.6 * f); } } },
  { dur: 7, text: 'To be forgiven, the square must face every shaman, in order, and win their friendship.',
    draw: (k, t) => { quolyMapScene(t); const L = LANDS2[0]; drawWalker(lerp(480, L.x, k), lerp(330, L.y + 40, k), '#ff2424'); } },
  { dur: 5, text: 'CHAPTER 2: THE QUOLY LANDS',
    draw: (k, t) => { drawBG(BOSSES2[4], t); drawDie(ctx, W / 2, 330, 90, 1 + Math.floor(t * 2) % 6, Math.sin(t) * 0.3); text('THE QUOLY LANDS', W / 2, 160, 74 * Math.min(1, 0.5 + k), '#ffd23f', 'center', true, 10); } },
];
// a short clip after each shaman becomes your friend
const FRIEND_MOVIES = [0, 1, 2, 3].map(i => [
  { dur: 5, text: ['ZEPHYRA', 'GRANITUS', 'MARINA', 'IGNIS'][i] + ' is now your friend! ' + ['"I will send a good wind to the King."', '"I will speak for you. Slowly. But I will."', '"The lake will remember your kindness."', '"I will walk beside you to the palace."'][i],
    draw: (k, t) => {
      drawQuolyScene(i, t, 0);
      drawBossAt(BOSSES2[i], kingState(i, t, false), 360, 330, 0.9);
      drawWalker(600, 420, '#ff2424');
      for (let h = 0; h < 6; h++) drawHeart(480 + Math.sin(t * 2 + h) * 120, 400 - ((t * 60 + h * 50) % 300), 10);
    } },
  { dur: 5, text: i < 3 ? 'Next stop: ' + LANDS2[i + 1].name + ', home of the ' + BOSSES2[i + 1].title + '.' : 'All four shamans are your friends. Now, the HOLY GROUNDS...',
    draw: (k, t) => {
      quolyMapScene(t, i + 1);
      const a = LANDS2[i], b = LANDS2[i + 1];
      drawWalker(lerp(a.x, b.x, k), lerp(a.y + 40, b.y + 40, k), '#ff2424');
    } },
]);
const ENDING_MOVIE2 = [
  { dur: 6, text: 'The Dice King rolled one last time... a SIX. The luckiest number in the kingdom.',
    draw: (k, t) => { drawQuolyScene(4, t, 0); drawBossAt(BOSSES2[4], { t, phase: 0, flash: 0, mouth: 0, lx: 0, ly: 0.5, face: 6 }, 330, 320, 0.9); drawDie(ctx, 620, lerp(120, 420, Math.min(1, k * 1.5)), 70, k > 0.6 ? 6 : 1 + Math.floor(t * 12) % 6, k > 0.6 ? 0 : t * 10); } },
  { dur: 6, text: 'The four shamans told him the truth: the square never meant any harm.',
    draw: (k, t) => { drawQuolyScene(4, t, 0); for (let i = 0; i < 4; i++) drawBossAt(BOSSES2[i], kingState(i, t + i, false), 140 + i * 225, 330, 0.55); } },
  { dur: 6, text: 'The whole kingdom came out to meet the little stranger.',
    draw: (k, t) => {
      drawQuolyScene(4, t, 0);
      for (let i = 0; i < 20; i++) drawCitizen(60 + i * 45, 470 + (i % 2) * 40, i % 3, ['#ffcf4a', '#7fd4e8', '#ff8aa8', '#9fe8a0', '#c8a0ff'][i % 5], t);
      drawWalker(W / 2, 360, '#ff2424');
    } },
  { dur: 7, text: 'Nobody ever saw a god on the Holy Grounds. But that day, everyone agreed: it must be smiling. It had sent them a friend.',
    draw: (k, t) => {
      drawQuolyScene(4, t, 0);
      ctx.save(); ctx.globalAlpha = 0.3 + k * 0.3; ctx.fillStyle = '#fff6a0'; ctx.beginPath(); ctx.moveTo(W / 2 - 50, 0); ctx.lineTo(W / 2 + 50, 0); ctx.lineTo(W / 2 + 160, 470); ctx.lineTo(W / 2 - 160, 470); ctx.fill(); ctx.restore();
      drawWalker(W / 2, 460, '#ff2424');
      for (let h = 0; h < 10; h++) drawHeart(W / 2 + Math.sin(t + h * 2) * 200, 460 - ((t * 50 + h * 40) % 400), 9);
    } },
  { dur: 6, text: 'The square is now a friend of the Dice King, and of the whole Quoly Lands!',
    draw: (k, t) => {
      drawQuolyScene(4, t, 0);
      for (let i = 0; i < 5; i++) drawBossAt(BOSSES2[i], kingState(i, t + i, false), 120 + i * 180, 300, i === 4 ? 0.7 : 0.5);
      drawWalker(W / 2, 470, '#ff2424');
      for (let i = 0; i < 30; i++) { ctx.fillStyle = pick(['#ff2424', '#2a8cff', '#ffe600', '#7ff6ff', '#c45cff']); ctx.fillRect((i * 97 + t * 60) % W, (i * 53 + t * 140) % (H - 160) + 40, 6, 6); }
    } },
  { dur: 6, text: 'THE END OF CHAPTER 2.  Thanks for playing!',
    draw: (k, t) => { drawBG(BOSSES2[4], t); text('THE END', W / 2, 230, 100, '#ffd23f', 'center', true, 10); text('CHAPTER 2: THE QUOLY LANDS', W / 2, 320, 28, '#fff', 'center', true, 5); } },
];

// ---------------------------------------------------------------- rendering
const bossCv = document.createElement('canvas');
bossCv.width = 400; bossCv.height = 340;
const bctx = bossCv.getContext('2d');
function paintBoss(def, s, silhouette) {
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.globalCompositeOperation = 'source-over';
  bctx.clearRect(0, 0, bossCv.width, bossCv.height);
  bctx.save();
  bctx.translate(200, 180);
  bctx.lineJoin = 'round'; bctx.lineCap = 'round';
  def.draw(bctx, s);
  bctx.restore();
  if (s.corrupt && !silhouette) {
    bctx.globalCompositeOperation = 'source-atop';
    bctx.fillStyle = 'rgba(40,0,60,0.35)';
    bctx.fillRect(0, 0, bossCv.width, bossCv.height);
    bctx.globalCompositeOperation = 'source-over';
  }
  if (s.flash > 0 || silhouette) {
    bctx.globalCompositeOperation = 'source-atop';
    bctx.fillStyle = silhouette ? '#0c0c0c' : 'rgba(255,255,255,0.75)';
    bctx.fillRect(0, 0, bossCv.width, bossCv.height);
    bctx.globalCompositeOperation = 'source-over';
  }
}
function drawBossAt(def, s, x, y, sc = 1, sil = false) {
  paintBoss(def, s, sil);
  const dx = x - 200 * sc, dy = y - 180 * sc;
  ctx.drawImage(bossCv, dx, dy, bossCv.width * sc, bossCv.height * sc);
  if ((def.glitch || s.corrupt) && !sil && Math.random() < (def.glitch ? 0.3 : 0.08)) {
    for (let i = 0; i < 4; i++) {
      const sy = rand(0, bossCv.height - 24), sh = rand(4, 24), off = rand(-24, 24);
      ctx.drawImage(bossCv, 0, sy, bossCv.width, sh, dx + off * sc, dy + sy * sc, bossCv.width * sc, sh * sc);
    }
  }
}

function text(s, x, y, size, col = '#fff', align = 'center', serif = false, stroke = 0) {
  ctx.font = serif ? `italic 900 ${size}px Georgia, "Times New Roman", serif` : `bold ${size}px "Courier New", Courier, monospace`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}

function drawBG(def, t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, def.bg[0]); g.addColorStop(1, def.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(BX, BY); ctx.rotate(t * 0.08);
  ctx.globalAlpha = 0.07; ctx.fillStyle = def.ray;
  for (let i = 0; i < 16; i++) {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, 1100, (i / 16) * TAU, ((i + 0.5) / 16) * TAU);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// film grain + vignette, for the old-cartoon look
const grainPats = [];
for (let k = 0; k < 4; k++) {
  const c = document.createElement('canvas');
  c.width = c.height = 200;
  const x = c.getContext('2d'), id = x.createImageData(200, 200);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.random() * 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = Math.random() < 0.5 ? 60 : 0;
  }
  x.putImageData(id, 0, 0);
  grainPats.push(ctx.createPattern(c, 'repeat'));
}
const vignette = document.createElement('canvas');
vignette.width = W; vignette.height = H;
{
  const v = vignette.getContext('2d');
  const g = v.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
  v.fillStyle = g; v.fillRect(0, 0, W, H);
}
function drawPost() {
  ctx.save();
  ctx.globalAlpha = 0.09;
  const ox = Math.floor(rand(0, 200)), oy = Math.floor(rand(0, 200));
  ctx.translate(ox, oy);
  ctx.fillStyle = grainPats[Math.floor(gT * 24) % 4];
  ctx.fillRect(-ox, -oy, W, H);
  ctx.restore();
  if (Math.random() < 0.12) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(rand(0, W), 0, 1.5, H);
  }
  ctx.drawImage(vignette, 0, 0);
}

function drawBone(r, horiz, col = '#f4f4f4') {
  ctx.fillStyle = col;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const cr = (horiz ? r.h : r.w) * 0.55;
  ctx.beginPath();
  if (horiz) {
    ctx.arc(r.x, r.y + r.h * 0.25, cr * 0.6, 0, TAU); ctx.arc(r.x, r.y + r.h * 0.75, cr * 0.6, 0, TAU);
    ctx.moveTo(r.x + r.w, r.y); ctx.arc(r.x + r.w, r.y + r.h * 0.25, cr * 0.6, 0, TAU); ctx.arc(r.x + r.w, r.y + r.h * 0.75, cr * 0.6, 0, TAU);
  } else {
    ctx.arc(r.x + r.w * 0.25, r.y, cr * 0.6, 0, TAU); ctx.arc(r.x + r.w * 0.75, r.y, cr * 0.6, 0, TAU);
    ctx.moveTo(r.x, r.y + r.h); ctx.arc(r.x + r.w * 0.25, r.y + r.h, cr * 0.6, 0, TAU); ctx.arc(r.x + r.w * 0.75, r.y + r.h, cr * 0.6, 0, TAU);
  }
  ctx.fill();
}

function drawBullet(b) {
  if (b.type === 'orb') {
    const col = b.col;
    if (b.missile) {
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.beginPath(); ctx.moveTo(-b.r * 1.4, -b.r * 0.5); ctx.lineTo(-b.r * 2.4 - Math.random() * 6, 0); ctx.lineTo(-b.r * 1.4, b.r * 0.5);
      ctx.fillStyle = '#ff9a2a'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 0, b.r * 1.5, b.r * 0.8, 0, 0, TAU);
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.32, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fill();
  } else if (b.type === 'saw') {
    sawShape(ctx, b.x, b.y, b.r, b.a || 0, 12);
  } else if (b.type === 'bone') {
    drawBone(boneRect(b), b.side === 'l' || b.side === 'r');
  } else if (b.type === 'wall') {
    for (const r of wallRects(b)) if (r.w > 0 && r.h > 0) drawBone(r, b.o === 'h', b.col);
  } else if (b.type === 'laser') {
    const [x1, y1, x2, y2] = laserSeg(b);
    const active = b.t > b.warn;
    ctx.save();
    ctx.lineCap = 'butt';
    if (!active) {
      ctx.globalAlpha = Math.floor(b.t * 16) % 2 ? 0.9 : 0.4;
      ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = b.track && b.t < b.track ? 1.5 : 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      if (b.w > 30) { // wide grid beams: show their full width while warning
        ctx.globalAlpha = 0.12; ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = b.w;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    } else {
      const k = Math.min(1, (b.t - b.warn) / 0.06) * (b.t > b.warn + b.active - 0.08 ? 0.5 : 1);
      ctx.globalAlpha = 0.45; ctx.strokeStyle = b.col; ctx.lineWidth = (b.w + 14) * k;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = b.w * 0.6 * k;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  } else if (b.type === 'zone') {
    const r = zoneRect(b);
    if (b.t < b.warn) {
      ctx.strokeStyle = Math.floor(b.t * 14) % 2 ? '#ff3b3b' : 'rgba(255,59,59,.3)';
      ctx.lineWidth = 2; ctx.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
      ctx.fillStyle = 'rgba(255,59,59,.12)'; ctx.fillRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
    } else {
      ctx.fillStyle = b.col || F.def.laser; ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      for (let i = 0; i < 3; i++) ctx.fillRect(r.x + 2, r.y + rand(0, r.h), r.w - 4, 2);
    }
  }
}

function drawFx() {
  for (const p of F.fx) {
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = Math.max(0, a);
    if (p.kind === 'heart') {
      drawHeart(p.x, p.y, p.sz);
    } else if (p.kind === 'sq' || p.kind === 'shard' || p.kind === 'virus') {
      ctx.fillStyle = p.col; ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = p.col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.sz + (p.t / p.life) * 60, 0, TAU); ctx.stroke();
    } else if (p.kind === 'txt') {
      text(p.text, p.x, p.y, 20, p.col, 'center', true, 4);
    } else if (p.kind === 'after') {
      ctx.globalAlpha = a * 0.5; ctx.strokeStyle = p.col; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - p.sz, p.y - p.sz, p.sz * 2, p.sz * 2);
    } else if (p.kind === 'mark') {
      ctx.globalAlpha = Math.floor(p.t * 14) % 2 ? 1 : 0.4;
      ctx.strokeStyle = p.col; ctx.lineWidth = 2;
      const s = p.sz * (1 - (p.t / p.life) * 0.5);
      ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU);
      ctx.moveTo(p.x - s - 6, p.y); ctx.lineTo(p.x + s + 6, p.y);
      ctx.moveTo(p.x, p.y - s - 6); ctx.lineTo(p.x, p.y + s + 6);
      ctx.stroke();
    } else if (p.kind === 'line') { // charge path warning
      ctx.globalAlpha = Math.floor(p.t * 14) % 2 ? 0.95 : 0.4;
      ctx.strokeStyle = p.col; ctx.lineWidth = F.bossR * 1.6; ctx.lineCap = 'round';
      ctx.globalAlpha *= 0.18;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke();
      ctx.globalAlpha = Math.floor(p.t * 14) % 2 ? 0.95 : 0.4;
      ctx.lineWidth = 3; ctx.setLineDash([12, 8]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineCap = 'butt';
    } else if (p.kind === 'shadow') { // slam landing spot
      const k = p.t / p.life;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 20, p.sz * (0.5 + 0.6 * k), p.sz * (0.25 + 0.3 * k), 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = Math.floor(p.t * 12) % 2 ? 1 : 0.4;
      ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 20, p.sz * 1.1, p.sz * 0.55, 0, 0, TAU); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const p = F.p, ph = 8 * F.M.size, col = SOULS[F.soul].col;
  if (state === 'dead') {
    if (F.shattered) return;
    ctx.fillStyle = col;
    const gap = F.deadT > 0.25 ? 3 : 0;
    ctx.fillRect(p.x - ph - gap, p.y - ph, ph, ph * 2);
    ctx.fillRect(p.x + gap, p.y - ph, ph, ph * 2);
    return;
  }
  if (p.inv > 0 && p.dashT <= 0 && Math.floor(p.inv * 20) % 2 === 0) return;
  // transformation: the square spins, swells and flashes white into its new colour
  const m = p.morph / 0.45;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (m > 0) { ctx.rotate(m * Math.PI); const s = 1 + Math.sin(m * Math.PI) * 0.9; ctx.scale(s, s); }
  ctx.fillStyle = col;
  ctx.fillRect(-ph, -ph, ph * 2, ph * 2);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.fillRect(-ph + 2, -ph + 2, ph * 0.7, ph * 0.45);
  if (m > 0) { ctx.fillStyle = `rgba(255,255,255,${m})`; ctx.fillRect(-ph, -ph, ph * 2, ph * 2); }
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.strokeRect(-ph, -ph, ph * 2, ph * 2);
  ctx.restore();
  const g = F.M.grav;
  if (g) { // little arrow showing which way is "down"
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const cx = p.x + g.x * ph * 0.45, cy = p.y + g.y * ph * 0.45, s = ph * 0.35;
    ctx.moveTo(cx + g.x * s, cy + g.y * s);
    ctx.lineTo(cx - g.x * s - g.y * s, cy - g.y * s + g.x * s);
    ctx.lineTo(cx - g.x * s + g.y * s, cy - g.y * s - g.x * s);
    ctx.fill();
  }
}

// glow gathering around the boss while it casts a new square on you
function drawCastAura() {
  const c = F.cast, b = F.boss, col = SOULS[c.soul].col;
  const k = Math.min(1, c.t / CAST_HIT);
  const fade = c.hit ? 1 - (c.t - CAST_HIT) / (CAST_T - CAST_HIT) : 1;
  ctx.save();
  ctx.globalAlpha = 0.35 * k * fade;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(b.x, b.y - b.lift, F.bossR + 30 + Math.sin(gT * 30) * 5, 0, TAU); ctx.fill();
  ctx.globalAlpha = fade;
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(b.x, b.y - b.lift, F.bossR + 20 + i * 16 + Math.sin(gT * 18 + i) * 4, 0, TAU); ctx.stroke();
  }
  // little squares spiralling in
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + gT * 4, rr = F.bossR + 10 + (1 - k) * 150;
    ctx.fillStyle = col;
    ctx.fillRect(b.x + Math.cos(a) * rr - 4, b.y - b.lift + Math.sin(a) * rr - 4, 8, 8);
  }
  ctx.restore();
}
// the lightning bolt that flies from the boss to your square
function drawCastBolt() {
  const c = F.cast, b = F.boss, p = F.p, col = SOULS[c.soul].col;
  if (c.t < 0.3 || c.t > CAST_HIT + 0.12) return;
  const prog = clamp((c.t - 0.3) / (CAST_HIT - 0.3), 0, 1);
  const x1 = b.x, y1 = b.y - b.lift, x2 = lerp(x1, p.x, prog), y2 = lerp(y1, p.y, prog);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const pts = [[x1, y1]];
  for (let i = 1; i < 10; i++) {
    const j = rand(-14, 14);
    pts.push([lerp(x1, x2, i / 10) + nx * j, lerp(y1, y2, i / 10) + ny * j]);
  }
  pts.push([x2, y2]);
  ctx.save();
  ctx.lineJoin = 'round';
  for (const [w, s, a] of [[10, col, 0.45], [3, '#fff', 1]]) {
    ctx.globalAlpha = a; ctx.strokeStyle = s; ctx.lineWidth = w;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = col; ctx.fillRect(x2 - 8, y2 - 8, 16, 16);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x2 - 8, y2 - 8, 16, 16);
  ctx.restore();
}

function bossState() {
  const b = F.boss;
  return { t: b.t, phase: F.phase, flash: b.flash, mouth: b.mouth, lx: b.lx, ly: b.ly, face: F.dice ? F.dice.shown : F.lastRoll || 6 };
}

function renderFight() {
  const f = F, b = f.boss;
  ctx.save();
  if (f.shake > 0) ctx.translate(rand(-f.shake, f.shake), rand(-f.shake, f.shake));
  // the ruler's own island in the background, a little darker during the fight
  drawLandScene(f.def.island, f.rt, f.tut ? 0.2 : 0.38, f.freed || !!f.tut);

  // the whole screen is the battle area
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(A.l, A.t, A.w, A.h);
  ctx.save();
  ctx.beginPath(); ctx.rect(A.l, A.t, A.w, A.h); ctx.clip();

  for (const o of f.bullets) if (o.type === 'zone') drawBullet(o);
  if (!f.gone) {
    if (b.lift > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 50, F.bossR * (1 - b.lift / 200), F.bossR * 0.35, 0, 0, TAU); ctx.fill();
    }
    const infected = CH === 0 && f.idx < 4 && !f.freed && !f.def.tutor;
    if (infected) drawVirusAura(b, f.clip ? 1 - f.clip.t / 2.4 : 1);
    if (f.freed) drawHalo(b);
    if (f.cast) drawCastAura();
    const s = bossState();
    s.corrupt = infected;
    if (f.freed) { s.phase = 0; s.mouth = Math.max(s.mouth, 0); }
    if (f.stage === 'ko') s.flash = Math.floor(f.koT * 12) % 2 ? 1 : 0;
    const bob = b.mv ? 0 : Math.sin(b.t * 2) * 5;
    let sc = BOSS_SCALE * (1 + b.lift / 400), jx = 0;
    if (f.stage === 'ko' || (f.clip && !f.clip.flashed)) jx = rand(-5, 5);
    if (f.clip && f.clip.kind === 'erase') sc *= Math.max(0.05, 1 - f.clip.t / 2.8); // the Null shrinks away to nothing
    drawBossAt(f.def, s, b.x + jx, b.y + bob - b.lift, sc);
  }
  if (f.tut && f.tut.star) drawStar(f.tut.star.x, f.tut.star.y);
  if (f.dice) drawDiceRoll();

  for (const o of f.bullets) if (o.type !== 'laser' && o.type !== 'zone') drawBullet(o);

  if (f.M.dark && state !== 'dead') {
    const p = f.p;
    const g = ctx.createRadialGradient(p.x, p.y, 40, p.x, p.y, 130);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.97)');
    ctx.fillStyle = g; ctx.fillRect(A.l, A.t, A.w, A.h);
  }
  // lasers stay visible even in the dark
  for (const o of f.bullets) if (o.type === 'laser') drawBullet(o);

  drawPlayer();
  drawFx();
  if (f.cast) drawCastBolt();
  ctx.restore();

  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.strokeRect(A.l - 2, A.t - 2, A.w + 4, A.h + 4);
  ctx.restore();

  drawHUD();
  if (f.talk) drawTalk();

  if (f.stage === 'ready') {
    if (f.stageT < 0.9) text('READY?', W / 2, 230, 64, '#fff', 'center', true, 8);
    else text('SURVIVE!', W / 2, 230, 80 + (f.stageT - 0.9) * 40, '#ffd23f', 'center', true, 10);
  }
  if (f.stage === 'ko' && state === 'fight') {
    const k = Math.min(1, f.koT * 3);
    text('SURVIVED!', W / 2, 220, 40 + 60 * k, '#ffd23f', 'center', true, 10);
  }
  if (f.clip && !f.clip.flashed) {
    text(f.clip.kind === 'erase' ? 'DELETING THE NULL...' : f.clip.kind === 'befriend' ? f.def.name + ' CALMS DOWN...' : 'THE VIRUS IS LEAVING ' + f.def.name + '...', W / 2, 120, 26, '#fff', 'center', true, 6);
  }
  if (f.flash > 0) {
    ctx.fillStyle = `rgba(255,40,40,${f.flash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (f.whiteFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${f.whiteFlash})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// dark tendrils and pixels around a ruler while the Null is inside them
function drawVirusAura(b, k) {
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.55 * k;
  const g = ctx.createRadialGradient(b.x, b.y, F.bossR * 0.5, b.x, b.y, F.bossR * 2);
  g.addColorStop(0, 'rgba(30,0,45,.9)'); g.addColorStop(1, 'rgba(30,0,45,0)');
  ctx.fillStyle = g; ctx.fillRect(b.x - F.bossR * 2, b.y - F.bossR * 2, F.bossR * 4, F.bossR * 4);
  ctx.globalAlpha = k;
  ctx.strokeStyle = '#1a0026'; ctx.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + gT * 0.7;
    ctx.beginPath(); ctx.moveTo(b.x + Math.cos(a) * F.bossR * 0.8, b.y + Math.sin(a) * F.bossR * 0.8);
    ctx.quadraticCurveTo(b.x + Math.cos(a + 0.4) * F.bossR * 1.5, b.y + Math.sin(a + 0.4) * F.bossR * 1.5,
      b.x + Math.cos(a + Math.sin(gT * 2 + i) * 0.5) * F.bossR * 1.9, b.y + Math.sin(a + Math.sin(gT * 2 + i) * 0.5) * F.bossR * 1.9);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#000' : '#ff2a6d';
    ctx.fillRect(b.x + rand(-F.bossR * 1.4, F.bossR * 1.4), b.y + rand(-F.bossR * 1.4, F.bossR), 5, 5);
  }
  ctx.restore();
}
// a freed ruler gets a little golden halo
function drawHalo(b) {
  ctx.save();
  ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 5; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.ellipse(b.x, b.y - F.bossR * 1.75 + Math.sin(gT * 3) * 3, 34, 9, 0, 0, TAU); ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const a = gT * 2 + i * 1.3;
    ctx.fillStyle = '#fff6c0';
    ctx.fillRect(b.x + Math.cos(a) * F.bossR * 1.3, b.y + Math.sin(a * 1.3) * F.bossR, 4, 4);
  }
  ctx.restore();
}
function drawStar(x, y) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(gT * 2);
  const s = 16 + Math.sin(gT * 6) * 3;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.45 : s, a = (i / 10) * TAU; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); fs(ctx, '#ffe14d', 3, '#000');
  ctx.restore();
}
// Undertale-style dialogue box with the speaker's portrait
function drawTalk() {
  const k = F.talk, [who, line] = k.lines[k.i];
  const x = A.l + 40, y = A.b - 176, w = A.w - 80, h = 156;
  ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);
  let tx = x + 24;
  if (who === 'boss') {
    const b = F.boss;
    drawBossAt(F.def, { t: b.t, phase: F.freed ? 0 : F.phase, flash: 0, mouth: b.mouth, lx: 0.3, ly: 0.3, corrupt: CH === 0 && F.idx < 4 && !F.freed && !F.def.tutor }, x + 82, y + 84, 0.36);
    tx = x + 168;
    text(F.def.name, tx, y + 22, 16, '#ffd23f', 'left');
  }
  ctx.font = 'bold 21px "Courier New", monospace';
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const shown = (who === '*' ? '* ' : '') + line.slice(0, Math.floor(k.t * 45));
  wrapText(shown, x + w - tx - 24).forEach((ln, i) => ctx.fillText(ln, tx, y + (who === 'boss' ? 44 : 26) + i * 28));
  if (Math.floor(k.t * 45) >= line.length && Math.floor(gT * 3) % 2) text('▼ ENTER', x + w - 56, y + h - 18, 13, '#ff0');
}

function drawHUD() {
  const f = F, d = f.def, p = f.p;
  text(d.name, W / 2, 14, 17, '#fff', 'center', false, 4);
  if (f.tut) { // tutorial: show the current goal instead of a timer
    const s = TUT_STEPS[f.tut.step];
    text('TUTORIAL  ' + Math.min(f.tut.step + 1, TUT_STEPS.length - 1) + '/' + (TUT_STEPS.length - 1), 18, 14, 13, '#9fe8d0', 'left', false, 3);
    if (s && s.goal && f.stage === 'fight') text('▶ ' + s.goal(), W / 2, 36, 17, '#ffe14d', 'center', false, 4);
  } else {
    // boss bar = time left until the virus lets go; the marks are where the phases change
    const bw = 460, bx = W / 2 - bw / 2, left = clamp(1 - f.surv / f.dur, 0, 1);
    ctx.fillStyle = '#7a0000'; ctx.fillRect(bx, 26, bw, 14);
    ctx.fillStyle = '#ffe600'; ctx.fillRect(bx, 26, bw * left, 14);
    ctx.fillStyle = '#000';
    for (const ph of [1, 2]) ctx.fillRect(bx + bw * (1 - phaseStart(ph) / f.dur) - 1, 26, 2, 14);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(bx, 26, bw, 14);
    text('SURVIVE ' + fmtTime(Math.ceil(f.dur - f.surv - 0.01)), bx + bw + 14, 33, 15, '#ffe600', 'left', false, 3);
    text('PHASE ' + (f.phase + 1) + '/3', bx - 14, 33, 15, '#aaa', 'right');
    text(MODES[f.mode].name, 18, 14, 13, MODES[f.mode].col, 'left', false, 3);
  }

  // bottom strip: you
  text('SQUARE  LV ' + (f.idx + 1), 18, 700, 18, '#fff', 'left');
  text('HP', 196, 700, 16, '#fff', 'left');
  const step = Math.min(20, 220 / p.max);
  for (let i = 0; i < Math.min(p.max, 15); i++) {
    ctx.fillStyle = i < p.hp ? '#ffe600' : '#a00';
    ctx.fillRect(224 + i * step, 692, step - 4, 16);
  }
  text(p.hp + '/' + p.max, 224 + p.max * step + 6, 700, 16, '#fff', 'left');
  const so = SOULS[f.soul];
  ctx.fillStyle = so.col; ctx.fillRect(540, 691, 18, 18);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(540, 691, 18, 18);
  text(so.name, 566, 700, 15, so.col, 'left', false, 3);
  // dash meter
  const ready = p.dashCD <= 0;
  text('DASH', 818, 700, 15, ready ? '#fff' : '#777', 'left');
  ctx.fillStyle = '#222'; ctx.fillRect(866, 693, 70, 14);
  ctx.fillStyle = ready ? '#7ff6ff' : '#3a7a80';
  ctx.fillRect(866, 693, 70 * clamp(1 - p.dashCD / 0.6, 0, 1), 14);
  ctx.strokeStyle = '#fff'; ctx.strokeRect(866, 693, 70, 14);

  // big banner when the boss changes your square
  const bn = f.banner;
  if (bn && bn.t < 1.6) {
    const k = bn.t < 0.12 ? bn.t / 0.12 : 1;
    ctx.globalAlpha = bn.t > 1.25 ? (1.6 - bn.t) / 0.35 : 1;
    text(bn.text, W / 2, 100, 46 * (1.5 - 0.5 * k), bn.col, 'center', true, 8);
    text(bn.sub, W / 2, 140, 18, '#fff', 'center', false, 4);
    ctx.globalAlpha = 1;
  }
}

function drawMedal(x, y, s, mi) {
  const m = MEDALS[mi];
  ctx.save(); ctx.translate(x, y);
  if (mi === 3) { // diamond: a gem
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.35); ctx.lineTo(-s * 0.55, -s * 0.85); ctx.lineTo(s * 0.55, -s * 0.85); ctx.lineTo(s, -s * 0.35); ctx.lineTo(0, s);
    ctx.closePath();
    ctx.fillStyle = m.col; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = m.dark; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s, -s * 0.35); ctx.lineTo(s, -s * 0.35); ctx.moveTo(-s * 0.3, -s * 0.35); ctx.lineTo(0, s); ctx.lineTo(s * 0.3, -s * 0.35);
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(-s * 0.45, -s * 0.75, s * 0.25, s * 0.25);
  } else { // ribbon + round medal with a star
    ctx.fillStyle = '#c62828';
    ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 1.6); ctx.lineTo(-s * 0.1, -s * 0.6); ctx.lineTo(-s * 0.5, -s * 0.6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s * 0.5, -s * 1.6); ctx.lineTo(s * 0.1, -s * 0.6); ctx.lineTo(s * 0.5, -s * 0.6); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, s * 0.85, 0, TAU);
    ctx.fillStyle = m.col; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = m.dark; ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.2 : s * 0.48, a = (i / 10) * TAU - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fillStyle = m.dark; ctx.fill();
  }
  ctx.restore();
}

// the very first screen: the game's name, its maker, and which chapter to play
function renderChapters() {
  drawBG(BOSSES1[chapSel === 1 ? 4 : 0], gT);
  text('THE HARD GAME', W / 2 + 4, 94, 86, '#000', 'center', true);
  text('THE HARD GAME', W / 2, 90, 86, '#ffd23f', 'center', true, 10);
  text('by bibis5125', W / 2, 152, 26, '#fff', 'center', true, 5);
  for (let c = 0; c < 2; c++) {
    const x = 90 + c * 410, y = 200, w = 370, h = 380, on = chapSel === c;
    rrect(ctx, x, y + (on ? -8 : 0), w, h, 14); fs(ctx, on ? 'rgba(40,30,10,.92)' : 'rgba(0,0,0,.75)', on ? 5 : 3, on ? '#ffd23f' : '#666');
    const yy = y + (on ? -8 : 0);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 12, yy + 60, w - 24, 200); ctx.clip();
    if (c === 0) {
      drawSea(gT);
      for (let i = 0; i < 5; i++) drawIsland(ctx, i, x + w / 2 + (ISLANDS1[i].x - 480) * 0.36, yy + 160 + (ISLANDS1[i].y - 320) * 0.36, 0.34, true, gT);
    } else {
      ctx.save(); ctx.translate(x + w / 2, yy + 160); ctx.scale(0.36, 0.36); ctx.translate(-480, -330); drawQuolyMapBg(gT); ctx.restore();
      for (let i = 0; i < 5; i++) drawPlace2(ctx, i, x + w / 2 + (LANDS2[i].x - 480) * 0.36, yy + 160 + (LANDS2[i].y - 330) * 0.36, 0.34, gT);
    }
    ctx.restore();
    text('CHAPTER ' + (c + 1), x + w / 2, yy + 32, 22, '#aaa', 'center', true, 4);
    text(CHAPTERS[c].name, x + w / 2, yy + 292, 30, on ? '#ffd23f' : '#fff', 'center', true, 5);
    text(CHAPTERS[c].blurb, x + w / 2, yy + 326, 13, '#ccc');
    text(chapterProgress(c) + ' / 5 bosses beaten', x + w / 2, yy + 354, 14, '#9fe8a0');
  }
  if (Math.floor(gT * 2.5) % 2) text('← → choose a chapter    ENTER play', W / 2, 640, 20, '#fff', 'center', false, 4);
  text('M mutes the sound', W / 2, 676, 13, '#777');
}

function renderTitle() {
  drawBG(BOSSES[0], gT);
  text('SQUAREHEAD', W / 2 + 4, 114, 100, '#000', 'center', true);
  text('SQUAREHEAD', W / 2, 110, 100, '#ffd23f', 'center', true, 10);
  text('THE HARD GAME  by bibis5125', W / 2, 176, 22, '#fff', 'center', true, 5);
  text('CHAPTER ' + (CH + 1) + ':  ' + CHAPTERS[CH].name, W / 2, 210, 22, CH === 1 ? '#9fe8a0' : '#7fd4ff', 'center', true, 5);
  // the square keeps changing colour, like the bosses do to you
  const ks = Object.keys(SOULS), col = SOULS[ks[Math.floor(gT * 1.5) % ks.length]].col;
  const y = 270 + Math.abs(Math.sin(gT * 4)) * -36;
  ctx.fillStyle = col; ctx.fillRect(W / 2 - 18, y - 18, 36, 36);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(W / 2 - 18, y - 18, 36, 36);
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(W / 2 - 14, y - 14, 12, 8);

  TITLE_MENU.forEach((s, i) => {
    const on = titleSel === i;
    text((on ? '▶ ' : '  ') + s, W / 2, 330 + i * 38, 28, on ? '#ffd23f' : '#aaa', 'center', true, 5);
  });

  rrect(ctx, 170, 478, 620, 150, 10); fs(ctx, 'rgba(0,0,0,.65)', 3, '#fff');
  const lines = [
    ['MOVE', [keyList('up'), keyList('left'), keyList('down'), keyList('right')].map(s => s.split(' / ')[0]).join(' ')],
    ['DASH', keyList('dash') + '   (invincible while dashing)'],
    ['JUMP', keyList('jump') + '   (only as a BLUE square)'],
    ['PAUSE', keyList('pause') + '      MUTE  M'],
  ];
  lines.forEach(([k, v], i) => {
    text(k, 200, 502 + i * 28, 17, '#ffd23f', 'left');
    text(v, 300, 502 + i * 28, 17, '#fff', 'left');
  });
  text(CH === 1 ? 'Befriend the four shamans of the Quoly Lands, then face the Dice King.' : 'Free the four infected rulers of the Square Sea, then delete the Null.', W / 2, 650, 15, '#ccc');
  if (Math.floor(gT * 2.5) % 2) text('↑ ↓ choose    ENTER select    ESC chapters', W / 2, 688, 18, '#fff', 'center', false, 4);
}

function renderSettings() {
  drawBG(BOSSES[3], gT);
  text('SETTINGS', W / 2, 60, 54, '#fff', 'center', true, 8);
  rrect(ctx, 130, 112, 700, 524, 12); fs(ctx, 'rgba(0,0,0,.75)', 3, '#fff');
  text('CONTROLS', 165, 136, 15, '#888', 'left');
  text('KEY 1', 520, 136, 15, '#888'); text('KEY 2', 700, 136, 15, '#888');
  ACTIONS.forEach(([a, label], i) => {
    const y = 170 + i * 40, on = setSel === i;
    if (on) { ctx.fillStyle = 'rgba(255,210,63,.12)'; ctx.fillRect(140, y - 20, 680, 40); }
    text(label, 165, y, 19, on ? '#ffd23f' : '#fff', 'left');
    for (let s = 0; s < 2; s++) {
      const x = s === 0 ? 520 : 700, active = on && setCol === s;
      const waiting = rebind && rebind.a === a && rebind.slot === s;
      rrect(ctx, x - 75, y - 15, 150, 30, 6);
      fs(ctx, active ? '#3a2c08' : '#151515', 2, active ? '#ffd23f' : '#555');
      text(waiting ? (Math.floor(gT * 4) % 2 ? 'PRESS A KEY' : '') : keyName(BIND[a][s]), x, y, 16, waiting ? '#ff0' : '#fff');
    }
  });
  const n = ACTIONS.length;
  // volume sliders
  [['MUSIC', 'musicVol'], ['SOUND EFFECTS', 'sfxVol']].forEach(([label, k], j) => {
    const y = 170 + n * 40 + 14 + j * 38, on = setSel === n + j;
    if (on) { ctx.fillStyle = 'rgba(255,210,63,.12)'; ctx.fillRect(140, y - 18, 680, 36); }
    text(label, 165, y, 19, on ? '#ffd23f' : '#fff', 'left');
    for (let v = 0; v < 10; v++) {
      ctx.fillStyle = v < save[k] ? (on ? '#ffd23f' : '#ddd') : '#333';
      ctx.fillRect(410 + v * 28, y - 9, 22, 18);
    }
    text((on ? '◀ ' : '') + save[k] * 10 + '%' + (on ? ' ▶' : ''), 805, y, 16, '#fff', 'right');
  });
  const ry = 170 + n * 40 + 96;
  text((setSel === n + 2 ? '▶ ' : '') + 'RESET KEYS TO DEFAULTS', W / 2, ry, 19, setSel === n + 2 ? '#ffd23f' : '#ccc');
  text((setSel === n + 3 ? '▶ ' : '') + 'RESET PROGRESS (THIS CHAPTER)', W / 2, ry + 30, 19, setSel === n + 3 ? '#ff5a5a' : '#c88');
  text((setSel === n + 4 ? '▶ ' : '') + 'BACK', W / 2, ry + 60, 19, setSel === n + 4 ? '#ffd23f' : '#ccc');
  text(rebind ? 'Press the new key  (ESC cancels)' : '↑ ↓ choose   ← → key slot / volume   ENTER change   ESC back', W / 2, 658, 16, '#fff');
  text('Menus always use the arrow keys, ENTER and ESC, so you cannot lock yourself out.', W / 2, 684, 13, '#888');
  if (resetDone > 0) {
    resetDone -= 1 / 60;
    text('PROGRESS RESET', W / 2, 110, 18, '#ff5a5a', 'center', false, 4);
  }
  if (confirmReset) {
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, W, H);
    rrect(ctx, 230, 230, 500, 230, 14); fs(ctx, '#f3ead2', 6, '#000');
    text('RESET PROGRESS?', W / 2, 280, 40, '#c62828', 'center', true);
    text('All unlocked bosses and medals of CHAPTER ' + (CH + 1), W / 2, 326, 17, '#333');
    text('will be erased. This cannot be undone.', W / 2, 350, 17, '#333');
    text('(your keys, MODE and HITS settings stay)', W / 2, 376, 13, '#777');
    text('ENTER  YES, RESET', W / 2 - 110, 422, 18, '#c62828');
    text('ESC  CANCEL', W / 2 + 130, 422, 18, '#000');
  }
}

function renderPause() {
  renderFight();
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
  text('PAUSED', W / 2, 300, 64, '#fff', 'center', true, 8);
  text('ENTER / ' + keyList('pause') + '  resume      Q  quit to the map', W / 2, 380, 18, '#ccc');
}

function renderDead() {
  renderFight();
  const k = clamp((F.deadT - 0.4) / 0.8, 0, 0.8);
  ctx.fillStyle = `rgba(0,0,0,${k})`; ctx.fillRect(0, 0, W, H);
  drawFx();
  if (F.deadT < 1.2) return;
  rrect(ctx, 200, 170, 560, 360, 14); fs(ctx, '#f3ead2', 6, '#000');
  text('YOU DIED!', W / 2, 230, 64, '#c62828', 'center', true, 0);
  text('* Stay determined, square...', W / 2, 282, 18, '#333');
  text(MODES[F.mode].name + ' MODE  ·  ' + F.p.max + ' HITS', W / 2, 310, 14, '#777');
  const x1 = 260, x2 = 700, ly = 370, prog = clamp(F.surv / F.dur, 0, 1);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(x1, ly); ctx.lineTo(x2, ly); ctx.stroke(); ctx.setLineDash([]);
  for (const ph of [1, 2]) { ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x1 + (x2 - x1) * (phaseStart(ph) / F.dur), ly, 6, 0, TAU); ctx.fill(); }
  drawBossAt(F.def, { t: gT, phase: F.phase, flash: 0, mouth: 0, lx: -1, ly: 0 }, x2 + 10, ly - 4, 0.22);
  const px = x1 + (x2 - x1) * prog;
  ctx.fillStyle = SOULS[F.soul].col; ctx.fillRect(px - 9, ly - 9, 18, 18);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(px - 9, ly - 9, 18, 18);
  text('survived ' + fmtTime(F.surv) + ' of ' + fmtTime(F.dur), W / 2, 410, 18, '#333');
  text('ENTER  RETRY', W / 2 - 120, 480, 22, '#000');
  text('ESC  QUIT', W / 2 + 120, 480, 22, '#000');
}

function renderResults() {
  renderFight();
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
  const f = F, r = f.result, m = MEDALS[r.medal];
  rrect(ctx, 220, 100, 520, 500, 14); fs(ctx, '#f3ead2', 6, '#000');
  const head = CH === 1 ? (f.idx === 4 ? 'THE KINGDOM IS YOUR FRIEND!' : f.def.name + ' IS YOUR FRIEND!') : f.idx === 4 ? 'THE NULL IS DELETED!' : f.def.name + ' IS FREE!';
  text(head, W / 2, 148, head.length > 22 ? 32 : head.length > 18 ? 38 : 44, '#000', 'center', true);
  text(f.def.name + '  ·  ' + MODES[f.mode].name + ' MODE  ·  ' + f.p.max + ' HITS', W / 2, 192, 15, '#555');
  const rows = [['TIME', fmtTime(f.time)], ['HITS TAKEN', String(f.hits)], ['HP LEFT', f.p.hp + ' / ' + f.p.max]];
  rows.forEach(([k, v], i) => {
    if (f.resT < 0.2 + i * 0.2) return;
    text(k, 270, 240 + i * 38, 22, '#000', 'left');
    text(v, 690, 240 + i * 38, 22, '#000', 'right');
  });
  if (f.resT > 1.0) {
    const pop = Math.min(1, (f.resT - 1.0) * 4);
    drawMedal(W / 2, 430, 46 * (0.5 + 0.5 * pop), r.medal);
    text(m.name + ' MEDAL', W / 2, 505, 34, m.dark, 'center', true);
  }
  if (r.newUnlock) text((CH === 1 ? 'NEW LAND: ' : 'NEW ISLAND: ') + ISLANDS[f.idx + 1].name + '!', W / 2, 545, 18, '#2a7a2a');
  if (f.idx === 4) text(CH === 1 ? 'YOU FINISHED CHAPTER 2!' : 'YOU FINISHED CHAPTER 1!', W / 2, 545, 20, '#c62828', 'center', true);
  if (f.resT > 0.8 && Math.floor(gT * 2.5) % 2) text('PRESS ENTER', W / 2, 578, 16, '#000');
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  switch (state) {
    case 'chapters': renderChapters(); break;
    case 'title': renderTitle(); break;
    case 'settings': renderSettings(); break;
    case 'map': renderMap(); break;
    case 'movie': renderMovie(); break;
    case 'fight': renderFight(); break;
    case 'pause': renderPause(); break;
    case 'dead': renderDead(); break;
    case 'results': renderResults(); break;
  }
  drawPost();
  if (audio.muted) text('MUTED', W - 20, H - 10, 12, '#888', 'right');
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.033);
  last = now;
  update(dt);
  render();
  for (const k in pressed) delete pressed[k];
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
