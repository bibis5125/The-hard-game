'use strict';
// SQUAREHEAD — an Undertale-style bullet box crossed with Cuphead-style boss fights.
// You are a square. Dodge, shoot, parry, dash. The rules keep changing.

const W = 960, H = 720, TAU = Math.PI * 2;
const BOX_CX = 480, BOX_CY = 505;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = W * s + 'px';
  cv.style.height = H * s + 'px';
}
addEventListener('resize', fit);
fit();

// ---------------------------------------------------------------- utils
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const chance = p => Math.random() < p;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
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

// ---------------------------------------------------------------- input
const keys = {}, pressed = {};
const BIND = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  shoot: ['KeyZ', 'KeyJ'], parry: ['KeyX', 'KeyK'],
  dash: ['ShiftLeft', 'ShiftRight', 'KeyC'], jump: ['Space'],
  super: ['KeyV', 'KeyL'],
  confirm: ['KeyZ', 'Enter', 'Space'], back: ['Escape', 'KeyX'],
  pause: ['Escape', 'KeyP'], quit: ['KeyQ'], mute: ['KeyM'], unlock: ['KeyU'],
};
const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
addEventListener('keydown', e => {
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  if (PREVENT.has(e.code)) e.preventDefault();
  audio.init();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  if (state === 'fight') pauseGame();
});
const held = a => BIND[a].some(c => keys[c]);
const tap = a => BIND[a].some(c => pressed[c]);

// ---------------------------------------------------------------- audio
const audio = {
  ac: null, master: null, noiseBuf: null, muted: false,
  init() {
    if (!this.ac) {
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ac.createGain();
        this.master.gain.value = 0.7;
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
};

let lastBossHitSfx = 0;
const sfx = {
  shoot() { audio.tone(rand(720, 820), 0.035, 'square', 0.01, 0.6); },
  bossHit() {
    const n = audio.now();
    if (n - lastBossHitSfx < 0.07) return;
    lastBossHitSfx = n;
    audio.tone(160, 0.04, 'square', 0.025, 0.7);
  },
  hurt() { audio.tone(320, 0.3, 'sawtooth', 0.12, 0.25); audio.noise(0.25, 0.15); },
  parry() { audio.tone(880, 0.08, 'triangle', 0.15); audio.tone(1320, 0.2, 'triangle', 0.12, 1.5, audio.now() + 0.06); },
  dash() { audio.noise(0.12, 0.06, 1500); },
  jump() { audio.tone(260, 0.1, 'square', 0.035, 2); },
  fire() { audio.tone(240, 0.08, 'sawtooth', 0.03, 0.5); },
  pop() { audio.tone(520, 0.06, 'square', 0.03, 0.4); },
  laser() { audio.tone(110, 0.35, 'sawtooth', 0.05, 0.5); },
  warn() { audio.tone(1040, 0.04, 'square', 0.025); },
  mod() { audio.tone(523, 0.08, 'square', 0.06); audio.tone(784, 0.14, 'square', 0.06, 1, audio.now() + 0.08); },
  boom() { audio.noise(0.7, 0.25); audio.tone(90, 0.7, 'sine', 0.3, 0.3); },
  superFx() { audio.tone(140, 0.8, 'sawtooth', 0.1, 4); audio.noise(0.8, 0.2, 400); },
  select() { audio.tone(660, 0.05, 'square', 0.04); },
  confirm() { audio.tone(660, 0.06, 'square', 0.05); audio.tone(990, 0.1, 'square', 0.05, 1, audio.now() + 0.06); },
  text() { audio.tone(rand(380, 440), 0.03, 'square', 0.02); },
  shatter() { audio.tone(700, 0.15, 'square', 0.08, 0.5); audio.noise(0.3, 0.12, 2000); },
  ko() { audio.tone(392, 0.15, 'square', 0.08); audio.tone(523, 0.15, 'square', 0.08, 1, audio.now() + 0.15); audio.tone(784, 0.4, 'square', 0.08, 1, audio.now() + 0.3); },
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
      const rate = (F ? F.timeScale : 1) * (F ? 1 + 0.07 * F.phase : 1);
      this.next += 60 / (this.def.bpm * rate) / 4;
      this.step = (this.step + 1) % 32;
    }
  },
  play(s, t) {
    const d = this.def;
    const n = d.bass[s % d.bass.length];
    if (n !== null) audio.tone(d.root * Math.pow(2, n / 12), 0.11, 'square', 0.03, 1, t);
    if (s % 4 === 0) audio.tone(150, 0.12, 'sine', 0.22, 0.25, t);
    if (s % 4 === 2) audio.noise(0.04, 0.04, 6000, t);
    if (s % 8 === 4) audio.noise(0.09, 0.06, 1200, t);
  },
};

// ---------------------------------------------------------------- save
const SAVE_KEY = 'squarehead-save-v1';
let save = { unlocked: 1, best: {}, hp: 4 };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && s.unlocked) save = s;
} catch (e) { /* storage unavailable */ }
if (!(save.hp >= 1 && save.hp <= 15)) save.hp = 4;
// difficulty = how many hits you can take (1..15)
function diffInfo(hp) {
  if (hp === 1) return { name: 'ONE HIT = DEATH', col: '#ff2a2a' };
  if (hp <= 3) return { name: 'NIGHTMARE', col: '#ff5a3a' };
  if (hp <= 5) return { name: 'HARD', col: '#ffb030' };
  if (hp <= 8) return { name: 'NORMAL', col: '#ffe14d' };
  if (hp <= 11) return { name: 'EASY', col: '#8fe86a' };
  return { name: 'CASUAL', col: '#6ad0ff' };
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- modifiers
const MODS = {
  slowmo:   { name: 'SLOW-MO',        col: '#6cf', grp: 'time', fx: m => { m.time = 0.5; } },
  fast:     { name: 'FAST FORWARD',   col: '#f84', grp: 'time', fx: m => { m.time = 1.5; } },
  gravity:  { name: 'GRAVITY ↓',      col: '#39f', grp: 'grav', fx: m => { m.grav = { x: 0, y: 1 }; } },
  antigrav: { name: 'ANTI-GRAVITY ↑', col: '#39f', grp: 'grav', fx: m => { m.grav = { x: 0, y: -1 }; } },
  gravL:    { name: 'GRAVITY ←',      col: '#39f', grp: 'grav', fx: m => { m.grav = { x: -1, y: 0 }; } },
  gravR:    { name: 'GRAVITY →',      col: '#39f', grp: 'grav', fx: m => { m.grav = { x: 1, y: 0 }; } },
  reverse:  { name: 'REVERSED',       col: '#c6f', fx: m => { m.reverse = true; } },
  ice:      { name: 'ICE',            col: '#aff', fx: m => { m.ice = true; } },
  tiny:     { name: 'TINY BOX',       col: '#ff6', fx: m => { m.box = 0.7; } },
  heavy:    { name: 'HEAVY SOUL',     col: '#c96', grp: 'spd', fx: m => { m.spd = 0.6; } },
  hyper:    { name: 'HYPER SOUL',     col: '#f6f', grp: 'spd', fx: m => { m.spd = 1.7; } },
  big:      { name: 'BIG SOUL',       col: '#f66', fx: m => { m.size = 1.8; } },
  dark:     { name: 'LIGHTS OUT',     col: '#999', fx: m => { m.dark = true; } },
};
const baseM = () => ({ time: 1, grav: null, reverse: false, ice: false, box: 1, spd: 1, size: 1, dark: false });

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

// ---------------------------------------------------------------- bosses
const _ = null;
const BOSSES = [
  {
    name: 'CUBERT', title: 'THE BLOCK KING', hp: 420, r: 80, par: 75,
    bullet: '#ffd23f', laser: '#ffe680', bg: ['#3a1c0c', '#120804'], ray: '#ffb347',
    intro: '* CUBERT THE BLOCK KING blocks the way!\n* He thinks every square should bow\n  to his crown.',
    lines: ['', 'You dare scratch the CROWN?!', 'OFF WITH YOUR CORNERS!!'],
    pools: [
      ['rain', 'aimed', 'boneWall'],
      ['rain', 'aimed', 'boneWall', 'boneFloor', 'ringBurst'],
      ['boneWall', 'ringBurst', 'laserSweep', 'crossfire', 'boneFloor', 'aimed'],
    ],
    double: [0, 0, 0.12],
    mods: { iv: 5, first: 4, count: [1, 1, 1], pool: ['slowmo', 'fast', 'gravity', 'antigrav', 'reverse', 'ice'] },
    move: { amp: [120, 170, 220], spd: [0.6, 0.8, 1.0] },
    music: { root: 65.41, bpm: 160, bass: [0, _, 12, _, 0, _, 10, _, 7, _, 12, _, 3, _, 5, 6, 0, _, 12, _, 0, _, 10, _, 3, _, 5, _, 7, _, 10, _] },
    draw: drawCubert,
  },
  {
    name: 'MADAME VORTEX', title: 'THE SPIRAL WITCH', hp: 520, r: 74, par: 85,
    bullet: '#c18bff', laser: '#e9c8ff', bg: ['#1f0b3a', '#08020f'], ray: '#b07cff',
    intro: '* MADAME VORTEX swirls into view!\n* Your head is already spinning.',
    lines: ['', 'Round and round we go~!', 'LET THE WHOLE WORLD SPIN!!'],
    pools: [
      ['spiral', 'ringBurst', 'homing', 'aimed'],
      ['spiral', 'bouncers', 'homing', 'closingRing', 'ringBurst'],
      ['spiral', 'bouncers', 'closingRing', 'laserSweep', 'homing'],
    ],
    double: [0, 0, 0.2],
    mods: { iv: 4.5, first: 3, count: [1, 1, 2], pool: ['slowmo', 'fast', 'gravity', 'antigrav', 'reverse', 'ice', 'tiny', 'heavy'] },
    move: { amp: [150, 190, 230], spd: [0.7, 0.9, 1.1] },
    music: { root: 73.42, bpm: 170, bass: [0, _, 0, 12, _, 0, 3, _, 5, _, 5, 17, _, 5, 3, _, 0, _, 0, 12, _, 0, 3, _, 7, _, 6, _, 5, _, 3, _] },
    draw: drawVortex,
  },
  {
    name: 'SAWBONES', title: 'THE GRINNING GRINDER', hp: 620, r: 72, par: 95,
    bullet: '#efe8d2', laser: '#ff5a48', bg: ['#2a0d0d', '#0a0303'], ray: '#ff6a4d',
    intro: '* SAWBONES rattles in, blades screaming!\n* Smells like rust and bad decisions.',
    lines: ['', "Heh. You're still in one piece?", 'TIME TO CUT CORNERS. ALL FOUR!'],
    pools: [
      ['saws', 'boneFloor', 'sniper', 'aimed'],
      ['saws', 'boneWall', 'crossfire', 'sniper', 'boneFloor'],
      ['saws', 'boneWall', 'sniper', 'zones', 'bouncers', 'boneFloor'],
    ],
    double: [0, 0.15, 0.3],
    mods: { iv: 4, first: 3, count: [1, 2, 2], pool: ['slowmo', 'fast', 'gravity', 'antigrav', 'gravL', 'gravR', 'reverse', 'ice', 'tiny', 'big', 'hyper', 'heavy'] },
    move: { amp: [160, 200, 240], spd: [0.8, 1.0, 1.2] },
    music: { root: 55, bpm: 180, bass: [0, 0, _, 0, 12, _, 0, _, 3, 3, _, 3, 15, _, 3, _, 5, 5, _, 5, 17, _, 5, _, 6, _, 7, _, 10, _, 12, _] },
    draw: drawSawbones,
  },
  {
    name: 'TICK-TOCK TYRANT', title: 'KEEPER OF LOST SECONDS', hp: 720, r: 82, par: 105,
    bullet: '#ffe08a', laser: '#ffd34d', bg: ['#0c1f2a', '#02080c'], ray: '#7fd8ff',
    intro: '* The TICK-TOCK TYRANT winds himself up.\n* You are running out of time.',
    lines: ['', 'Tick... tock... TICK... TOCK!', 'YOUR TIME IS UP, SQUARE!'],
    pools: [
      ['clockHands', 'sniper', 'rain', 'laserGrid'],
      ['clockHands', 'laserGrid', 'sniper', 'crossfire', 'ringBurst'],
      ['clockHands', 'laserGrid', 'laserSweep', 'closingRing', 'zones', 'sniper'],
    ],
    double: [0, 0.2, 0.4],
    mods: { iv: 3.5, first: 3, count: [2, 2, 2], pool: ['slowmo', 'fast', 'slowmo', 'fast', 'gravity', 'antigrav', 'gravL', 'gravR', 'reverse', 'ice', 'tiny', 'heavy', 'hyper', 'dark'] },
    move: { amp: [170, 210, 250], spd: [0.9, 1.1, 1.3] },
    music: { root: 61.74, bpm: 150, bass: [0, _, 7, _, 12, _, 7, _, 0, _, 7, _, 12, _, 7, _, 5, _, 12, _, 17, _, 12, _, 3, _, 10, _, 15, _, 10, _] },
    draw: drawTick,
  },
  {
    name: 'THE NULL', title: 'ERROR: ENTITY NOT FOUND', hp: 900, r: 80, par: 125,
    bullet: '#ffffff', laser: '#ff2a6d', bg: ['#0a0a0a', '#000000'], ray: '#ffffff', glitch: true,
    intro: '* THE NULL fills the room.\n* ...\n* It is just you and the void now.',
    lines: ['', 'Y O U   S H O U L D N T   B E   H E R E', 'D E L E T E   D E L E T E   D E L E T E'],
    pools: [
      ['laserGrid', 'spiral', 'saws', 'homing', 'zones'],
      ['laserGrid', 'spiral', 'saws', 'homing', 'zones', 'boneWall', 'closingRing', 'sniper'],
      ['laserGrid', 'spiral', 'saws', 'homing', 'zones', 'boneWall', 'closingRing', 'sniper', 'clockHands', 'laserSweep', 'bouncers', 'crossfire'],
    ],
    double: [0, 0.3, 0.55],
    mods: { iv: 3, first: 2.5, count: [2, 2, 3], pool: Object.keys(MODS) },
    move: { amp: [180, 220, 260], spd: [1.0, 1.2, 1.5] },
    music: { root: 49, bpm: 190, bass: [0, 0, 12, 0, 0, 12, 0, 13, 0, 0, 12, 0, 15, 13, 12, 10, 0, 0, 12, 0, 0, 12, 0, 13, 7, 7, 6, 6, 5, 5, 3, 1] },
    draw: drawNull,
  },
];

// ---------------------------------------------------------------- global state
let state = 'title';
let F = null;        // current fight
let sel = 0;         // selected boss on select screen
let gT = 0;          // global clock

// ---------------------------------------------------------------- fight helpers (used by attacks)
function at(d, fn) { F.sched.push({ t: F.wt + d, fn }); }
function rep(n, iv, fn, d0 = 0) { for (let i = 0; i < n; i++) at(d0 + i * iv, () => fn(i)); return d0 + n * iv; }
function setBox(w, h) { F.box.tw = w; F.box.th = h; }
function orb(x, y, vx, vy, o = {}) {
  const b = Object.assign({ type: 'orb', x, y, vx, vy, r: 7, t: 0, col: F.def.bullet, pink: false }, o);
  F.bullets.push(b);
  return b;
}
function laser(o) {
  const b = Object.assign({ type: 'laser', x: 0, y: 0, ang: 0, len: 1800, w: 16, warn: 0.7, active: 0.5, rot: 0, t: 0, col: F.def.laser }, o);
  if (b.follow) { b.ox = b.x - F.boss.x; b.oy = b.y - F.boss.y; }
  F.bullets.push(b);
  if (!o.silent) sfx.warn();
  return b;
}
function aimAt(x, y) { return Math.atan2(F.p.y - y, F.p.x - x); }
function mark(x, y, life) { fx({ kind: 'mark', x, y, life, sz: 18, col: '#f44' }); }
// gap position for walls that stays reachable while gravity is on
function gapFrac(o) {
  const g = F.M.grav;
  if (g) {
    const along = o === 'v' ? g.y : g.x;
    if (along > 0) return rand(0.58, 0.8);
    if (along < 0) return rand(0.2, 0.42);
  }
  return rand(0.22, 0.78);
}

// ---------------------------------------------------------------- attacks
// each attack schedules its own bullets and returns its duration (world seconds)
const ATK = {
  rain() {
    setBox(360, 230);
    const n = Math.round(22 * F.D), iv = 0.12 / F.D;
    rep(n, iv, () => {
      const B = F.B;
      orb(rand(B.l + 6, B.r - 6), B.t - 40, rand(-30, 30), rand(230, 300) * F.S, { r: 7, pink: chance(0.12) });
    });
    return n * iv + 0.9;
  },
  aimed() {
    setBox(320, 240);
    const v = randi(4, 6), iv = 0.55 / F.S;
    const k = 2 + Math.min(2, F.phase + (F.idx > 2 ? 1 : 0));
    rep(v, iv, () => {
      const bx = F.boss.x, by = F.boss.y + 50, a = aimAt(bx, by);
      for (let j = -k; j <= k; j++) {
        const aa = a + j * 0.13;
        orb(bx, by, Math.cos(aa) * 330 * F.S, Math.sin(aa) * 330 * F.S, { r: 8, pink: j === 0 && chance(0.4) });
      }
      F.boss.mouth = 0.25; sfx.fire();
    });
    return v * iv + 0.7;
  },
  boneWall() {
    setBox(400, 220);
    const n = Math.round(4 + 2.5 * F.D), iv = 0.8 / F.D;
    rep(n, iv, () => {
      const B = F.B, horiz = chance(F.idx >= 2 ? 0.4 : 0), dir = chance(0.5) ? 1 : -1;
      const sp = (200 + 30 * F.idx) * F.S;
      if (!horiz) F.bullets.push({ type: 'wall', o: 'v', pos: dir > 0 ? B.l - 16 : B.r + 2, th: 14, v: dir * sp, gc: gapFrac('v'), gh: 64, t: 0, clip: true });
      else F.bullets.push({ type: 'wall', o: 'h', pos: dir > 0 ? B.t - 16 : B.b + 2, th: 14, v: dir * sp * 0.8, gc: gapFrac('h'), gh: 70, t: 0, clip: true });
    });
    return n * iv + 1.6;
  },
  boneFloor() {
    setBox(440, 190);
    const n = Math.round(7 + 3 * F.D), iv = 0.55 / F.D, dir = chance(0.5) ? 1 : -1;
    rep(n, iv, () => {
      const B = F.B, g = F.M.grav;
      const flip = g && g.y < 0, sideways = g && g.x !== 0;
      const long = !sideways && chance(0.35);
      const floor = flip ? 'top' : 'bottom', ceil = flip ? 'bottom' : 'top';
      F.bullets.push({
        type: 'bone', x: dir > 0 ? B.l - 14 : B.r + 2, w: 12, vx: dir * (230 + 25 * F.idx) * F.S,
        anchor: long ? ceil : floor, hf: long ? rand(0.6, 0.66) : rand(0.16, 0.3), t: 0, clip: true,
      });
    });
    return n * iv + 2;
  },
  ringBurst() {
    setBox(340, 260);
    const n = Math.round(3 + 2 * F.D), iv = 0.7 / F.D;
    rep(n, iv, () => {
      const B = F.B, x = rand(B.l + 30, B.r - 30), y = rand(B.t + 30, B.b - 30);
      mark(x, y, 0.5);
      at(0.5, () => {
        const k = Math.round(10 + 4 * F.D), off = Math.random() * TAU;
        for (let j = 0; j < k; j++) {
          const a = off + (j / k) * TAU;
          orb(x, y, Math.cos(a) * 170 * F.S, Math.sin(a) * 170 * F.S, { r: 6, pink: j === 0 && chance(0.35) });
        }
        sfx.pop();
      });
    });
    return n * iv + 1.4;
  },
  spiral() {
    setBox(340, 280);
    const arms = 2 + Math.min(3, F.phase + (F.idx > 3 ? 1 : 0));
    const dur = 4, iv = 0.11 / Math.sqrt(F.D), n = Math.floor(dur / iv);
    const spin = (1.6 + 0.4 * F.phase) * (chance(0.5) ? 1 : -1);
    mark(BOX_CX, BOX_CY, 0.6);
    rep(n, iv, i => {
      const base = i * iv * spin;
      for (let a = 0; a < arms; a++) {
        const ang = base + (a / arms) * TAU;
        orb(F.B.cx, F.B.cy, Math.cos(ang) * 150 * F.S, Math.sin(ang) * 150 * F.S, { r: 6, pink: chance(0.03) });
      }
    }, 0.6);
    return 0.6 + dur + 0.8;
  },
  bouncers() {
    setBox(360, 260);
    const n = Math.round(3 + 2 * F.D);
    rep(n, 0.35, () => {
      const B = F.B, side = randi(0, 3);
      let x, y, a;
      if (side === 0) { x = rand(B.l, B.r); y = B.t + 12; a = rand(0.3, 2.8); }
      else if (side === 1) { x = rand(B.l, B.r); y = B.b - 12; a = -rand(0.3, 2.8); }
      else if (side === 2) { x = B.l + 12; y = rand(B.t, B.b); a = rand(-1.2, 1.2); }
      else { x = B.r - 12; y = rand(B.t, B.b); a = Math.PI + rand(-1.2, 1.2); }
      orb(x, y, Math.cos(a) * 220 * F.S, Math.sin(a) * 220 * F.S, { r: 11, bounce: 4, life: 6, pink: chance(0.15) });
      sfx.pop();
    });
    return n * 0.35 + 3.5;
  },
  homing() {
    setBox(380, 260);
    const n = Math.round(3 + 1.5 * F.D), iv = 0.5 / F.S;
    rep(n, iv, () => {
      orb(F.boss.x + rand(-40, 40), F.boss.y + 30, rand(-150, 150), 220 * F.S, {
        r: 9, homing: 2.4 * F.S, homeTime: 2.2, life: 4.5, spd: 230 * F.S, pink: chance(0.3), missile: true,
      });
      F.boss.mouth = 0.2; sfx.fire();
    });
    return n * iv + 2.5;
  },
  laserSweep() {
    setBox(360, 220);
    const n = 1 + (F.phase >= 2 ? 1 : 0);
    rep(n, 2.6, () => {
      const bx = F.boss.x, by = F.boss.y + 30, B = F.B;
      const aL = Math.atan2(B.b - by, B.l - 30 - bx), aR = Math.atan2(B.b - by, B.r + 30 - bx);
      const left = chance(0.5), a0 = left ? aL : aR, a1 = left ? aR : aL;
      const act = 1.3 / F.S;
      laser({ x: bx, y: by, ang: a0, rot: (a1 - a0) / act, warn: 0.8, active: act, w: 18, follow: true });
      F.boss.mouth = 1;
    });
    return n * 2.6 + 0.4;
  },
  laserGrid() {
    setBox(300, 300);
    const waves = Math.round(2 + F.D), iv = 1.15 / F.S;
    rep(waves, iv, () => {
      const lanes = 5, safeR = randi(0, lanes - 1), safeC = randi(0, lanes - 1);
      const w = (300 / lanes) * 0.62;
      for (let i = 0; i < lanes; i++) {
        const f = (i + 0.5) / lanes;
        if (i !== safeR && chance(0.75)) laser({ rel: true, fx: 0, fy: f, ang: 0, warn: 0.85, active: 0.35, w, clip: true, silent: true });
        if (i !== safeC && chance(0.75)) laser({ rel: true, fx: f, fy: 0, ang: Math.PI / 2, warn: 0.85, active: 0.35, w, clip: true, silent: true });
      }
      sfx.warn();
    });
    return waves * iv + 0.8;
  },
  sniper() {
    setBox(340, 240);
    const n = Math.round(3 + F.D), iv = 0.9 / F.S;
    rep(n, iv, () => {
      laser({ x: F.boss.x, y: F.boss.y + 30, follow: true, track: 0.5, warn: 0.75, active: 0.15, w: 14 });
    });
    return n * iv + 1;
  },
  crossfire() {
    setBox(380, 240);
    const n = Math.round(10 + 6 * F.D), iv = 0.22 / F.D;
    rep(n, iv, i => {
      const B = F.B, left = i % 2 === 0;
      const y = clamp(F.p.y + rand(-50, 50), B.t + 6, B.b - 6);
      orb(left ? B.l - 14 : B.r + 14, y, (left ? 1 : -1) * 300 * F.S, 0, { r: 7, pink: chance(0.12) });
    });
    return n * iv + 1.2;
  },
  saws() {
    setBox(420, 200);
    const n = Math.round(3 + F.D), iv = 1.0 / F.S;
    rep(n, iv, () => {
      const B = F.B, dir = chance(0.5) ? 1 : -1;
      F.bullets.push({
        type: 'saw', x: dir > 0 ? B.l - 30 : B.r + 30, y: 0, anchor: chance(0.5) ? 'floor' : 'ceil',
        r: 26, vx: dir * rand(200, 280) * F.S, vy: 0, t: 0, spin: dir * 12,
      });
      if (F.phase >= 1 && chance(0.45)) {
        const a = rand(0.5, 2.6);
        F.bullets.push({ type: 'saw', x: rand(B.l + 40, B.r - 40), y: B.t + 20, r: 18, vx: Math.cos(a) * 200 * F.S, vy: Math.sin(a) * 200 * F.S, t: 0, spin: 14, bounce: 3, life: 5 });
      }
    });
    return n * iv + 2;
  },
  closingRing() {
    setBox(300, 300);
    const waves = Math.round(2 + F.D * 0.8), iv = 1.5 / F.S;
    rep(waves, iv, () => {
      const cx = F.B.cx, cy = F.B.cy, R = 280, k = 36, gap = randi(0, k - 1), sp = 150 * F.S;
      for (let j = 0; j < k; j++) {
        if ((j - gap + k) % k < 3) continue;
        const a = (j / k) * TAU;
        orb(cx + Math.cos(a) * R, cy + Math.sin(a) * R, -Math.cos(a) * sp, -Math.sin(a) * sp, { r: 7, life: (R * 2) / sp, pink: j === (gap + 4) % k && chance(0.5) });
      }
      sfx.pop();
    });
    return waves * iv + 1.6;
  },
  clockHands() {
    setBox(320, 320);
    const dur = 4.5, spin = (1.0 + 0.3 * F.phase) * F.S, dir = chance(0.5) ? 1 : -1, a0 = rand(0, TAU);
    laser({ rel: true, fx: 0.5, fy: 0.5, ang: a0, rot: spin * dir, warn: 0.9, active: dur, w: 14, clip: true });
    if (F.phase >= 1 || F.idx === 4) laser({ rel: true, fx: 0.5, fy: 0.5, ang: a0 + Math.PI, rot: -spin * dir * 0.7, warn: 0.9, active: dur, w: 10, clip: true, silent: true });
    if (F.phase >= 2) rep(8, 0.5, () => {
      const B = F.B;
      orb(rand(B.l, B.r), B.t - 30, 0, 220 * F.S, { r: 7, pink: chance(0.2) });
    }, 1);
    return dur + 1.3;
  },
  zones() {
    setBox(360, 260);
    const waves = Math.round(3 + F.D), iv = 0.8 / F.S;
    rep(waves, iv, () => {
      const cols = 4, rows = 3, safe = randi(0, cols * rows - 1);
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        if (r * cols + c === safe || !chance(0.5)) continue;
        F.bullets.push({ type: 'zone', fx: c / cols, fy: r / rows, fw: 1 / cols, fh: 1 / rows, warn: 0.7, active: 0.4, t: 0, clip: true });
      }
      sfx.warn();
    });
    return waves * iv + 1.3;
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
  return { x: BOX_CX, y: BOX_CY, vx: 0, vy: 0, hp: save.hp, max: save.hp, inv: 0, dashT: 0, dashCD: 0, dx: 0, dy: -1,
    parryT: 0, parryCD: 0, fireCD: 0, ex: 0, grounded: false, coyote: 0, jumpBuf: 0, jumpHeld: false };
}

function startFight(idx) {
  const def = BOSSES[idx];
  F = {
    idx, def, hp: def.hp, max: def.hp, phase: 0, stage: 'text', textT: 0, stageT: 0, rt: 0, wt: 0, time: 0,
    bullets: [], shots: [], fx: [], sched: [],
    box: { w: 640, h: 150, tw: 640, th: 150 }, B: null,
    boss: { x: BOX_CX, y: 175, t: 0, flash: 0, inv: 0, mouth: 0, lx: 0, ly: 1 },
    p: newPlayer(), mods: [], M: baseM(), nextMods: null, modT: def.mods.first, modMax: def.mods.first, timeScale: 1,
    nextAtk: 0, lastAtk: null, stats: { hits: 0, parries: 0, supers: 0 },
    shake: 0, hitstop: 0, flash: 0, banner: null, speech: null, superFx: null, koT: 0, deadT: 0, resT: 0,
  };
  setDS();
  computeBox();
  state = 'fight';
}
function setDS() {
  // D = bullet density, S = bullet speed
  F.D = 0.85 * (1 + 0.13 * F.idx + 0.22 * F.phase);
  F.S = 0.9 * (1 + 0.06 * F.idx + 0.11 * F.phase);
}
function computeBox(dt) {
  const b = F.box, k = dt === undefined ? 1 : Math.min(1, dt * 9);
  b.w += (b.tw * F.M.box - b.w) * k;
  b.h += (b.th * F.M.box - b.h) * k;
  F.B = { l: BOX_CX - b.w / 2, r: BOX_CX + b.w / 2, t: BOX_CY - b.h / 2, b: BOX_CY + b.h / 2, w: b.w, h: b.h, cx: BOX_CX, cy: BOX_CY };
}
function beginReady() {
  F.stage = 'ready'; F.stageT = 0;
  setBox(320, 240);
  F.p.x = BOX_CX; F.p.y = BOX_CY;
  music.start(F.def.music);
}
function pauseGame() { state = 'pause'; music.stop(); }

function rollMods() {
  const d = F.def.mods;
  if (F.mods.length && chance(0.12)) return [];
  const max = d.count[F.phase], n = randi(Math.max(1, max - 1), max);
  for (let attempt = 0; attempt < 5; attempt++) {
    const out = [], grps = new Set();
    let tries = 0;
    while (out.length < n && tries++ < 60) {
      const k = pick(d.pool), m = MODS[k];
      if (out.includes(k) || (m.grp && grps.has(m.grp))) continue;
      out.push(k);
      if (m.grp) grps.add(m.grp);
    }
    if (out.slice().sort().join() !== F.mods.slice().sort().join()) return out;
  }
  return [];
}
function applyMods(list) {
  const prevGrav = JSON.stringify(F.M.grav);
  F.mods = list;
  const M = baseM();
  for (const k of list) MODS[k].fx(M);
  F.M = M;
  if (JSON.stringify(M.grav) !== prevGrav) { F.p.vx = 0; F.p.vy = 0; }
  F.banner = { text: list.length ? list.map(k => MODS[k].name).join(' + ') : 'NORMAL', col: list.length ? MODS[list[0]].col : '#fff', t: 0 };
  sfx.mod();
}
function modInterval() { return F.def.mods.iv * (1 - 0.12 * F.phase) * rand(0.85, 1.15); }
function updateMods(dt) {
  F.modT -= dt;
  if (F.modT < 1.1 && !F.nextMods) F.nextMods = rollMods();
  if (F.nextMods && F.modT > 0) {
    const k = Math.ceil(F.modT * 3);
    if (k !== F.warnK) { F.warnK = k; sfx.warn(); }
  }
  if (F.modT <= 0) {
    applyMods(F.nextMods || []);
    F.nextMods = null; F.warnK = null;
    F.modT = F.modMax = modInterval();
  }
}

function clearBullets() {
  for (const b of F.bullets) if (b.type === 'orb' || b.type === 'saw') burst(b.x, b.y, b.pink ? '#ff6ec7' : b.col, 2, 120);
  F.bullets = [];
  F.sched = [];
}

function damageBoss(n) {
  const b = F.boss;
  if (F.stage !== 'fight') return false;
  if (b.inv > 0) return false;
  F.hp -= n;
  b.flash = 0.06;
  F.p.ex = Math.min(1, F.p.ex + 0.0035 * n);
  sfx.bossHit();
  if (F.hp <= 0) { F.hp = 0; knockout(); return true; }
  const th = [0.66, 0.33];
  if (F.phase < 2 && F.hp <= F.max * th[F.phase]) phaseUp();
  return true;
}
function phaseUp() {
  F.phase++;
  setDS();
  clearBullets();
  F.boss.inv = 1.5;
  F.nextAtk = F.wt + 1.7;
  F.speech = { text: F.def.lines[F.phase], t: 0 };
  F.shake = 14; F.flash = 0.3;
  sfx.boom();
  burst(F.boss.x, F.boss.y, '#fff', 30, 400);
}
function knockout() {
  F.stage = 'ko'; F.koT = 0;
  clearBullets();
  music.stop();
  sfx.ko();
  F.shake = 16;
}
function hurt() {
  const p = F.p;
  p.hp--; p.inv = 1.3;
  F.stats.hits++;
  F.shake = 10; F.hitstop = 0.1; F.flash = 0.25;
  sfx.hurt();
  burst(p.x, p.y, '#f33', 14, 260);
  if (p.hp <= 0) { state = 'dead'; F.deadT = 0; F.shattered = false; music.stop(); }
}
function parry(b) {
  const p = F.p;
  b.dead = true;
  p.ex = Math.min(1, p.ex + 0.34);
  p.parryT = 0; p.parryCD = 0; p.inv = Math.max(p.inv, 0.35);
  F.stats.parries++;
  F.hitstop = 0.07;
  sfx.parry();
  fx({ kind: 'ring', x: b.x, y: b.y, col: '#ff6ec7', sz: 6, life: 0.35 });
  fx({ kind: 'txt', x: p.x, y: p.y - 20, vy: -60, col: '#ff6ec7', text: 'PARRY!', life: 0.7 });
}
function doSuper() {
  const p = F.p;
  p.ex = 0;
  F.stats.supers++;
  p.inv = Math.max(p.inv, 1.0);
  F.superFx = { t: 0, x: p.x, y: p.y, hit: false };
  clearBullets();
  F.shake = 12;
  sfx.superFx();
}
function finishFight() {
  const f = F;
  const g = calcGrade(f);
  const newUnlock = f.idx + 2 > save.unlocked && f.idx < 4;
  save.unlocked = Math.max(save.unlocked, Math.min(5, f.idx + 2));
  const best = save.best[f.idx];
  if (!best || GRADES.indexOf(g) > GRADES.indexOf(best.grade) || (g === best.grade && f.time < best.time)) {
    save.best[f.idx] = { grade: g, time: f.time, hp: f.p.max };
  }
  if (f.idx === 4) save.beatAll = true;
  persist();
  f.result = { grade: g, newUnlock };
  f.resT = 0;
  state = 'results';
}
const GRADES = ['C', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S'];
function calcGrade(f) {
  let sc = 0;
  const par = f.def.par;
  if (f.time <= par) sc += 3; else if (f.time <= par * 1.4) sc += 2; else if (f.time <= par * 2) sc += 1;
  sc += [3, 2, 1, 0][Math.min(3, f.stats.hits)];
  sc += Math.min(2, Math.floor(f.stats.parries / 2));
  if (f.stats.supers > 0) sc += 1;
  return GRADES[clamp(sc - 2, 0, 7)];
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
    if (tap('confirm') && f.textT > 0.15) {
      if (now < full) f.textT = full / 45;
      else beginReady();
    } else if (f.textT > full / 45 + 1.8) beginReady();
    computeBox(dt);
    updateBoss(dt);
    return;
  }
  if (f.stage === 'ready') {
    f.stageT += dt;
    if (f.stageT > 1.5) { f.stage = 'fight'; f.nextAtk = f.wt + 0.2; }
  }
  if (f.stage === 'fight') { f.time += dt; updateMods(dt); }
  if (f.stage === 'ko') {
    f.koT += dt;
    if (Math.floor(f.koT * 10) !== Math.floor((f.koT - dt) * 10)) {
      burst(f.boss.x + rand(-80, 80), f.boss.y + rand(-70, 70), pick(['#fff', '#ffd23f', '#f84']), 12, 300);
      if (chance(0.4)) sfx.pop();
    }
    if (f.koT > 3) { finishFight(); return; }
  }
  f.timeScale += (f.M.time - f.timeScale) * Math.min(1, dt * 6);
  const wdt = dt * f.timeScale;
  f.wt += wdt;
  computeBox(dt);
  updateBoss(wdt);
  if (f.stage === 'fight') { runSched(); runAI(); }
  updatePlayer(wdt); // the square speeds up / slows down with the time modifiers too
  if (state !== 'fight') return;
  updateBullets(wdt);
  updateShots(dt);
  updateSuper(dt);
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
function runAI() {
  const f = F;
  if (f.boss.inv > 0 || f.wt < f.nextAtk) return;
  const pool = f.def.pools[f.phase];
  let a = pick(pool);
  if (a === f.lastAtk && pool.length > 1) a = pick(pool.filter(x => x !== f.lastAtk));
  f.lastAtk = a;
  let dur = ATK[a]();
  const dc = f.def.double[f.phase];
  if (dc && chance(dc * 0.75)) {
    const b = pick(pool.filter(x => x !== a));
    dur = Math.max(dur, ATK[b]());
  }
  f.nextAtk = f.wt + dur * 0.88 + 0.15;
}

function updateBoss(dt) {
  const b = F.boss, mv = F.def.move;
  b.t += dt; b.flash -= dt; b.inv -= dt; b.mouth -= dt;
  if (F.stage === 'ko') {
    b.x += rand(-4, 4); b.y += 25 * dt;
  } else {
    const amp = mv.amp[F.phase], sp = mv.spd[F.phase];
    b.x = BOX_CX + Math.sin(b.t * sp) * amp + Math.sin(b.t * sp * 2.3) * amp * 0.2;
    b.y = 175 + Math.sin(b.t * 1.7) * 10;
  }
  const dx = F.p.x - b.x, dy = F.p.y - b.y, l = Math.hypot(dx, dy) || 1;
  b.lx = dx / l; b.ly = dy / l;
}

function updatePlayer(dt) {
  const p = F.p, M = F.M, B = F.B;
  let ix = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  let iy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  if (M.reverse) { ix = -ix; iy = -iy; }
  if (ix || iy) { const l = Math.hypot(ix, iy); p.dx = ix / l; p.dy = iy / l; }
  const spd = 210 * M.spd, ph = 8 * M.size;
  p.inv = Math.max(0, p.inv - dt);
  p.dashCD -= dt; p.parryCD -= dt; p.parryT -= dt; p.fireCD -= dt;

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
    fx({ kind: 'after', x: p.x, y: p.y, sz: ph, col: '#fff', life: 0.2 });
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

  // keep inside the box; touching the wall gravity pulls toward = grounded
  const g = M.grav;
  p.grounded = false;
  if (p.x < B.l + ph) { p.x = B.l + ph; if (p.vx < 0) p.vx = 0; if (g && g.x < 0) p.grounded = true; }
  if (p.x > B.r - ph) { p.x = B.r - ph; if (p.vx > 0) p.vx = 0; if (g && g.x > 0) p.grounded = true; }
  if (p.y < B.t + ph) { p.y = B.t + ph; if (p.vy < 0) p.vy = 0; if (g && g.y < 0) p.grounded = true; }
  if (p.y > B.b - ph) { p.y = B.b - ph; if (p.vy > 0) p.vy = 0; if (g && g.y > 0) p.grounded = true; }
  if (p.grounded) p.coyote = 0.08; else p.coyote -= dt;

  if (F.stage === 'text') return;
  if (held('shoot') && p.fireCD <= 0) {
    p.fireCD = 0.085;
    F.shots.push({ x: p.x + rand(-3, 3), y: p.y - ph, vy: -1150 });
    sfx.shoot();
  }
  if (tap('parry') && p.parryCD <= 0) { p.parryT = 0.2; p.parryCD = 0.4; }
  if (tap('super') && p.ex >= 1 && F.stage === 'fight') doSuper();
}

function boneRect(b, B) {
  const h = b.hf * B.h;
  return { x: b.x, y: b.anchor === 'top' ? B.t : B.b - h, w: b.w, h };
}
function wallRects(b, B) {
  if (b.o === 'v') {
    const gt = B.t + b.gc * B.h - b.gh / 2, gb = gt + b.gh;
    return [{ x: b.pos, y: B.t, w: b.th, h: gt - B.t }, { x: b.pos, y: gb, w: b.th, h: B.b - gb }];
  }
  const gl = B.l + b.gc * B.w - b.gh / 2, gr = gl + b.gh;
  return [{ x: B.l, y: b.pos, w: gl - B.l, h: b.th }, { x: gr, y: b.pos, w: B.r - gr, h: b.th }];
}
function laserSeg(b) {
  let x = b.x, y = b.y;
  if (b.rel) { x = F.B.l + b.fx * F.B.w; y = F.B.t + b.fy * F.B.h; }
  return [x, y, x + Math.cos(b.ang) * b.len, y + Math.sin(b.ang) * b.len];
}
function zoneRect(b, B) { return { x: B.l + b.fx * B.w, y: B.t + b.fy * B.h, w: b.fw * B.w, h: b.fh * B.h }; }

function updateBullets(dt) {
  const B = F.B, p = F.p;
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
      if (b.anchor === 'floor') b.y = B.b - b.r * 0.55;
      else if (b.anchor === 'ceil') b.y = B.t + b.r * 0.55;
      if (b.bounce > 0) {
        if ((b.x < B.l + b.r && b.vx < 0) || (b.x > B.r - b.r && b.vx > 0)) { b.vx *= -1; b.bounce--; }
        if ((b.y < B.t + b.r && b.vy < 0) || (b.y > B.b - b.r && b.vy > 0)) { b.vy *= -1; b.bounce--; }
      }
      if (b.spin) b.a = (b.a || 0) + b.spin * dt;
      if (b.life && b.t > b.life) { b.dead = true; burst(b.x, b.y, b.col, 4, 100); }
      if (b.x < -150 || b.x > W + 150 || b.y < -200 || b.y > H + 150) b.dead = true;
    } else if (b.type === 'bone') {
      b.x += b.vx * dt;
      if ((b.vx > 0 && b.x > B.r + 40) || (b.vx < 0 && b.x + b.w < B.l - 40)) b.dead = true;
    } else if (b.type === 'wall') {
      b.pos += b.v * dt;
      const lo = b.o === 'v' ? B.l : B.t, hi = b.o === 'v' ? B.r : B.b;
      if ((b.v > 0 && b.pos > hi + 40) || (b.v < 0 && b.pos + b.th < lo - 40)) b.dead = true;
    } else if (b.type === 'laser') {
      if (b.follow) { b.x = F.boss.x + b.ox; b.y = F.boss.y + b.oy; }
      if (b.track && b.t < b.track) b.ang = Math.atan2(p.y - b.y, p.x - b.x);
      if (b.t > b.warn) {
        b.ang += b.rot * dt;
        if (!b.fired) { b.fired = true; if (!b.silent) sfx.laser(); F.shake = Math.max(F.shake, 3); }
      }
      if (b.t > b.warn + b.active) b.dead = true;
    } else if (b.type === 'zone') {
      if (b.t > b.warn + b.active) b.dead = true;
    }
  }
  F.bullets = F.bullets.filter(b => !b.dead);
}

function updateShots(dt) {
  const b = F.boss, r = F.def.r;
  for (const s of F.shots) {
    s.y += s.vy * dt;
    if (Math.hypot(s.x - b.x, (s.y - b.y) * 1.1) < r && (F.stage === 'fight' || F.stage === 'ready')) {
      s.dead = true;
      if (damageBoss(1)) fx({ x: s.x, y: s.y + 10, vx: rand(-60, 60), vy: rand(-40, 40), col: '#fff6a0', sz: 5, life: 0.15 });
      else fx({ x: s.x, y: s.y + 10, col: '#777', sz: 4, life: 0.12 });
    }
    if (s.y < -30) s.dead = true;
  }
  F.shots = F.shots.filter(s => !s.dead);
}

function updateSuper(dt) {
  const s = F.superFx;
  if (!s) return;
  s.t += dt;
  s.x = F.p.x;
  if (!s.hit && s.t > 0.12) {
    s.hit = true;
    if (Math.abs(F.boss.x - s.x) < F.def.r + 50) {
      damageBoss(Math.round(F.def.hp * 0.08));
      fx({ kind: 'txt', x: F.boss.x, y: F.boss.y - 60, vy: -50, col: '#ffe14d', text: 'SUPER!', life: 0.9 });
      burst(F.boss.x, F.boss.y, '#ffe14d', 30, 400);
    } else {
      fx({ kind: 'txt', x: s.x, y: 300, vy: -40, col: '#aaa', text: 'MISSED!', life: 0.8 });
    }
  }
  if (s.t > 0.7) F.superFx = null;
}

function collide() {
  const p = F.p, ph = 8 * F.M.size, B = F.B;
  const vuln = p.inv <= 0 && p.dashT <= 0;
  const px = p.x - ph + 2, py = p.y - ph + 2, pw = ph * 2 - 4;
  for (const b of F.bullets) {
    if (b.dead) continue;
    if (b.type === 'orb' || b.type === 'saw') {
      const cx = clamp(b.x, p.x - ph, p.x + ph), cy = clamp(b.y, p.y - ph, p.y + ph);
      const d = Math.hypot(b.x - cx, b.y - cy);
      if (b.pink && p.parryT > 0 && d < b.r + 14) { parry(b); continue; }
      if (vuln && d < b.r * (b.type === 'saw' ? 0.85 : 0.8)) { hurt(); if (b.type === 'orb') b.dead = true; return; }
    } else if (!vuln) {
      continue;
    } else if (b.type === 'bone') {
      const r = boneRect(b, B);
      if (overlap(px, py, pw, pw, r.x, r.y, r.w, r.h)) { hurt(); return; }
    } else if (b.type === 'wall') {
      for (const r of wallRects(b, B)) if (r.w > 0 && r.h > 0 && overlap(px, py, pw, pw, r.x, r.y, r.w, r.h)) { hurt(); return; }
    } else if (b.type === 'laser') {
      if (b.t > b.warn && b.t < b.warn + b.active) {
        const [x1, y1, x2, y2] = laserSeg(b);
        if (segDist(p.x, p.y, x1, y1, x2, y2) < b.w / 2 + ph * 0.7) { hurt(); return; }
      }
    } else if (b.type === 'zone') {
      if (b.t > b.warn) {
        const r = zoneRect(b, B);
        if (overlap(px, py, pw, pw, r.x + 4, r.y + 4, r.w - 8, r.h - 8)) { hurt(); return; }
      }
    }
  }
}

// ---------------------------------------------------------------- main update
function update(dt) {
  gT += dt;
  if (tap('mute')) audio.muted = !audio.muted;
  switch (state) {
    case 'title':
      if (tap('confirm')) { sfx.confirm(); state = 'select'; sel = Math.min(sel, save.unlocked - 1); }
      break;
    case 'select': updateSelect(); break;
    case 'fight': updateFight(dt); break;
    case 'pause':
      if (tap('confirm') || tap('pause')) { state = 'fight'; if (F.stage !== 'text' && F.stage !== 'ko') music.start(F.def.music); }
      else if (tap('quit')) { state = 'select'; }
      break;
    case 'dead':
      F.deadT += dt;
      if (F.deadT > 0.55 && !F.shattered) {
        F.shattered = true;
        sfx.shatter();
        for (let i = 0; i < 7; i++) fx({ kind: 'shard', x: F.p.x, y: F.p.y, vx: rand(-160, 160), vy: rand(-320, -80), col: '#f22', sz: rand(3, 5), life: 1.6 });
      }
      updateFx(dt);
      if (F.deadT > 1.4) {
        if (tap('confirm')) { sfx.confirm(); startFight(F.idx); }
        else if (tap('back')) state = 'select';
      }
      break;
    case 'results':
      F.resT += dt;
      updateFx(dt);
      if (F.resT > 0.8 && tap('confirm')) {
        sfx.confirm();
        state = 'select';
        sel = Math.min(F.idx + 1, save.unlocked - 1);
      }
      break;
  }
}

function updateSelect() {
  if (tap('left')) { sel = (sel + 4) % 5; sfx.select(); }
  if (tap('right')) { sel = (sel + 1) % 5; sfx.select(); }
  if (tap('up') && save.hp < 15) { save.hp++; persist(); sfx.select(); }
  if (tap('down') && save.hp > 1) { save.hp--; persist(); sfx.select(); }
  if (tap('unlock')) { save.unlocked = 5; persist(); sfx.confirm(); }
  if (tap('back')) { state = 'title'; return; }
  if (tap('confirm')) {
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
  ctx.translate(BOX_CX, 175); ctx.rotate(t * 0.08);
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

function soulColor(M) {
  if (M.grav) return '#2a8cff';
  if (M.reverse) return '#c45cff';
  if (M.ice) return '#7ff';
  if (M.spd > 1) return '#ff4fd8';
  if (M.spd < 1) return '#d08a3c';
  return '#ff2424';
}

function drawBullet(b, B) {
  if (b.type === 'orb') {
    const col = b.pink ? '#ff6ec7' : b.col;
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
    if (b.pink && Math.floor(gT * 12) % 2) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, TAU); ctx.stroke();
    }
  } else if (b.type === 'saw') {
    sawShape(ctx, b.x, b.y, b.r, b.a || 0, 12);
  } else if (b.type === 'bone') {
    drawBone(boneRect(b, B), false);
  } else if (b.type === 'wall') {
    for (const r of wallRects(b, B)) if (r.w > 0 && r.h > 0) drawBone(r, b.o === 'h');
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
    } else {
      const k = Math.min(1, (b.t - b.warn) / 0.06) * (b.t > b.warn + b.active - 0.08 ? 0.5 : 1);
      ctx.globalAlpha = 0.45; ctx.strokeStyle = b.col; ctx.lineWidth = (b.w + 14) * k;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = b.w * 0.6 * k;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  } else if (b.type === 'zone') {
    const r = zoneRect(b, B);
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

function drawFx() {
  for (const p of F.fx) {
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = Math.max(0, a);
    if (p.kind === 'sq' || p.kind === 'shard') {
      ctx.fillStyle = p.col; ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = p.col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.sz + (p.t / p.life) * 50, 0, TAU); ctx.stroke();
    } else if (p.kind === 'txt') {
      text(p.text, p.x, p.y, 20, p.col, 'center', true, 4);
    } else if (p.kind === 'after') {
      ctx.globalAlpha = a * 0.5; ctx.strokeStyle = p.col; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - p.sz, p.y - p.sz, p.sz * 2, p.sz * 2);
    } else if (p.kind === 'mark') {
      ctx.globalAlpha = Math.floor(p.t * 14) % 2 ? 1 : 0.4;
      ctx.strokeStyle = p.col; ctx.lineWidth = 2;
      const s = p.sz * (1 - p.t / p.life * 0.5);
      ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU);
      ctx.moveTo(p.x - s - 6, p.y); ctx.lineTo(p.x + s + 6, p.y);
      ctx.moveTo(p.x, p.y - s - 6); ctx.lineTo(p.x, p.y + s + 6);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const p = F.p, ph = 8 * F.M.size;
  if (state === 'dead') {
    if (F.shattered) return;
    ctx.fillStyle = '#f22';
    const gap = F.deadT > 0.25 ? 3 : 0;
    ctx.fillRect(p.x - ph - gap, p.y - ph, ph, ph * 2);
    ctx.fillRect(p.x + gap, p.y - ph, ph, ph * 2);
    return;
  }
  if (p.inv > 0 && p.dashT <= 0 && Math.floor(p.inv * 20) % 2 === 0 && !F.superFx) return;
  ctx.fillStyle = soulColor(F.M);
  ctx.fillRect(p.x - ph, p.y - ph, ph * 2, ph * 2);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.fillRect(p.x - ph + 2, p.y - ph + 2, ph * 0.7, ph * 0.45);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.strokeRect(p.x - ph, p.y - ph, ph * 2, ph * 2);
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
  if (p.parryT > 0) {
    ctx.strokeStyle = '#ff6ec7'; ctx.lineWidth = 3;
    const e = ph + 6 + (0.2 - p.parryT) * 30;
    ctx.strokeRect(p.x - e, p.y - e, e * 2, e * 2);
  }
}

function bossState() {
  const b = F.boss;
  return { t: b.t, phase: F.phase, flash: b.flash, mouth: b.mouth, lx: b.lx, ly: b.ly };
}

function renderFight() {
  const f = F, B = f.B;
  ctx.save();
  if (f.shake > 0) ctx.translate(rand(-f.shake, f.shake), rand(-f.shake, f.shake));
  drawBG(f.def, f.rt);

  if (!(state === 'results' || (f.stage === 'ko' && f.koT > 2.4))) {
    const s = bossState();
    if (f.stage === 'ko') s.flash = Math.floor(f.koT * 12) % 2 ? 1 : 0;
    drawBossAt(f.def, s, f.boss.x, f.boss.y, 1);
  }
  if (f.boss.inv > 0 && f.stage === 'fight') {
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(gT * 30);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(f.boss.x, f.boss.y, f.def.r + 20, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  drawSpeech();

  // the battle box
  ctx.fillStyle = '#000';
  ctx.fillRect(B.l, B.t, B.w, B.h);

  for (const s of f.shots) {
    ctx.fillStyle = '#fff6a0'; ctx.fillRect(s.x - 2, s.y - 9, 4, 18);
    ctx.fillStyle = '#fff'; ctx.fillRect(s.x - 1, s.y - 9, 2, 10);
  }

  for (const b of f.bullets) if (!b.clip && b.type !== 'laser') drawBullet(b, B);
  ctx.save();
  ctx.beginPath(); ctx.rect(B.l, B.t, B.w, B.h); ctx.clip();
  for (const b of f.bullets) if (b.clip && b.type !== 'laser' && b.type !== 'zone') drawBullet(b, B);
  ctx.restore();

  if (f.M.dark && state !== 'dead') {
    const p = f.p;
    ctx.save();
    ctx.beginPath(); ctx.rect(B.l, B.t, B.w, B.h); ctx.clip();
    const g = ctx.createRadialGradient(p.x, p.y, 30, p.x, p.y, 105);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.97)');
    ctx.fillStyle = g; ctx.fillRect(B.l, B.t, B.w, B.h);
    ctx.restore();
  }

  // lasers and zones stay visible even in the dark
  for (const b of f.bullets) if (b.type === 'laser' && !b.clip) drawBullet(b, B);
  ctx.save();
  ctx.beginPath(); ctx.rect(B.l, B.t, B.w, B.h); ctx.clip();
  for (const b of f.bullets) if ((b.type === 'laser' && b.clip) || b.type === 'zone') drawBullet(b, B);
  ctx.restore();

  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.strokeRect(B.l - 2, B.t - 2, B.w + 4, B.h + 4);

  if (f.stage !== 'text') drawPlayer();
  drawFx();

  if (f.superFx) {
    const s = f.superFx, k = 1 - s.t / 0.7;
    ctx.globalAlpha = k;
    const g = ctx.createLinearGradient(s.x - 45, 0, s.x + 45, 0);
    g.addColorStop(0, 'rgba(255,225,77,0)'); g.addColorStop(0.5, '#fff'); g.addColorStop(1, 'rgba(255,225,77,0)');
    ctx.fillStyle = g; ctx.fillRect(s.x - 45 * (0.5 + k), 0, 90 * (0.5 + k), f.p.y);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (f.stage === 'text') drawIntroText();
  else drawHUD();

  if (f.stage === 'ready') {
    if (f.stageT < 0.9) text('READY?', W / 2, 330, 64, '#fff', 'center', true, 8);
    else text('FIGHT!', W / 2, 330, 84 + (f.stageT - 0.9) * 40, '#ffd23f', 'center', true, 10);
  }
  if (f.stage === 'ko' && state === 'fight') {
    const k = Math.min(1, f.koT * 3);
    text('KNOCKOUT!', W / 2, 320, 40 + 60 * k, '#ffd23f', 'center', true, 10);
  }
  if (f.flash > 0) {
    ctx.fillStyle = `rgba(255,40,40,${f.flash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawSpeech() {
  const s = F.speech;
  if (!s || s.t > 2.4 || !s.text) return;
  const bx = clamp(F.boss.x + 95, 20, W - 330), by = F.boss.y - 120;
  ctx.font = 'bold 17px "Courier New", monospace';
  const w = Math.min(310, ctx.measureText(s.text).width + 30);
  rrect(ctx, bx, by, w, 44, 10); fs(ctx, '#fff', 3, '#000');
  ctx.beginPath(); ctx.moveTo(bx + 20, by + 44); ctx.lineTo(bx + 4, by + 64); ctx.lineTo(bx + 38, by + 44); ctx.fillStyle = '#fff'; ctx.fill();
  const shown = s.text.slice(0, Math.floor(s.t * 40));
  ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(shown, bx + 14, by + 22, w - 24);
}

function drawIntroText() {
  const f = F, B = f.B;
  const shown = f.def.intro.slice(0, Math.floor(f.textT * 45));
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  shown.split('\n').forEach((ln, i) => ctx.fillText(ln, B.l + 24, B.t + 22 + i * 32));
  if (shown.length >= f.def.intro.length && Math.floor(gT * 3) % 2) text('[Z]', B.r - 30, B.b - 20, 16, '#ff0');
  text(f.def.name, W / 2, 34, 30, '#fff', 'center', true, 6);
  text(f.def.title, W / 2, 62, 16, '#ccc', 'center');
}

function drawHUD() {
  const f = F, d = f.def, p = f.p;
  // boss HP (Undertale style bar)
  text(d.name, W / 2, 18, 18, '#fff', 'center', false, 4);
  const bw = 420, bx = W / 2 - bw / 2;
  ctx.fillStyle = '#7a0000'; ctx.fillRect(bx, 30, bw, 12);
  ctx.fillStyle = '#ffe600'; ctx.fillRect(bx, 30, bw * (f.hp / f.max), 12);
  ctx.fillStyle = '#000';
  ctx.fillRect(bx + bw * 0.66 - 1, 30, 2, 12); ctx.fillRect(bx + bw * 0.33 - 1, 30, 2, 12);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(bx, 30, bw, 12);

  // modifiers
  ctx.textBaseline = 'middle';
  let y = 70;
  text('RULES', 24, y, 14, '#888', 'left');
  y += 20;
  if (!f.mods.length) { text('NORMAL', 24, y, 16, '#fff', 'left'); y += 22; }
  for (const k of f.mods) { text('■ ' + MODS[k].name, 24, y, 16, MODS[k].col, 'left', false, 3); y += 22; }
  if (f.stage === 'fight') {
    ctx.fillStyle = '#333'; ctx.fillRect(24, y, 150, 5);
    ctx.fillStyle = f.nextMods ? '#f44' : '#aaa';
    ctx.fillRect(24, y, 150 * clamp(f.modT / f.modMax, 0, 1), 5);
    y += 18;
    if (f.nextMods && Math.floor(gT * 8) % 2) {
      text('NEXT ▶ ' + (f.nextMods.length ? f.nextMods.map(k => MODS[k].name).join(' + ') : 'NORMAL'), 24, y, 15, '#f55', 'left', false, 3);
    }
  }
  if (f.M.grav) {
    const dirKey = f.M.grav.y > 0 ? '↑' : f.M.grav.y < 0 ? '↓' : f.M.grav.x > 0 ? '←' : '→';
    text('JUMP: SPACE or ' + dirKey + (f.M.reverse ? ' (reversed!)' : ''), BOX_CX, f.B.b + 18, 13, '#6af');
  }

  // player stats (bottom)
  text('SQUARE   LV ' + (f.idx + 1), 30, 700, 20, '#fff', 'left');
  text('HP', 250, 700, 16, '#fff', 'left');
  const step = Math.min(22, 300 / p.max);
  for (let i = 0; i < p.max; i++) {
    ctx.fillStyle = i < p.hp ? '#ffe600' : '#a00';
    ctx.fillRect(282 + i * step, 692, step - 4, 16);
  }
  text(p.hp + ' / ' + p.max, 282 + p.max * step + 8, 700, 18, '#fff', 'left');
  text('EX', 690, 700, 16, '#fff', 'left');
  ctx.fillStyle = '#222'; ctx.fillRect(720, 692, 200, 16);
  const full = p.ex >= 1;
  ctx.fillStyle = full ? (Math.floor(gT * 8) % 2 ? '#fff' : '#ffe14d') : '#ff6ec7';
  ctx.fillRect(720, 692, 200 * p.ex, 16);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(720, 692, 200, 16);
  if (full) text('V: SUPER!', 820, 676, 14, '#ffe14d', 'center', false, 3);

  // timer
  text(fmtTime(f.time), W - 24, 18, 16, '#aaa', 'right');

  // modifier banner
  const bn = f.banner;
  if (bn && bn.t < 1.1) {
    const k = bn.t < 0.12 ? bn.t / 0.12 : 1;
    ctx.globalAlpha = bn.t > 0.8 ? (1.1 - bn.t) / 0.3 : 1;
    const size = Math.min(54, 1500 / Math.max(10, bn.text.length));
    text(bn.text, W / 2, 312, size * (1.6 - 0.6 * k), bn.col, 'center', true, 8);
    ctx.globalAlpha = 1;
  }
}

function renderTitle() {
  drawBG(BOSSES[0], gT);
  text('SQUAREHEAD', W / 2 + 4, 154, 104, '#000', 'center', true);
  text('SQUAREHEAD', W / 2, 150, 104, '#ffd23f', 'center', true, 10);
  text('in  "THE HARD GAME"', W / 2, 225, 26, '#fff', 'center', true, 5);
  const y = 320 + Math.abs(Math.sin(gT * 4)) * -40;
  ctx.fillStyle = '#ff2424'; ctx.fillRect(W / 2 - 18, y - 18, 36, 36);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(W / 2 - 18, y - 18, 36, 36);
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(W / 2 - 14, y - 14, 12, 8);

  const lines = [
    ['ARROWS / WASD', 'move'],
    ['Z / J (hold)', 'shoot'],
    ['X / K', 'parry PINK bullets (fills EX)'],
    ['SHIFT / C', 'dash  (you are invincible while dashing)'],
    ['SPACE / away-key', 'jump when gravity is on'],
    ['V / L', 'SUPER when EX is full'],
    ['ESC / P', 'pause        M  mute'],
  ];
  rrect(ctx, 150, 380, 660, 230, 10); fs(ctx, 'rgba(0,0,0,.65)', 3, '#fff');
  lines.forEach(([k, v], i) => {
    text(k, 180, 410 + i * 28, 18, '#ffd23f', 'left');
    text(v, 410, 410 + i * 28, 18, '#fff', 'left');
  });
  text('The rules change every few seconds. Watch the RULES panel.', W / 2, 640, 16, '#ccc');
  if (Math.floor(gT * 2.5) % 2) text('PRESS Z TO START', W / 2, 680, 26, '#fff', 'center', false, 4);
}

function renderSelect() {
  drawBG(BOSSES[sel], gT);
  text('CHOOSE YOUR DOOM', W / 2, 70, 54, '#fff', 'center', true, 8);
  const cw = 168, gap = 14, x0 = (W - (cw * 5 + gap * 4)) / 2;
  for (let i = 0; i < 5; i++) {
    const d = BOSSES[i], x = x0 + i * (cw + gap), locked = i >= save.unlocked, on = i === sel;
    const y = 150 + (on ? Math.sin(gT * 5) * 5 - 8 : 0);
    rrect(ctx, x, y, cw, 360, 12); fs(ctx, on ? 'rgba(40,30,10,.9)' : 'rgba(0,0,0,.7)', on ? 5 : 3, on ? '#ffd23f' : '#666');
    drawBossAt(d, { t: gT + i, phase: 0, flash: 0, mouth: 0, lx: 0, ly: 0.5 }, x + cw / 2, y + 120, 0.42, locked);
    text('LEVEL ' + (i + 1), x + cw / 2, y + 22, 15, '#aaa');
    if (locked) {
      text('?', x + cw / 2, y + 115, 60, '#555', 'center', true);
      text('LOCKED', x + cw / 2, y + 230, 18, '#777');
    } else {
      const words = d.name.split(' ');
      words.forEach((w, k) => text(w, x + cw / 2, y + 222 + k * 22, 19, '#fff', 'center', false, 3));
      ctx.font = 'bold 11px "Courier New", monospace';
      text(d.title, x + cw / 2, y + 272, 11, '#bbb');
      const best = save.best[i];
      if (best) {
        text(best.grade, x + cw / 2, y + 310, 34, '#ffd23f', 'center', true, 5);
        text(fmtTime(best.time) + (best.hp ? '  ·  ' + best.hp + ' HP' : ''), x + cw / 2, y + 340, 14, '#aaa');
      } else text('NOT BEATEN', x + cw / 2, y + 320, 14, '#888');
    }
  }
  const d = BOSSES[sel];
  if (sel < save.unlocked) text('BOSS HP ' + d.hp + '  ·  ' + d.pools[2].length + ' attacks in final phase', W / 2, 538, 15, '#ccc');
  else text('Beat the previous boss to unlock.', W / 2, 538, 15, '#ccc');
  // difficulty picker
  const di = diffInfo(save.hp);
  text('DIFFICULTY', W / 2, 566, 13, '#999');
  text((save.hp > 1 ? '▼ ' : '   ') + di.name + (save.hp < 15 ? ' ▲' : '   '), W / 2, 590, 24, di.col, 'center', true, 5);
  const pw = 14, px0 = W / 2 - (15 * (pw + 4)) / 2;
  for (let i = 0; i < 15; i++) {
    ctx.fillStyle = i < save.hp ? di.col : '#333';
    ctx.fillRect(px0 + i * (pw + 4), 610, pw, 10);
  }
  text(save.hp === 1 ? 'one hit and you are dead' : 'you can take ' + save.hp + ' hits', W / 2, 634, 13, '#bbb');
  text('← → choose   ↑ ↓ difficulty   Z fight   ESC title', W / 2, 662, 17, '#fff');
  text('U = unlock all bosses (practice)', W / 2, 684, 12, '#777');
  if (save.beatAll) text('★ YOU BEAT THE HARD GAME ★', W / 2, 706, 16, '#ffd23f', 'center', true, 4);
}

function renderPause() {
  renderFight();
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
  text('PAUSED', W / 2, 300, 64, '#fff', 'center', true, 8);
  text('Z / ESC  resume      Q  quit to boss select', W / 2, 380, 18, '#ccc');
}

function renderDead() {
  renderFight();
  const k = clamp((F.deadT - 0.4) / 0.8, 0, 0.8);
  ctx.fillStyle = `rgba(0,0,0,${k})`; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 1; drawFx(); ctx.restore();
  if (F.deadT < 1.2) return;
  rrect(ctx, 200, 170, 560, 360, 14); fs(ctx, '#f3ead2', 6, '#000');
  text('YOU DIED!', W / 2, 230, 64, '#c62828', 'center', true, 0);
  text('* Stay determined, square...', W / 2, 282, 18, '#333');
  text(diffInfo(F.p.max).name + '  ·  ' + F.p.max + ' HP', W / 2, 310, 14, '#777');
  const x1 = 260, x2 = 700, ly = 370, prog = 1 - F.hp / F.max;
  ctx.strokeStyle = '#333'; ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(x1, ly); ctx.lineTo(x2, ly); ctx.stroke(); ctx.setLineDash([]);
  for (const f of [0.34, 0.67]) { ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x1 + (x2 - x1) * f, ly, 6, 0, TAU); ctx.fill(); }
  drawBossAt(F.def, { t: gT, phase: F.phase, flash: 0, mouth: 0, lx: -1, ly: 0 }, x2 + 10, ly - 4, 0.22);
  const px = x1 + (x2 - x1) * prog;
  ctx.fillStyle = '#ff2424'; ctx.fillRect(px - 9, ly - 9, 18, 18);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(px - 9, ly - 9, 18, 18);
  text(Math.floor(prog * 100) + '% of the way there', W / 2, 410, 18, '#333');
  text('Z  RETRY', W / 2 - 110, 480, 24, '#000');
  text('X  QUIT', W / 2 + 110, 480, 24, '#000');
}

function renderResults() {
  renderFight();
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H);
  const f = F, r = f.result;
  rrect(ctx, 220, 110, 520, 470, 14); fs(ctx, '#f3ead2', 6, '#000');
  text('THE RESULTS', W / 2, 160, 48, '#000', 'center', true);
  text(f.def.name + ' DEFEATED  ·  ' + diffInfo(f.p.max).name + ' (' + f.p.max + ' HP)', W / 2, 205, 16, '#555');
  const rows = [
    ['TIME', fmtTime(f.time) + '  (par ' + fmtTime(f.def.par) + ')'],
    ['HP LEFT', f.p.hp + ' / ' + f.p.max],
    ['PARRIES', String(f.stats.parries)],
    ['SUPERS', String(f.stats.supers)],
  ];
  rows.forEach(([k, v], i) => {
    if (f.resT < 0.2 + i * 0.2) return;
    text(k, 270, 260 + i * 40, 22, '#000', 'left');
    text(v, 690, 260 + i * 40, 22, '#000', 'right');
  });
  if (f.resT > 1.1) {
    text('GRADE', W / 2 - 60, 450, 26, '#000');
    text(r.grade, W / 2 + 60, 450, 72, '#c62828', 'center', true);
  }
  if (r.newUnlock) text('NEW BOSS UNLOCKED!', W / 2, 515, 20, '#2a7a2a');
  if (f.idx === 4) text('YOU BEAT THE HARD GAME!', W / 2, 515, 22, '#c62828', 'center', true);
  if (f.resT > 0.8 && Math.floor(gT * 2.5) % 2) text('PRESS Z', W / 2, 555, 18, '#000');
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  switch (state) {
    case 'title': renderTitle(); break;
    case 'select': renderSelect(); break;
    case 'fight': renderFight(); break;
    case 'pause': renderPause(); break;
    case 'dead': renderDead(); break;
    case 'results': renderResults(); break;
  }
  drawPost();
  if (audio.muted) text('MUTED', W - 20, H - 14, 12, '#888', 'right');
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  for (const k in pressed) delete pressed[k];
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
