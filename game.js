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
let save = { unlocked: 1, best: {}, hp: 4, keys: null };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && s.unlocked) save = Object.assign(save, s);
} catch (e) { /* storage unavailable */ }
if (!(save.hp >= 1 && save.hp <= 15)) save.hp = 4;
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

// difficulty = how many hits you can take (1..15)
function diffInfo(hp) {
  if (hp === 1) return { name: 'ONE HIT = DEATH', col: '#ff2a2a' };
  if (hp <= 3) return { name: 'NIGHTMARE', col: '#ff5a3a' };
  if (hp <= 5) return { name: 'HARD', col: '#ffb030' };
  if (hp <= 8) return { name: 'NORMAL', col: '#ffe14d' };
  if (hp <= 11) return { name: 'EASY', col: '#8fe86a' };
  return { name: 'CASUAL', col: '#6ad0ff' };
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
        const len = this.ac.sampleRate;
        this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { this.ac = null; }
    }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  },
  now() { return this.ac ? this.ac.currentTime : 0; },
  tone(f, dur, type = 'square', vol = 0.05, slide = 1, t0) {
    if (!this.ac || this.muted) return;
    const t = t0 === undefined ? this.ac.currentTime : t0;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
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
    node.connect(g); g.connect(this.master);
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
    s.connect(f); f.connect(g); g.connect(this.master);
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
      if (!audio.muted) this.play(this.step, this.next);
      const inFight = F && this.def !== MENU_MUSIC;
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
const baseM = () => ({ time: 1, grav: null, reverse: false, ice: false, spd: 1, size: 1, dark: false });
function soulDesc(k) {
  const s = SOULS[k];
  return s.m.grav ? s.desc + '  ·  JUMP: ' + keyList('jump') : s.desc;
}

// ---------------------------------------------------------------- bosses
// Each boss has a fixed pattern per phase: a list of [attack, square] steps that loops.
// Attacks joined with '+' run at the same time. You win by surviving `dur` seconds.
const _ = null;
const BOSSES = [
  {
    name: 'CUBERT', title: 'THE BLOCK KING', dur: 60, r: 80,
    bullet: '#ffd23f', laser: '#ffe680', bg: ['#3a1c0c', '#120804'], ray: '#ffb347',
    intro: '* CUBERT THE BLOCK KING blocks the way!\n* He thinks every square should bow\n  to his crown.',
    lines: ['', 'You dare outlast the CROWN?!', 'OFF WITH YOUR CORNERS!!'],
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
    name: 'MADAME VORTEX', title: 'THE SPIRAL WITCH', dur: 70, r: 74,
    bullet: '#c18bff', laser: '#e9c8ff', bg: ['#1f0b3a', '#08020f'], ray: '#b07cff',
    intro: '* MADAME VORTEX swirls into view!\n* Your head is already spinning.',
    lines: ['', 'Round and round we go~!', 'LET THE WHOLE WORLD SPIN!!'],
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
    name: 'SAWBONES', title: 'THE GRINNING GRINDER', dur: 80, r: 72,
    bullet: '#efe8d2', laser: '#ff5a48', bg: ['#2a0d0d', '#0a0303'], ray: '#ff6a4d',
    intro: '* SAWBONES rattles in, blades screaming!\n* Smells like rust and bad decisions.',
    lines: ['', "Heh. You're still in one piece?", 'TIME TO CUT CORNERS. ALL FOUR!'],
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
    name: 'TICK-TOCK TYRANT', title: 'KEEPER OF LOST SECONDS', dur: 90, r: 82,
    bullet: '#ffe08a', laser: '#ffd34d', bg: ['#0c1f2a', '#02080c'], ray: '#7fd8ff',
    intro: '* The TICK-TOCK TYRANT winds himself up.\n* You are running out of time.',
    lines: ['', 'Tick... tock... TICK... TOCK!', 'YOUR TIME IS UP, SQUARE!'],
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
    name: 'THE NULL', title: 'ERROR: ENTITY NOT FOUND', dur: 100, r: 80,
    bullet: '#ffffff', laser: '#ff2a6d', bg: ['#0a0a0a', '#000000'], ray: '#ffffff', glitch: true,
    intro: '* THE NULL fills the room.\n* ...\n* It is just you and the void now.',
    lines: ['', 'Y O U   S H O U L D N T   B E   H E R E', 'D E L E T E   D E L E T E   D E L E T E'],
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

// calm-ish theme for the title and boss-select screens
const MENU_MUSIC = {
  root: 65.41, bpm: 112, bassWave: 'triangle', bassVol: 0.07, bassLen: 0.2,
  bass: [0, _, _, _, 7, _, _, _, 5, _, _, _, 7, _, _, _, 3, _, _, _, 10, _, _, _, 8, _, _, _, 7, _, _, _],
  lead: [12, _, 15, _, 19, _, 15, _, 17, _, 15, _, 14, _, _, _, 15, _, 19, _, 22, _, 19, _, 20, _, 19, _, 17, _, _, _],
  leadWave: 'triangle', leadVol: 0.035, leadLen: 0.22,
  drums: { k: 'k.......k.......', s: '................', h: '....h.......h...' },
};

// ---------------------------------------------------------------- global state
let state = 'title';
let F = null;        // current fight
let sel = 0;         // selected boss on the select screen
let titleSel = 0;    // PLAY / SETTINGS
let setSel = 0, setCol = 0;
let gT = 0;          // global clock

// ---------------------------------------------------------------- fight helpers (used by attacks)
function at(d, fn) { F.sched.push({ t: F.wt + d, fn }); }
function rep(n, iv, fn, d0 = 0) { for (let i = 0; i < n; i++) at(d0 + i * iv, () => fn(i)); return d0 + n * iv; }
function orb(x, y, vx, vy, o = {}) {
  const b = Object.assign({ type: 'orb', x, y, vx, vy, r: 7, t: 0, col: F.def.bullet }, o);
  F.bullets.push(b);
  return b;
}
function laser(o) {
  const b = Object.assign({ type: 'laser', x: 0, y: 0, ang: 0, len: 1800, w: 16, warn: 0.8, active: 0.5, rot: 0, t: 0, col: F.def.laser }, o);
  if (b.follow) { b.ox = b.x - F.boss.x; b.oy = b.y - F.boss.y; }
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
  b.mv = { x0: b.x, y0: b.y, x1: x, y1: y, t: 0, dur, hop, land };
}

// ---------------------------------------------------------------- attacks
// Each attack pre-rolls all of its random numbers up front (from the seeded generator)
// and schedules its bullets, then returns how long it lasts in world seconds.
const ATK = {
  rain() {
    const n = Math.round(34 * F.D), iv = 0.11 / F.D;
    const v = Array.from({ length: n }, () => [sr(A.l + 8, A.r - 8), sr(-25, 25), sr(200, 260)]);
    rep(n, iv, i => { orb(v[i][0], A.t - 8, v[i][1], v[i][2] * F.S, { r: 7 }); sfx.drop(); });
    return n * iv + 2.4;
  },
  aimed() {
    const v = 5, iv = 0.6 / F.S, k = 2 + Math.min(2, F.phase);
    rep(v, iv, () => {
      const b = F.boss, a = aimAt(b.x, b.y);
      for (let j = -k; j <= k; j++) {
        const aa = a + j * 0.2;
        orb(b.x + Math.cos(aa) * 50, b.y + Math.sin(aa) * 50, Math.cos(aa) * 300 * F.S, Math.sin(aa) * 300 * F.S, { r: 8 });
      }
      b.mouth = 0.25; sfx.fire();
    });
    return v * iv + 1.2;
  },
  boneWall() {
    const n = Math.round(4 + 2 * F.D), iv = 1.1 / F.D, horizOK = F.idx >= 2;
    const v = Array.from({ length: n }, () => [sc(0.5) ? 1 : -1, horizOK && sc(0.4), R()]);
    const sp = (300 + 20 * F.idx) * F.S;
    rep(n, iv, i => {
      const [dir, horiz, frac] = v[i];
      if (!horiz) F.bullets.push({ type: 'wall', o: 'v', pos: dir > 0 ? A.l - 16 : A.r + 2, th: 14, v: dir * sp, gc: gapPos('v', frac), gh: 90, t: 0 });
      else F.bullets.push({ type: 'wall', o: 'h', pos: dir > 0 ? A.t - 16 : A.b + 2, th: 14, v: dir * sp * 0.75, gc: gapPos('h', frac), gh: 96, t: 0 });
      sfx.whoosh();
    });
    return n * iv + A.w / sp + 0.2;
  },
  boneFloor() {
    const n = Math.round(8 + 3 * F.D), iv = 0.75 / F.D, dir = sc(0.5) ? 1 : -1;
    const lens = Array.from({ length: n }, () => sr(26, 58));
    const sp = (260 + 20 * F.idx) * F.S;
    rep(n, iv, i => {
      const side = floorSide(), alongX = side === 'b' || side === 't';
      const lo = alongX ? A.l : A.t, hi = alongX ? A.r : A.b;
      F.bullets.push({ type: 'bone', side, pos: dir > 0 ? lo - 14 : hi + 2, v: dir * sp, len: lens[i], th: 12, t: 0 });
      sfx.whoosh();
    });
    return n * iv + A.w / sp;
  },
  ringBurst() {
    const n = Math.round(4 + 2 * F.D), iv = 0.8 / F.D;
    const v = Array.from({ length: n }, () => [sr(A.l + 60, A.r - 60), sr(A.t + 60, A.b - 60), sr(0, TAU)]);
    rep(n, iv, i => {
      const [x, y, off] = v[i];
      mark(x, y, 0.6);
      at(0.6, () => { ringOf(x, y, Math.round(10 + 3 * F.D), 170 * F.S, off, 6); sfx.ring(); });
    });
    return n * iv + 3;
  },
  spiral() {
    const arms = 3 + Math.min(2, F.phase), dur = 5, iv = 0.16 / Math.sqrt(F.D), n = Math.floor(dur / iv);
    const spin = (1.3 + 0.3 * F.phase) * (sc(0.5) ? 1 : -1), off = sr(0, TAU);
    F.boss.mouth = 0.6;
    rep(n, iv, i => {
      const b = F.boss;
      for (let a = 0; a < arms; a++) {
        const ang = off + i * iv * spin + (a / arms) * TAU;
        orb(b.x + Math.cos(ang) * 45, b.y + Math.sin(ang) * 45, Math.cos(ang) * 170 * F.S, Math.sin(ang) * 170 * F.S, { r: 6 });
      }
      sfx.spiralTick();
    }, 0.5);
    return 0.5 + dur + 1.5;
  },
  bouncers() {
    const n = Math.round(3 + 2 * F.D);
    const v = Array.from({ length: n }, () => sr(0, TAU));
    rep(n, 0.4, i => {
      const b = F.boss, a = v[i];
      orb(b.x + Math.cos(a) * 50, b.y + Math.sin(a) * 50, Math.cos(a) * 230 * F.S, Math.sin(a) * 230 * F.S, { r: 11, bounce: 4, life: 7 });
      b.mouth = 0.2; sfx.ring();
    });
    return n * 0.4 + 4;
  },
  homing() {
    const n = Math.round(3 + 1.5 * F.D), iv = 0.6 / F.S;
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
      hr: Array.from({ length: rows }, () => sc(0.7)), vc: Array.from({ length: cols }, () => sc(0.7)),
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
    const n = Math.round(3 + F.D), iv = 1.0 / F.S;
    rep(n, iv, () => laser({ x: F.boss.x, y: F.boss.y, follow: true, track: 0.55, warn: 0.8, active: 0.15, w: 14 }));
    return n * iv + 1.2;
  },
  crossfire() {
    const n = Math.round(10 + 5 * F.D), iv = 0.3 / F.D;
    const v = Array.from({ length: n }, () => sr(-60, 60));
    rep(n, iv, i => {
      const left = i % 2 === 0, y = clamp(F.p.y + v[i], A.t + 8, A.b - 8);
      orb(left ? A.l - 10 : A.r + 10, y, (left ? 1 : -1) * 320 * F.S, 0, { r: 7 });
      sfx.drop();
    });
    return n * iv + 2.8;
  },
  saws() {
    const n = Math.round(3 + F.D), iv = 1.1 / F.S;
    const v = Array.from({ length: n }, () => [sc(0.5) ? 1 : -1, sri(0, 3), sr(240, 300), sr(0, TAU), sc(0.45)]);
    rep(n, iv, i => {
      const [dir, sideI, sp, ang, extra] = v[i];
      const side = F.M.grav ? floorSide() : ['b', 't', 'l', 'r'][sideI];
      const alongX = side === 'b' || side === 't';
      F.bullets.push({
        type: 'saw', side, r: 26, t: 0, spin: dir * 12,
        x: alongX ? (dir > 0 ? A.l - 30 : A.r + 30) : 0, y: alongX ? 0 : (dir > 0 ? A.t - 30 : A.b + 30),
        vx: alongX ? dir * sp * F.S : 0, vy: alongX ? 0 : dir * sp * F.S,
      });
      if (F.phase >= 1 && extra) {
        const b = F.boss;
        F.bullets.push({ type: 'saw', x: b.x, y: b.y, r: 18, vx: Math.cos(ang) * 220 * F.S, vy: Math.sin(ang) * 220 * F.S, t: 0, spin: 14, bounce: 3, life: 6 });
      }
      sfx.sawBuzz();
    });
    return n * iv + 3.2;
  },
  closingRing() {
    const waves = Math.round(2 + F.D * 0.8), iv = 1.6 / F.S, k = 40, Rr = 600;
    const gaps = Array.from({ length: waves }, () => sri(0, k - 1));
    rep(waves, iv, i => {
      const cx = F.boss.x, cy = F.boss.y, sp = 150 * F.S;
      for (let j = 0; j < k; j++) {
        if ((j - gaps[i] + k) % k < 5) continue;
        const a = (j / k) * TAU;
        orb(cx + Math.cos(a) * Rr, cy + Math.sin(a) * Rr, -Math.cos(a) * sp, -Math.sin(a) * sp, { r: 7, life: (Rr - 40) / sp });
      }
      sfx.ring();
    });
    return waves * iv + Rr / (150 * F.S);
  },
  clockHands() {
    const dur = 5, spin = (0.8 + 0.25 * F.phase) * F.S, dir = sc(0.5) ? 1 : -1, a0 = sr(0, TAU);
    laser({ x: F.boss.x, y: F.boss.y, follow: true, ang: a0, rot: spin * dir, warn: 1.0, active: dur, w: 14 });
    if (F.phase >= 1 || F.idx === 4) laser({ x: F.boss.x, y: F.boss.y, follow: true, ang: a0 + Math.PI * 0.66, rot: -spin * dir * 0.7, warn: 1.0, active: dur, w: 10, silent: true });
    if (F.phase >= 2) {
      const xs = Array.from({ length: 10 }, () => sr(A.l + 10, A.r - 10));
      rep(10, 0.45, i => orb(xs[i], A.t - 8, 0, 220 * F.S, { r: 7 }), 1.2);
    }
    F.boss.mouth = dur + 1;
    return dur + 1.6;
  },
  zones() {
    const cols = 6, rows = 4, waves = Math.round(3 + F.D), iv = 1.0 / F.S;
    const v = Array.from({ length: waves }, () => ({ safe: sri(0, cols * rows - 1), on: Array.from({ length: cols * rows }, () => sc(0.5)) }));
    rep(waves, iv, i => {
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const k = r * cols + c;
        if (k === v[i].safe || !v[i].on[k]) continue;
        F.bullets.push({ type: 'zone', fx: c / cols, fy: r / rows, fw: 1 / cols, fh: 1 / rows, warn: 0.8, active: 0.4, t: 0 });
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
        moveBoss(x, y, 0.3, false, () => { ringOf(x, y, 12, 160 * F.S, 0.26 * i); F.shake = 8; sfx.ring(); });
      });
      t += gap + 0.3;
    }
    at(t, () => moveBoss(BX, BY, 0.7));
    return t + 0.9;
  },
  // the boss leaps onto where you are standing; get out of the shadow
  slam() {
    const n = 3, gap = 1.6 / F.S;
    let t = 0;
    for (let i = 0; i < n; i++) {
      at(t, () => {
        const tx = clamp(F.p.x, A.l + 80, A.r - 80), ty = clamp(F.p.y, A.t + 80, A.b - 80);
        fx({ kind: 'shadow', x: tx, y: ty, sz: F.bossR, life: 0.9 });
        F.boss.mouth = 0.9; sfx.jump();
        moveBoss(tx, ty, 0.9, true, () => { ringOf(tx, ty, 16, 170 * F.S, 0.2 * i); F.shake = 12; sfx.boom(); });
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

function startFight(idx) {
  const def = BOSSES[idx];
  F = {
    idx, def, phase: 0, stage: 'text', textT: 0, stageT: 0, rt: 0, wt: 0, time: 0, surv: 0,
    bullets: [], fx: [], sched: [],
    boss: { x: BX, y: BY, t: 0, flash: 0, mouth: 0, lx: 0, ly: 1, lift: 0, mv: null },
    bossR: def.r * BOSS_SCALE * 0.75,
    p: newPlayer(), soul: 'red', M: baseM(), cast: null, timeScale: 1,
    stepI: 0, nextAtk: 0, hits: 0,
    shake: 0, hitstop: 0, flash: 0, banner: null, speech: null, koT: 0, deadT: 0, resT: 0,
  };
  setDS();
  state = 'fight';
}
// D = bullet density, S = bullet speed
function setDS() {
  F.D = 0.7 * (1 + 0.13 * F.idx + 0.22 * F.phase);
  F.S = 0.75 * (1 + 0.06 * F.idx + 0.11 * F.phase);
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

function clearBullets() {
  for (const b of F.bullets) if (b.type === 'orb' || b.type === 'saw') burst(b.x, b.y, b.col || '#fff', 2, 120);
  F.bullets = [];
  F.sched = [];
}
function phaseUp(ph) {
  F.phase = ph;
  setDS();
  clearBullets();
  F.cast = null;
  F.stepI = 0;
  F.nextAtk = F.wt + 1.8;
  F.speech = { text: F.def.lines[F.phase], t: 0 };
  F.shake = 14; F.flash = 0.3;
  sfx.boom(); sfx.phase();
  burst(F.boss.x, F.boss.y, '#fff', 30, 400);
  moveBoss(BX, BY, 0.6);
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
  p.hp--; p.inv = 1.3;
  F.hits++;
  F.shake = 10; F.hitstop = 0.1; F.flash = 0.25;
  sfx.hurt();
  burst(p.x, p.y, '#f33', 14, 260);
  if (p.hp <= 0) { state = 'dead'; F.deadT = 0; F.shattered = false; music.stop(); }
}
function finishFight() {
  const f = F, medal = medalFor(f.hits);
  const newUnlock = f.idx + 2 > save.unlocked && f.idx < 4;
  save.unlocked = Math.max(save.unlocked, Math.min(5, f.idx + 2));
  const best = save.best[f.idx];
  if (!best || medal > best.medal || (medal === best.medal && f.p.max < best.hp)) save.best[f.idx] = { medal, hp: f.p.max };
  if (f.idx === 4) save.beatAll = true;
  persist();
  f.result = { medal, newUnlock };
  f.resT = 0;
  sfx.win();
  state = 'results';
}

// ---------------------------------------------------------------- fight update
function updateFight(dt) {
  const f = F;
  if (tap('pause')) { pauseGame(); return; }
  f.rt += dt;
  f.shake = Math.max(0, f.shake - dt * 40);
  f.flash = Math.max(0, f.flash - dt);
  if (f.hitstop > 0) { f.hitstop -= dt; return; }

  if (f.stage === 'text') {
    const full = f.def.intro.length;
    const prev = Math.floor(f.textT * 45);
    f.textT += dt;
    const now = Math.floor(f.textT * 45);
    if (now > prev && now <= full && f.def.intro[now - 1] !== ' ' && now % 2 === 0) sfx.text();
    if (mtap('ok') && f.textT > 0.15) {
      if (now < full) f.textT = full / 45;
      else beginReady();
    } else if (f.textT > full / 45 + 1.8) beginReady();
    updateBoss(dt);
    return;
  }
  if (f.stage === 'ready') {
    f.stageT += dt;
    if (f.stageT - dt <= 0.9 && f.stageT > 0.9) sfx.fight();
    if (f.stageT > 1.5) { f.stage = 'fight'; f.nextAtk = f.wt + 0.3; }
  }
  f.timeScale += (f.M.time - f.timeScale) * Math.min(1, dt * 6);
  const wdt = dt * f.timeScale;
  f.wt += wdt;
  if (f.stage === 'fight') {
    f.time += dt;
    f.surv += wdt;
    const ph = Math.min(2, Math.floor(f.surv / (f.def.dur / 3)));
    if (ph > f.phase) phaseUp(ph);
    if (f.surv >= f.def.dur) knockout();
    if (f.p.hp === 1 && f.p.max > 1) { f.beatT = (f.beatT || 0) - dt; if (f.beatT <= 0) { f.beatT = 1.1; sfx.heartbeat(); } }
  }
  if (f.stage === 'ko') {
    f.koT += dt;
    if (Math.floor(f.koT * 10) !== Math.floor((f.koT - dt) * 10)) {
      burst(f.boss.x + rand(-60, 60), f.boss.y + rand(-55, 55), pick(['#fff', '#ffd23f', '#f84']), 12, 300);
      if (Math.random() < 0.4) sfx.pop();
    }
    if (f.koT > 3) { finishFight(); return; }
  }
  updateBoss(wdt);
  if (f.stage === 'fight') { runSched(); runAI(); }
  updateCast(wdt);
  updatePlayer(wdt); // the square speeds up / slows down with time too
  updateBullets(wdt);
  updateFx(dt);
  if (f.stage === 'fight') collide();
  if (f.banner) f.banner.t += dt;
  if (f.speech) f.speech.t += dt;
}

function runSched() {
  const now = F.wt, due = [];
  F.sched = F.sched.filter(e => (e.t <= now ? (due.push(e), false) : true));
  for (const e of due) e.fn();
}
// walk through the boss's fixed pattern; change the square first if this step needs a new one
function runAI() {
  const f = F;
  if (f.cast || f.wt < f.nextAtk) return;
  const pat = f.def.patterns[f.phase], i = f.stepI % pat.length, [atk, soul] = pat[i];
  f.stepI++;
  const go = () => {
    seed((f.idx + 1) * 1000 + f.phase * 100 + i);
    let dur = 0;
    for (const a of atk.split('+')) dur = Math.max(dur, ATK[a]());
    f.nextAtk = f.wt + dur + 0.35;
  };
  if (soul !== f.soul) {
    startCast(soul);
    f.nextAtk = Infinity;
    at(CAST_T, go);
  } else go();
}

function updateBoss(dt) {
  const b = F.boss;
  b.t += dt; b.flash -= dt; b.mouth -= dt;
  if (b.mv) {
    const m = b.mv;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur), e = m.hop ? k : ease(k);
    b.x = lerp(m.x0, m.x1, e); b.y = lerp(m.y0, m.y1, e);
    b.lift = m.hop ? Math.sin(k * Math.PI) * 90 : 0;
    if (k >= 1) { b.mv = null; b.lift = 0; if (m.land) m.land(); }
  }
  const dx = F.p.x - b.x, dy = F.p.y - b.y, l = Math.hypot(dx, dy) || 1;
  b.lx = dx / l; b.ly = dy / l;
}

function updatePlayer(dt) {
  const p = F.p, M = F.M;
  let ix = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  let iy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  if (M.reverse) { ix = -ix; iy = -iy; }
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
    along += s * 1500 * dt;
    if ((p.grounded || p.coyote > 0) && p.jumpBuf > 0) {
      along = -s * 560; p.jumpBuf = 0; p.coyote = 0; p.grounded = false;
      sfx.jump();
    }
    if (!jh && along * s < 0) along += s * 1500 * dt * 1.4;
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
  const p = F.p;
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
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.side === 'b') b.y = A.b - b.r * 0.55;
      else if (b.side === 't') b.y = A.t + b.r * 0.55;
      else if (b.side === 'l') b.x = A.l + b.r * 0.55;
      else if (b.side === 'r') b.x = A.r - b.r * 0.55;
      if (b.bounce > 0) {
        if ((b.x < A.l + b.r && b.vx < 0) || (b.x > A.r - b.r && b.vx > 0)) { b.vx *= -1; b.bounce--; sfx.bounce(); }
        if ((b.y < A.t + b.r && b.vy < 0) || (b.y > A.b - b.r && b.vy > 0)) { b.vy *= -1; b.bounce--; sfx.bounce(); }
      }
      if (b.spin) b.a = (b.a || 0) + b.spin * dt;
      if (b.life && b.t > b.life) { b.dead = true; burst(b.x, b.y, b.col || '#fff', 4, 100); }
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
  if ((state === 'title' || state === 'select' || state === 'settings') && audio.ac && (!music.on || music.def !== MENU_MUSIC)) music.start(MENU_MUSIC);
  switch (state) {
    case 'title': updateTitle(); break;
    case 'settings': updateSettings(); break;
    case 'select': updateSelect(); break;
    case 'fight': updateFight(dt); break;
    case 'pause':
      if (mtap('ok') || tap('pause') || mtap('back')) { state = 'fight'; if (F.stage !== 'text' && F.stage !== 'ko') music.start(F.def.music); }
      else if (mtap('quit')) state = 'select';
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
        if (mtap('ok')) { sfx.confirm(); startFight(F.idx); }
        else if (mtap('back') || mtap('quit')) state = 'select';
      }
      break;
    case 'results':
      F.resT += dt;
      updateFx(dt);
      if (F.resT > 0.8 && mtap('ok')) {
        sfx.confirm();
        state = 'select';
        sel = Math.min(F.idx + 1, save.unlocked - 1);
      }
      break;
  }
}

function updateTitle() {
  if (mtap('up') || mtap('down')) { titleSel ^= 1; sfx.select(); }
  if (mtap('ok')) {
    sfx.confirm();
    if (titleSel === 0) { state = 'select'; sel = Math.min(sel, save.unlocked - 1); }
    else { state = 'settings'; setSel = 0; setCol = 0; }
  }
}

function updateSettings() {
  if (rebind) return;
  const rows = ACTIONS.length + 2; // actions, RESET, BACK
  if (mtap('up')) { setSel = (setSel + rows - 1) % rows; sfx.select(); }
  if (mtap('down')) { setSel = (setSel + 1) % rows; sfx.select(); }
  if ((mtap('left') || mtap('right')) && setSel < ACTIONS.length) { setCol ^= 1; sfx.select(); }
  if (mtap('back')) { state = 'title'; return; }
  if (mtap('ok')) {
    if (setSel < ACTIONS.length) { rebind = { a: ACTIONS[setSel][0], slot: setCol }; sfx.select(); }
    else if (setSel === ACTIONS.length) { resetKeys(); sfx.confirm(); }
    else { state = 'title'; sfx.confirm(); }
  }
}

function updateSelect() {
  if (mtap('left')) { sel = (sel + 4) % 5; sfx.select(); }
  if (mtap('right')) { sel = (sel + 1) % 5; sfx.select(); }
  if (mtap('up') && save.hp < 15) { save.hp++; persist(); sfx.select(); }
  if (mtap('down') && save.hp > 1) { save.hp--; persist(); sfx.select(); }
  if (mtap('unlock')) { save.unlocked = 5; persist(); sfx.unlock(); }
  if (mtap('back')) { state = 'title'; return; }
  if (mtap('ok')) {
    if (sel < save.unlocked) { sfx.confirm(); startFight(sel); }
    else audio.tone(120, 0.15, 'square', 0.06);
  }
}

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
  if (def.glitch && !sil && Math.random() < 0.3) {
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

function drawBone(r, horiz) {
  ctx.fillStyle = '#f4f4f4';
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
    for (const r of wallRects(b)) if (r.w > 0 && r.h > 0) drawBone(r, b.o === 'h');
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
      ctx.fillStyle = F.def.laser; ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      for (let i = 0; i < 3; i++) ctx.fillRect(r.x + 2, r.y + rand(0, r.h), r.w - 4, 2);
    }
  }
}

function drawFx() {
  for (const p of F.fx) {
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = Math.max(0, a);
    if (p.kind === 'sq' || p.kind === 'shard') {
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
  return { t: b.t, phase: F.phase, flash: b.flash, mouth: b.mouth, lx: b.lx, ly: b.ly };
}

function renderFight() {
  const f = F, b = f.boss;
  ctx.save();
  if (f.shake > 0) ctx.translate(rand(-f.shake, f.shake), rand(-f.shake, f.shake));
  drawBG(f.def, f.rt);

  // the whole screen is the battle area
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(A.l, A.t, A.w, A.h);
  ctx.save();
  ctx.beginPath(); ctx.rect(A.l, A.t, A.w, A.h); ctx.clip();

  for (const o of f.bullets) if (o.type === 'zone') drawBullet(o);
  const bossGone = state === 'results' || (f.stage === 'ko' && f.koT > 2.4);
  if (!bossGone) {
    if (b.lift > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 50, F.bossR * (1 - b.lift / 200), F.bossR * 0.35, 0, 0, TAU); ctx.fill();
    }
    if (f.cast) drawCastAura();
    const s = bossState();
    if (f.stage === 'ko') s.flash = Math.floor(f.koT * 12) % 2 ? 1 : 0;
    const bob = b.mv ? 0 : Math.sin(b.t * 2) * 5;
    drawBossAt(f.def, s, b.x + (f.stage === 'ko' ? rand(-5, 5) : 0), b.y + bob - b.lift, BOSS_SCALE * (1 + b.lift / 400));
  }
  drawSpeech();

  for (const o of f.bullets) if (o.type !== 'laser' && o.type !== 'zone') drawBullet(o);

  if (f.M.dark && state !== 'dead') {
    const p = f.p;
    const g = ctx.createRadialGradient(p.x, p.y, 40, p.x, p.y, 130);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.97)');
    ctx.fillStyle = g; ctx.fillRect(A.l, A.t, A.w, A.h);
  }
  // lasers stay visible even in the dark
  for (const o of f.bullets) if (o.type === 'laser') drawBullet(o);

  if (f.stage !== 'text') drawPlayer();
  drawFx();
  if (f.cast) drawCastBolt();
  ctx.restore();

  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.strokeRect(A.l - 2, A.t - 2, A.w + 4, A.h + 4);
  ctx.restore();

  if (f.stage === 'text') drawIntroText();
  drawHUD();

  if (f.stage === 'ready') {
    if (f.stageT < 0.9) text('READY?', W / 2, 230, 64, '#fff', 'center', true, 8);
    else text('SURVIVE!', W / 2, 230, 80 + (f.stageT - 0.9) * 40, '#ffd23f', 'center', true, 10);
  }
  if (f.stage === 'ko' && state === 'fight') {
    const k = Math.min(1, f.koT * 3);
    text('KNOCKOUT!', W / 2, 220, 40 + 60 * k, '#ffd23f', 'center', true, 10);
  }
  if (f.flash > 0) {
    ctx.fillStyle = `rgba(255,40,40,${f.flash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawSpeech() {
  const s = F.speech;
  if (!s || s.t > 2.6 || !s.text) return;
  const b = F.boss;
  const bx = clamp(b.x + 70, A.l + 10, A.r - 340), by = b.y - 130;
  ctx.font = 'bold 17px "Courier New", monospace';
  const w = Math.min(330, ctx.measureText(s.text).width + 30);
  rrect(ctx, bx, by, w, 44, 10); fs(ctx, '#fff', 3, '#000');
  ctx.beginPath(); ctx.moveTo(bx + 20, by + 44); ctx.lineTo(bx + 4, by + 64); ctx.lineTo(bx + 38, by + 44); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(s.text.slice(0, Math.floor(s.t * 40)), bx + 14, by + 22, w - 24);
}

function drawIntroText() {
  const f = F, x = A.l + 90, y = A.b - 170, w = A.w - 180, h = 150;
  ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);
  const shown = f.def.intro.slice(0, Math.floor(f.textT * 45));
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  shown.split('\n').forEach((ln, i) => ctx.fillText(ln, x + 24, y + 22 + i * 32));
  if (shown.length >= f.def.intro.length && Math.floor(gT * 3) % 2) text('[ENTER]', x + w - 60, y + h - 20, 14, '#ff0');
}

function drawHUD() {
  const f = F, d = f.def, p = f.p;
  // boss bar = time left until it collapses
  text(d.name, W / 2, 14, 17, '#fff', 'center', false, 4);
  const bw = 460, bx = W / 2 - bw / 2, left = clamp(1 - f.surv / d.dur, 0, 1);
  ctx.fillStyle = '#7a0000'; ctx.fillRect(bx, 26, bw, 14);
  ctx.fillStyle = '#ffe600'; ctx.fillRect(bx, 26, bw * left, 14);
  ctx.fillStyle = '#000';
  ctx.fillRect(bx + bw / 3 - 1, 26, 2, 14); ctx.fillRect(bx + (bw * 2) / 3 - 1, 26, 2, 14);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(bx, 26, bw, 14);
  text('SURVIVE ' + fmtTime(Math.ceil(d.dur - f.surv)), bx + bw + 14, 33, 15, '#ffe600', 'left', false, 3);
  text('PHASE ' + (f.phase + 1) + '/3', bx - 14, 33, 15, '#aaa', 'right');

  // bottom strip: you
  text('SQUARE  LV ' + (f.idx + 1), 18, 700, 18, '#fff', 'left');
  text('HP', 196, 700, 16, '#fff', 'left');
  const step = Math.min(20, 220 / p.max);
  for (let i = 0; i < p.max; i++) {
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

function renderTitle() {
  drawBG(BOSSES[0], gT);
  text('SQUAREHEAD', W / 2 + 4, 124, 104, '#000', 'center', true);
  text('SQUAREHEAD', W / 2, 120, 104, '#ffd23f', 'center', true, 10);
  text('in  "THE HARD GAME"', W / 2, 192, 26, '#fff', 'center', true, 5);
  // the square keeps changing colour, like the bosses do to you
  const ks = Object.keys(SOULS), col = SOULS[ks[Math.floor(gT * 1.5) % ks.length]].col;
  const y = 270 + Math.abs(Math.sin(gT * 4)) * -36;
  ctx.fillStyle = col; ctx.fillRect(W / 2 - 18, y - 18, 36, 36);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(W / 2 - 18, y - 18, 36, 36);
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(W / 2 - 14, y - 14, 12, 8);

  ['PLAY', 'SETTINGS'].forEach((s, i) => {
    const on = titleSel === i;
    text((on ? '▶ ' : '  ') + s, W / 2, 335 + i * 44, 30, on ? '#ffd23f' : '#aaa', 'center', true, 5);
  });

  rrect(ctx, 170, 430, 620, 200, 10); fs(ctx, 'rgba(0,0,0,.65)', 3, '#fff');
  const lines = [
    ['MOVE', [keyList('up'), keyList('left'), keyList('down'), keyList('right')].map(s => s.split(' / ')[0]).join(' ')],
    ['DASH', keyList('dash') + '   (invincible while dashing)'],
    ['JUMP', keyList('jump') + '   (only as a BLUE square)'],
    ['PAUSE', keyList('pause') + '      MUTE  M'],
  ];
  lines.forEach(([k, v], i) => {
    text(k, 200, 460 + i * 30, 18, '#ffd23f', 'left');
    text(v, 300, 460 + i * 30, 18, '#fff', 'left');
  });
  text('No shooting. Dodge everything until the boss runs out of time.', W / 2, 590, 15, '#ccc');
  text('The boss will keep turning you into different squares.', W / 2, 612, 15, '#ccc');
  if (Math.floor(gT * 2.5) % 2) text('↑ ↓ choose    ENTER select', W / 2, 670, 20, '#fff', 'center', false, 4);
}

function renderSettings() {
  drawBG(BOSSES[3], gT);
  text('SETTINGS', W / 2, 60, 54, '#fff', 'center', true, 8);
  text('CONTROLS', W / 2, 110, 18, '#aaa');
  rrect(ctx, 130, 130, 700, 460, 12); fs(ctx, 'rgba(0,0,0,.75)', 3, '#fff');
  text('KEY 1', 520, 156, 15, '#888'); text('KEY 2', 700, 156, 15, '#888');
  ACTIONS.forEach(([a, label], i) => {
    const y = 192 + i * 46, on = setSel === i;
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
  const ry = 192 + ACTIONS.length * 46;
  text((setSel === ACTIONS.length ? '▶ ' : '') + 'RESET TO DEFAULTS', W / 2, ry, 20, setSel === ACTIONS.length ? '#ffd23f' : '#ccc');
  text((setSel === ACTIONS.length + 1 ? '▶ ' : '') + 'BACK', W / 2, ry + 36, 20, setSel === ACTIONS.length + 1 ? '#ffd23f' : '#ccc');
  text(rebind ? 'Press the new key  (ESC cancels)' : '↑ ↓ choose   ← → key slot   ENTER change   ESC back', W / 2, 630, 17, '#fff');
  text('Menus always use the arrow keys, ENTER and ESC, so you cannot lock yourself out.', W / 2, 660, 13, '#888');
}

function renderSelect() {
  drawBG(BOSSES[sel], gT);
  text('CHOOSE YOUR DOOM', W / 2, 52, 50, '#fff', 'center', true, 8);
  const cw = 168, gap = 14, x0 = (W - (cw * 5 + gap * 4)) / 2;
  for (let i = 0; i < 5; i++) {
    const d = BOSSES[i], x = x0 + i * (cw + gap), locked = i >= save.unlocked, on = i === sel;
    const y = 100 + (on ? Math.sin(gT * 5) * 5 - 8 : 0);
    rrect(ctx, x, y, cw, 400, 12); fs(ctx, on ? 'rgba(40,30,10,.9)' : 'rgba(0,0,0,.7)', on ? 5 : 3, on ? '#ffd23f' : '#666');
    drawBossAt(d, { t: gT + i, phase: 0, flash: 0, mouth: 0, lx: 0, ly: 0.5 }, x + cw / 2, y + 115, 0.42, locked);
    text('LEVEL ' + (i + 1), x + cw / 2, y + 20, 15, '#aaa');
    if (locked) {
      text('?', x + cw / 2, y + 112, 60, '#555', 'center', true);
      text('LOCKED', x + cw / 2, y + 230, 18, '#777');
      continue;
    }
    d.name.split(' ').forEach((w, k) => text(w, x + cw / 2, y + 214 + k * 22, 19, '#fff', 'center', false, 3));
    text(d.title, x + cw / 2, y + 262, 11, '#bbb');
    // the squares this boss turns you into
    const n = d.souls.length, sz = n > 6 ? 10 : 14, sp = sz + 4, sx = x + cw / 2 - (Math.min(n, 8) * sp) / 2 + 2;
    d.souls.forEach((k, j) => {
      const cx = sx + (j % 8) * sp, cy = y + 284 + Math.floor(j / 8) * sp;
      ctx.fillStyle = SOULS[k].col; ctx.fillRect(cx, cy, sz, sz);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(cx, cy, sz, sz);
    });
    const best = save.best[i];
    if (best) {
      drawMedal(x + cw / 2, y + 338, 18, best.medal);
      text(MEDALS[best.medal].name + '  ·  ' + best.hp + ' HP', x + cw / 2, y + 376, 13, MEDALS[best.medal].col);
    } else text('NOT BEATEN', x + cw / 2, y + 350, 14, '#888');
  }
  const d = BOSSES[sel];
  if (sel < save.unlocked) text('Survive ' + d.dur + ' seconds  ·  ' + d.souls.length + ' kinds of square', W / 2, 532, 15, '#ccc');
  else text('Beat the previous boss to unlock.', W / 2, 532, 15, '#ccc');
  const di = diffInfo(save.hp);
  text('DIFFICULTY', W / 2, 560, 13, '#999');
  text((save.hp > 1 ? '▼ ' : '   ') + di.name + (save.hp < 15 ? ' ▲' : '   '), W / 2, 584, 24, di.col, 'center', true, 5);
  const pw = 14, px0 = W / 2 - (15 * (pw + 4)) / 2;
  for (let i = 0; i < 15; i++) {
    ctx.fillStyle = i < save.hp ? di.col : '#333';
    ctx.fillRect(px0 + i * (pw + 4), 604, pw, 10);
  }
  text(save.hp === 1 ? 'one hit and you are dead' : 'you can take ' + save.hp + ' hits', W / 2, 628, 13, '#bbb');
  text('← → choose   ↑ ↓ difficulty   ENTER fight   ESC back', W / 2, 656, 17, '#fff');
  text(MEDAL_RULES + '     U = unlock all', W / 2, 682, 12, '#888');
  if (save.beatAll) text('★ YOU BEAT THE HARD GAME ★', W / 2, 706, 16, '#ffd23f', 'center', true, 4);
}

function renderPause() {
  renderFight();
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
  text('PAUSED', W / 2, 300, 64, '#fff', 'center', true, 8);
  text('ENTER / ' + keyList('pause') + '  resume      Q  quit to boss select', W / 2, 380, 18, '#ccc');
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
  text(diffInfo(F.p.max).name + '  ·  ' + F.p.max + ' HP', W / 2, 310, 14, '#777');
  const x1 = 260, x2 = 700, ly = 370, prog = clamp(F.surv / F.def.dur, 0, 1);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(x1, ly); ctx.lineTo(x2, ly); ctx.stroke(); ctx.setLineDash([]);
  for (const f of [1 / 3, 2 / 3]) { ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x1 + (x2 - x1) * f, ly, 6, 0, TAU); ctx.fill(); }
  drawBossAt(F.def, { t: gT, phase: F.phase, flash: 0, mouth: 0, lx: -1, ly: 0 }, x2 + 10, ly - 4, 0.22);
  const px = x1 + (x2 - x1) * prog;
  ctx.fillStyle = SOULS[F.soul].col; ctx.fillRect(px - 9, ly - 9, 18, 18);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(px - 9, ly - 9, 18, 18);
  text('survived ' + fmtTime(F.surv) + ' of ' + fmtTime(F.def.dur), W / 2, 410, 18, '#333');
  text('ENTER  RETRY', W / 2 - 120, 480, 22, '#000');
  text('ESC  QUIT', W / 2 + 120, 480, 22, '#000');
}

function renderResults() {
  renderFight();
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
  const f = F, r = f.result, m = MEDALS[r.medal];
  rrect(ctx, 220, 100, 520, 500, 14); fs(ctx, '#f3ead2', 6, '#000');
  text('YOU SURVIVED!', W / 2, 148, 46, '#000', 'center', true);
  text(f.def.name + '  ·  ' + diffInfo(f.p.max).name + ' (' + f.p.max + ' HP)', W / 2, 192, 15, '#555');
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
  if (r.newUnlock) text('NEW BOSS UNLOCKED!', W / 2, 545, 18, '#2a7a2a');
  if (f.idx === 4) text('YOU BEAT THE HARD GAME!', W / 2, 545, 20, '#c62828', 'center', true);
  if (f.resT > 0.8 && Math.floor(gT * 2.5) % 2) text('PRESS ENTER', W / 2, 578, 16, '#000');
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  switch (state) {
    case 'title': renderTitle(); break;
    case 'settings': renderSettings(); break;
    case 'select': renderSelect(); break;
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
