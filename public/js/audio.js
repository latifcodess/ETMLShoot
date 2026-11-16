// Moteur sonore : tous les sons sont SYNTHÉTISÉS au chargement (aucun fichier audio),
// puis joués en 3D (atténuation, panoramique, étouffement et retard selon la distance, réverbération).

import { W } from '../shared/weapons.js';
import { SURF } from '../shared/constants.js';

const SR = 44100;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Boîte à outils de synthèse (hors ligne, échantillon par échantillon)
// ---------------------------------------------------------------------------------------------

let _seed = 1234567;
function rnd() { _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0; return _seed / 4294967296; }
function white() { return rnd() * 2 - 1; }

function make(seconds, fn) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  fn(out, n);
  return out;
}
/** Passe-bas à un pôle, fréquence de coupure variable (fc en Hz ou fonction du temps). */
function lowpass(buf, fc) {
  let y = 0;
  const f = typeof fc === 'function' ? fc : null;
  let a = f ? 0 : 1 - Math.exp(-TAU * fc / SR);
  for (let i = 0; i < buf.length; i++) {
    if (f) a = 1 - Math.exp(-TAU * f(i / SR) / SR);
    y += a * (buf[i] - y);
    buf[i] = y;
  }
  return buf;
}
function highpass(buf, fc) {
  let y = 0;
  const a = 1 - Math.exp(-TAU * fc / SR);
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] -= y; }
  return buf;
}
function noiseBuf(seconds) { return make(seconds, (o, n) => { for (let i = 0; i < n; i++) o[i] = white(); }); }
function mixInto(dst, src, gain = 1, offsetSec = 0) {
  const off = Math.floor(offsetSec * SR);
  for (let i = 0; i < src.length && i + off < dst.length; i++) dst[i + off] += src[i] * gain;
  return dst;
}
function envelope(buf, fn) { for (let i = 0; i < buf.length; i++) buf[i] *= fn(i / SR); return buf; }
function decay(d) { return (t) => Math.exp(-t / d); }
function normalize(buf, peak = 0.95) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) { const k = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= k; }
  return buf;
}
function saturate(buf, drive) { for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive); return buf; }
function fadeEnds(buf, t = 0.004) {
  const n = Math.min(buf.length >> 1, Math.floor(t * SR));
  for (let i = 0; i < n; i++) { buf[buf.length - 1 - i] *= i / n; }
  return buf;
}
/** Sinus à fréquence glissante f0 → f1 (exponentielle de constante tau). */
function sweep(seconds, f0, f1, tau) {
  return make(seconds, (o, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / tau)) / SR;
      o[i] = Math.sin(ph);
    }
  });
}
function tone(seconds, freq) { return make(seconds, (o, n) => { for (let i = 0; i < n; i++) o[i] = Math.sin(TAU * freq * i / SR); }); }
function click(seconds, fc, d) {
  const b = noiseBuf(seconds);
  highpass(b, fc * 0.5); lowpass(b, fc * 1.6);
  return envelope(b, decay(d));
}

// ---------------------------------------------------------------------------------------------
// Recettes
// ---------------------------------------------------------------------------------------------

/** Coup de feu : claquement + corps filtré + coup sourd + queue réverbérée + mécanique. */
function gunshot(p) {
  const out = make(p.dur, () => {});
  const crack = envelope(highpass(noiseBuf(0.03), 2500), decay(0.0035));
  mixInto(out, crack, p.crack);
  const body = envelope(lowpass(noiseBuf(p.dur), (t) => p.f1 + (p.f0 - p.f1) * Math.exp(-t / p.bodyDecay)), decay(p.bodyDecay));
  mixInto(out, body, p.body);
  const thump = envelope(sweep(0.3, p.thump, p.thump * 0.3, 0.035), decay(p.thumpDecay));
  mixInto(out, thump, p.low);
  const tail = envelope(lowpass(highpass(noiseBuf(p.dur), 180), 1500), (t) => Math.exp(-t / p.tail) * Math.min(1, t / 0.03));
  mixInto(out, tail, p.tailGain);
  if (p.mech) mixInto(out, click(0.03, 3200, 0.006), p.mech, 0.035);
  saturate(out, p.drive || 1.6);
  return fadeEnds(normalize(out, 0.92), 0.02);
}

function metalPing(f, d) {
  const dur = d * 5;
  const out = make(dur, () => {});
  for (const [mul, g] of [[1, 1], [1.53, 0.6], [2.41, 0.4], [3.17, 0.25]]) mixInto(out, envelope(tone(dur, f * mul), decay(d / Math.sqrt(mul))), g);
  mixInto(out, click(0.02, 5000, 0.003), 1.2);
  return fadeEnds(normalize(out, 0.8));
}

function footstep(fc, ring) {
  const out = make(0.16, () => {});
  mixInto(out, envelope(lowpass(noiseBuf(0.16), fc), decay(0.03)), 1);
  mixInto(out, envelope(lowpass(noiseBuf(0.16), fc * 0.4), decay(0.05)), 0.9, 0.012);
  if (ring) mixInto(out, envelope(tone(0.16, ring), decay(0.03)), 0.25);
  return fadeEnds(normalize(out, 0.7));
}

function chime(freqs, d, gap) {
  const dur = gap * freqs.length + d * 4;
  const out = make(dur, () => {});
  freqs.forEach((f, i) => {
    const t = envelope(tone(d * 4, f), decay(d));
    mixInto(out, t, 0.8, i * gap);
    mixInto(out, envelope(tone(d * 4, f * 2.01), decay(d * 0.5)), 0.25, i * gap);
  });
  return fadeEnds(normalize(out, 0.7));
}

function buildLibrary() {
  const L = {};
  // --- armes
  L['shot' + W.PISTOL] = gunshot({ dur: 0.5, crack: 0.9, body: 1.0, f0: 5200, f1: 500, bodyDecay: 0.03, thump: 190, thumpDecay: 0.03, low: 0.7, tail: 0.11, tailGain: 0.22, mech: 0.5 });
  L['shot' + W.AR] = gunshot({ dur: 0.6, crack: 1.0, body: 1.1, f0: 4300, f1: 380, bodyDecay: 0.04, thump: 150, thumpDecay: 0.045, low: 0.95, tail: 0.15, tailGain: 0.26, mech: 0.35 });
  L['shot' + W.SMG] = gunshot({ dur: 0.42, crack: 0.9, body: 0.95, f0: 5600, f1: 600, bodyDecay: 0.024, thump: 205, thumpDecay: 0.025, low: 0.55, tail: 0.09, tailGain: 0.2, mech: 0.5 });
  L['shot' + W.SHOTGUN] = gunshot({ dur: 0.95, crack: 0.8, body: 1.4, f0: 3000, f1: 220, bodyDecay: 0.075, thump: 110, thumpDecay: 0.08, low: 1.35, tail: 0.24, tailGain: 0.34, drive: 2.3 });
  L['shot' + W.SNIPER] = gunshot({ dur: 1.5, crack: 1.3, body: 1.3, f0: 3800, f1: 240, bodyDecay: 0.07, thump: 95, thumpDecay: 0.1, low: 1.5, tail: 0.42, tailGain: 0.42, drive: 2.4 });
  L['shot' + W.LMG] = gunshot({ dur: 0.65, crack: 1.0, body: 1.2, f0: 3600, f1: 300, bodyDecay: 0.05, thump: 125, thumpDecay: 0.055, low: 1.15, tail: 0.17, tailGain: 0.28, mech: 0.45, drive: 1.9 });
  L['shot' + W.MINIGUN] = gunshot({ dur: 0.36, crack: 0.9, body: 1.0, f0: 4200, f1: 420, bodyDecay: 0.028, thump: 150, thumpDecay: 0.03, low: 0.8, tail: 0.08, tailGain: 0.2, mech: 0.3 });
  {
    // roquette : souffle de départ
    const o = make(1.1, () => {});
    mixInto(o, envelope(lowpass(noiseBuf(1.1), (t) => 400 + 5000 * Math.exp(-t / 0.18)), (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.3)), 1.2);
    mixInto(o, envelope(sweep(0.4, 130, 45, 0.08), decay(0.1)), 1.1);
    L['shot' + W.RPG] = fadeEnds(normalize(saturate(o, 1.6), 0.9), 0.05);
  }
  {
    // explosion : coup de bélier, grondement, crépitements
    const o = make(2.6, () => {});
    mixInto(o, envelope(sweep(1.2, 95, 26, 0.16), decay(0.36)), 1.7);
    mixInto(o, envelope(lowpass(noiseBuf(2.6), (t) => 160 + 4200 * Math.exp(-t / 0.13)), decay(0.5)), 1.5);
    mixInto(o, envelope(highpass(noiseBuf(0.05), 2000), decay(0.006)), 1.1);
    const cr = make(1.6, (b, n) => { for (let i = 0; i < n; i++) b[i] = rnd() < 0.0014 ? white() * 3 : 0; });
    mixInto(o, envelope(lowpass(cr, 3500), (t) => Math.exp(-t / 0.6)), 0.5, 0.12);
    mixInto(o, envelope(lowpass(noiseBuf(2.6), 240), (t) => Math.min(1, t / 0.2) * Math.exp(-t / 0.9)), 0.9);
    L.explosion = fadeEnds(normalize(saturate(o, 2.2), 0.96), 0.1);
  }
  // --- mécanique
  L.dry = fadeEnds(normalize(click(0.05, 2600, 0.006), 0.5));
  { const o = make(0.3, () => {}); mixInto(o, click(0.04, 2200, 0.008), 1); mixInto(o, envelope(lowpass(noiseBuf(0.2), 1800), (t) => Math.min(1, t / 0.03) * Math.exp(-t / 0.05)), 0.4, 0.02); L.magout = fadeEnds(normalize(o, 0.55)); }
  { const o = make(0.3, () => {}); mixInto(o, envelope(lowpass(noiseBuf(0.1), 2400), (t) => Math.min(1, t / 0.04)), 0.3); mixInto(o, click(0.05, 1500, 0.012), 1.2, 0.09); mixInto(o, envelope(tone(0.1, 190), decay(0.02)), 0.6, 0.09); L.magin = fadeEnds(normalize(o, 0.65)); }
  { const o = make(0.32, () => {}); mixInto(o, click(0.05, 2800, 0.008), 1); mixInto(o, click(0.06, 2000, 0.012), 1.2, 0.11); mixInto(o, envelope(tone(0.12, 950), decay(0.02)), 0.2, 0.11); L.bolt = fadeEnds(normalize(o, 0.6)); }
  { const o = make(0.42, () => {}); mixInto(o, envelope(lowpass(highpass(noiseBuf(0.12), 700), 2600), decay(0.03)), 1); mixInto(o, envelope(lowpass(highpass(noiseBuf(0.14), 500), 2200), decay(0.035)), 1.2, 0.16); mixInto(o, click(0.04, 1800, 0.01), 0.8, 0.17); L.pump = fadeEnds(normalize(o, 0.7)); }
  { const o = make(0.2, () => {}); mixInto(o, click(0.04, 1900, 0.01), 1); mixInto(o, envelope(tone(0.08, 330), decay(0.015)), 0.5, 0.01); L.shell = fadeEnds(normalize(o, 0.5)); }
  { const b = envelope(lowpass(highpass(noiseBuf(0.3), 500), 3000), (t) => Math.min(1, t / 0.07) * Math.exp(-Math.max(0, t - 0.07) / 0.07)); L.draw = fadeEnds(normalize(b, 0.4)); }
  { const b = envelope(lowpass(highpass(noiseBuf(0.3), 300), (t) => 700 + 2600 * Math.sin(Math.min(1, t / 0.22) * Math.PI)), (t) => Math.sin(Math.min(1, t / 0.24) * Math.PI) ** 2); L.swing = fadeEnds(normalize(b, 0.6)); }
  { const o = make(0.3, () => {}); mixInto(o, click(0.03, 4200, 0.004), 1); mixInto(o, envelope(tone(0.25, 2900), decay(0.05)), 0.4, 0.02); mixInto(o, envelope(tone(0.25, 4350), decay(0.035)), 0.25, 0.02); L.pin = fadeEnds(normalize(o, 0.5)); }
  { const b = envelope(lowpass(highpass(noiseBuf(0.5), 400), (t) => 3400 - 2600 * Math.min(1, t / 0.3)), (t) => Math.sin(Math.min(1, t / 0.4) * Math.PI) ** 2); L.throw = fadeEnds(normalize(b, 0.4)); }
  // --- impacts
  { const o = make(0.25, () => {}); mixInto(o, envelope(highpass(noiseBuf(0.1), 1800), decay(0.012)), 1); mixInto(o, envelope(lowpass(noiseBuf(0.25), 700), decay(0.045)), 0.9); L.hitConcrete = fadeEnds(normalize(o, 0.75)); }
  L.hitMetal0 = metalPing(1750, 0.05); L.hitMetal1 = metalPing(2380, 0.04); L.hitMetal2 = metalPing(1320, 0.065);
  { const o = make(0.22, () => {}); mixInto(o, envelope(lowpass(highpass(noiseBuf(0.2), 400), 1500), decay(0.03)), 1); mixInto(o, envelope(tone(0.15, 210), decay(0.03)), 0.7); L.hitWood = fadeEnds(normalize(o, 0.75)); }
  { const b = envelope(lowpass(noiseBuf(0.3), 1300), (t) => Math.min(1, t / 0.008) * Math.exp(-t / 0.07)); L.hitSand = fadeEnds(normalize(b, 0.6)); }
  { // chair : choc mat + bruit mouillé
    const o = make(0.3, () => {});
    mixInto(o, envelope(lowpass(noiseBuf(0.3), 520), decay(0.045)), 1.2);
    const wet = envelope(lowpass(highpass(noiseBuf(0.3), 600), 2600), (t) => Math.exp(-t / 0.07) * (0.5 + 0.5 * Math.sin(t * 190)));
    mixInto(o, wet, 0.7, 0.01);
    mixInto(o, envelope(tone(0.12, 120), decay(0.03)), 0.8);
    L.hitFlesh = fadeEnds(normalize(o, 0.8));
  }
  { const o = make(0.4, () => {}); mixInto(o, L.hitFlesh, 1); mixInto(o, envelope(highpass(noiseBuf(0.05), 3000), decay(0.004)), 1.2); mixInto(o, envelope(tone(0.2, 760), decay(0.025)), 0.4); L.hitHead = fadeEnds(normalize(o, 0.85)); }
  { // éclatement (démembrement)
    const o = make(0.7, () => {});
    mixInto(o, envelope(lowpass(noiseBuf(0.7), (t) => 500 + 2600 * Math.exp(-t / 0.05)), (t) => Math.exp(-t / 0.13) * (0.6 + 0.4 * Math.sin(t * 140))), 1.3);
    mixInto(o, envelope(sweep(0.25, 150, 55, 0.04), decay(0.06)), 1);
    const drips = make(0.6, (b, n) => { for (let i = 0; i < n; i++) b[i] = rnd() < 0.003 ? white() * 2 : 0; });
    mixInto(o, envelope(lowpass(drips, 1800), decay(0.25)), 0.6, 0.08);
    L.gib = fadeEnds(normalize(saturate(o, 1.5), 0.85));
  }
  { const b = envelope(lowpass(noiseBuf(0.3), 260), decay(0.07)); mixInto(b, envelope(tone(0.2, 70), decay(0.05)), 0.8); L.thud = fadeEnds(normalize(b, 0.8)); }
  { const b = envelope(lowpass(highpass(noiseBuf(0.16), 900), (t) => 4200 - 3000 * Math.min(1, t / 0.12)), (t) => Math.sin(Math.min(1, t / 0.14) * Math.PI) ** 1.5); L.whizz = fadeEnds(normalize(b, 0.6)); }
  L.clink = metalPing(900, 0.035);
  // --- pas
  L.step0 = footstep(900); L.step1 = footstep(1150); L.stepMetal0 = footstep(1500, 420); L.stepMetal1 = footstep(1700, 520);
  L.stepSand0 = footstep(520); L.stepSand1 = footstep(640);
  { const b = envelope(lowpass(noiseBuf(0.25), 420), decay(0.06)); mixInto(b, envelope(tone(0.2, 62), decay(0.05)), 0.9); L.land = fadeEnds(normalize(b, 0.8)); }
  // --- interface
  { const b = envelope(tone(0.06, 2100), decay(0.012)); mixInto(b, click(0.02, 5000, 0.003), 0.6); L.hitmarker = fadeEnds(normalize(b, 0.5)); }
  L.kill = chime([980, 1470], 0.07, 0.07);
  L.headshot = chime([1560, 2340, 3120], 0.05, 0.045);
  L.pickup = chime([660, 990], 0.05, 0.05);
  L.health = chime([523, 659, 784], 0.07, 0.06);
  L.buy = chime([1318, 1760, 2093], 0.06, 0.05);
  L.ui = fadeEnds(normalize(envelope(tone(0.05, 1300), decay(0.012)), 0.3));
  { const b = make(0.22, (o, n) => { for (let i = 0; i < n; i++) o[i] = Math.sign(Math.sin(TAU * 140 * i / SR)) * 0.5; }); L.error = fadeEnds(normalize(lowpass(envelope(b, (t) => (t < 0.18 ? 1 : 0)), 1200), 0.35)); }
  { // grognement de douleur
    const o = make(0.3, (b, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += (135 - 160 * t) / SR; b[i] = (ph % 1) * 2 - 1 + white() * 0.25; } });
    lowpass(o, 900); highpass(o, 180);
    L.pain = fadeEnds(normalize(envelope(o, (t) => Math.min(1, t / 0.02) * Math.exp(-t / 0.09)), 0.6));
  }
  { const o = make(0.55, (b, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += (120 - 110 * t) / SR; b[i] = (ph % 1) * 2 - 1 + white() * 0.35; } }); lowpass(o, 760); highpass(o, 150); L.death = fadeEnds(normalize(envelope(o, (t) => Math.min(1, t / 0.03) * Math.exp(-t / 0.17)), 0.6)); }
  { const b = envelope(sweep(0.5, 58, 46, 0.08), decay(0.07)); const o = make(0.5, () => {}); mixInto(o, b, 1); mixInto(o, b, 0.8, 0.26); L.heart = fadeEnds(normalize(o, 0.8)); }
  { // corne d'alerte (nouvelle vague)
    const o = make(1.7, (b, n) => { let p1 = 0, p2 = 0; for (let i = 0; i < n; i++) { p1 += 98 / SR; p2 += 147 / SR; b[i] = ((p1 % 1) * 2 - 1) * 0.6 + ((p2 % 1) * 2 - 1) * 0.4; } });
    lowpass(o, 700);
    L.horn = fadeEnds(normalize(envelope(o, (t) => Math.min(1, t / 0.15) * (t > 1.2 ? Math.exp(-(t - 1.2) / 0.15) : 1)), 0.55), 0.05);
  }
  L.stinger = chime([392, 523, 659, 784], 0.16, 0.1);
  L.defeat = chime([392, 330, 262, 196], 0.22, 0.16);
  { // vent : boucle de 6 s raccordée par fondu enchaîné
    const dur = 6, n = dur * SR, x = Math.floor(0.6 * SR);
    const raw = lowpass(highpass(noiseBuf(dur + 0.6), 90), (t) => 320 + 260 * Math.sin(t * 0.9) + 140 * Math.sin(t * 2.3 + 1));
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = raw[i];
    for (let i = 0; i < x; i++) { const k = i / x; o[i] = raw[i] * k + raw[n + i] * (1 - k); }
    L.wind = normalize(o, 0.5);
  }
  return L;
}

// ---------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------

const CAT = {
  gun: { ref: 26, send: 0.3, muffle: 60, prio: 2 },
  boom: { ref: 45, send: 0.4, muffle: 90, prio: 3 },
  hit: { ref: 7, send: 0.1, muffle: 40, prio: 0 },
  step: { ref: 5.5, send: 0.06, muffle: 30, prio: 0 },
  voice: { ref: 9, send: 0.12, muffle: 40, prio: 1 },
  mech: { ref: 6, send: 0.08, muffle: 30, prio: 0 },
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.volume = 0.8;
    this.lx = 0; this.ly = 0; this.lz = 0; this.rx = 1; this.rz = 0;
    this.voices = 0;
    this.ambient = null;
    this.ready = false;
    this.lastPlay = new Map();
  }

  /** À appeler depuis un geste utilisateur (les navigateurs bloquent le son sinon). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    // réverbération : réponse impulsionnelle synthétique
    const len = Math.floor(ctx.sampleRate * 1.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) { const t = i / len; y += 0.35 * ((Math.random() * 2 - 1) - y); d[i] = y * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1); }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    this.reverb.connect(wet).connect(this.master);
    const lib = buildLibrary();
    for (const [name, data] of Object.entries(lib)) {
      const b = ctx.createBuffer(1, data.length, SR);
      b.copyToChannel(data, 0);
      this.buffers[name] = b;
    }
    this.ready = true;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  setListener(x, y, z, yaw) {
    this.lx = x; this.ly = y; this.lz = z;
    this.rx = Math.cos(yaw); this.rz = -Math.sin(yaw);
  }

  /**
   * Joue un son. pos = null → son « dans la tête » (interface, arme du joueur).
   * opts : {gain, pitch, cat, delay}
   */
  play(name, pos, opts = {}) {
    if (!this.ready) return;
    const buffer = this.buffers[name];
    if (!buffer) return;
    const ctx = this.ctx;
    const cat = CAT[opts.cat || 'mech'];
    if (this.voices > 40 && cat.prio === 0) return;
    if (this.voices > 56 && cat.prio < 3) return;
    let gain = opts.gain === undefined ? 1 : opts.gain, pan = 0, delay = opts.delay || 0, cutoff = 0;
    if (pos) {
      const dx = pos.x - this.lx, dy = pos.y - this.ly, dz = pos.z - this.lz;
      const d = Math.hypot(dx, dy, dz);
      gain *= 1 / (1 + Math.pow(d / cat.ref, 1.5));
      if (gain < 0.004) return;
      if (d > 0.5) pan = Math.max(-1, Math.min(1, (dx * this.rx + dz * this.rz) / d)) * 0.8;
      if (d > 12) delay += d / 343;
      cutoff = 20000 / (1 + d / cat.muffle);
      // anti-saturation : pas plus d'un même son lointain toutes les 30 ms
      if (d > 20) {
        const now = ctx.currentTime, last = this.lastPlay.get(name) || 0;
        if (now - last < 0.03) return;
        this.lastPlay.set(name, now);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (opts.pitch || 1) * (0.96 + Math.random() * 0.08);
    let node = src;
    if (cutoff && cutoff < 16000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = Math.max(350, cutoff);
      node.connect(lp); node = lp;
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    let out = g;
    if (pos && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); out = p;
    }
    out.connect(this.master);
    if (pos || opts.reverb) {
      const send = ctx.createGain();
      send.gain.value = (opts.reverb === undefined ? cat.send : opts.reverb);
      out.connect(send).connect(this.reverb);
    }
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(ctx.currentTime + delay);
  }

  shot(weaponId, pos, own) {
    const name = 'shot' + weaponId;
    if (own) this.play(name, null, { gain: 0.75, cat: 'gun', reverb: 0.22 });
    else this.play(name, pos, { gain: 1.25, cat: 'gun' });
  }

  impact(surf, pos) {
    if (surf === SURF.METAL) this.play('hitMetal' + Math.floor(Math.random() * 3), pos, { cat: 'hit', gain: 0.7 });
    else if (surf === SURF.WOOD) this.play('hitWood', pos, { cat: 'hit', gain: 0.8 });
    else if (surf === SURF.SAND || surf === SURF.SOFT) this.play('hitSand', pos, { cat: 'hit', gain: 0.8 });
    else this.play('hitConcrete', pos, { cat: 'hit', gain: 0.8 });
  }

  step(surf, pos, own, loud) {
    const base = surf === SURF.METAL ? 'stepMetal' : surf === SURF.SAND ? 'stepSand' : 'step';
    this.play(base + (Math.random() < 0.5 ? 0 : 1), own ? null : pos, { cat: 'step', gain: (own ? 0.22 : 0.9) * (loud ? 1.3 : 0.8) });
  }

  startAmbient() {
    if (!this.ready || this.ambient) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.wind;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.16;
    src.connect(g).connect(this.master);
    src.start();
    this.ambient = { src, g };
  }
  stopAmbient() {
    if (!this.ambient) return;
    try { this.ambient.src.stop(); } catch { /* déjà arrêté */ }
    this.ambient = null;
  }
}
