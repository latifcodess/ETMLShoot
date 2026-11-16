// Textures procédurales : aucune image n'est téléchargée, tout est calculé au chargement.
// Chaque matériau du monde produit une couleur (albedo) et un relief (carte de normales).

import * as THREE from 'three';
import { MAT } from '../../shared/constants.js';

// ---------------------------------------------------------------------------------------------
// Bruit périodique (raccord parfait sur les bords de la texture)
// ---------------------------------------------------------------------------------------------

const PERM = new Uint8Array(512);
{
  let s = 20240917;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function hash2(ix, iy) { return PERM[(PERM[ix & 255] + iy) & 255] / 255; }

/** Bruit de valeur lissé, périodique de période `per` (entier). */
export function vnoise(x, y, per) {
  let ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  ix = ((ix % per) + per) % per; iy = ((iy % per) + per) % per;
  const ix1 = (ix + 1) % per, iy1 = (iy + 1) % per;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix1, iy), c = hash2(ix, iy1), d = hash2(ix1, iy1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Bruit fractal ; u, v dans [0,1[, `freq` = fréquence de base (entier). */
export function fbm(u, v, freq, oct = 4, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0, f = freq;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(u * f + i * 17.3, v * f + i * 9.1, f) * amp;
    norm += amp;
    amp *= gain; f *= 2;
  }
  return sum / norm;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// Fabrique générique
// ---------------------------------------------------------------------------------------------

/**
 * @param size   côté de la texture (puissance de 2)
 * @param fn     (u, v, o) => remplit o.r, o.g, o.b (0..1, sRGB) et o.h (relief 0..1)
 * @param bump   intensité du relief
 */
function generate(size, fn, bump = 2) {
  const col = new Uint8ClampedArray(size * size * 4);
  const hgt = new Float32Array(size * size);
  const o = { r: 0, g: 0, b: 0, h: 0 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      o.r = o.g = o.b = 0.5; o.h = 0.5;
      fn(x / size, y / size, o, x, y);
      const i = (y * size + x) * 4;
      col[i] = o.r * 255; col[i + 1] = o.g * 255; col[i + 2] = o.b * 255; col[i + 3] = 255;
      hgt[y * size + x] = o.h;
    }
  }
  const nrm = new Uint8ClampedArray(size * size * 4);
  const k = bump * size / 256;
  for (let y = 0; y < size; y++) {
    const y0 = ((y - 1 + size) % size) * size, y1 = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const x0 = (x - 1 + size) % size, x1 = (x + 1) % size;
      const dx = (hgt[y * size + x1] - hgt[y * size + x0]) * k;
      const dy = (hgt[y1 + x] - hgt[y0 + x]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      nrm[i] = (-dx * inv * 0.5 + 0.5) * 255;
      nrm[i + 1] = (dy * inv * 0.5 + 0.5) * 255;     // V de la texture vers le bas → composante verte inversée
      nrm[i + 2] = (inv * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  }
  return { map: toTexture(col, size, true), normalMap: toTexture(nrm, size, false) };
}

function toTexture(data, size, srgb) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Matériaux du monde
// ---------------------------------------------------------------------------------------------

function grey(o, v) { o.r = o.g = o.b = clamp01(v); }
function tint(o, r, g, b, v) { o.r = clamp01(r * v); o.g = clamp01(g * v); o.b = clamp01(b * v); }

const GEN = {
  [MAT.CONCRETE]: () => generate(512, (u, v, o) => {
    const n = fbm(u, v, 4, 5), fine = fbm(u, v, 64, 2), stain = fbm(u, v * 0.5, 3, 3);
    const crack = Math.abs(fbm(u + 0.3, v + 0.7, 5, 4) - 0.5);
    const c = smooth(0.0, 0.012, crack);
    // joints de coffrage tous les demi-pavés
    const jx = Math.abs(((u * 2) % 1) - 0.5), jy = Math.abs(((v * 2) % 1) - 0.5);
    const joint = Math.min(smooth(0.492, 0.5, jx) + smooth(0.492, 0.5, jy), 1);
    let val = 0.5 + (n - 0.5) * 0.3 + (fine - 0.5) * 0.14 - (1 - c) * 0.18 - joint * 0.12 - smooth(0.55, 0.8, stain) * 0.08;
    tint(o, 1.0, 0.99, 0.96, val);
    o.h = 0.5 + (n - 0.5) * 0.25 + (fine - 0.5) * 0.25 - (1 - c) * 0.5 - joint * 0.4;
  }, 2.2),

  [MAT.ASPHALT]: () => generate(512, (u, v, o) => {
    const n = fbm(u, v, 3, 4), g = fbm(u, v, 96, 2), g2 = vnoise(u * 200, v * 200, 200);
    const patch = smooth(0.52, 0.6, fbm(u + 0.5, v + 0.2, 2, 3));
    const crack = smooth(0, 0.008, Math.abs(fbm(u + 0.1, v + 0.4, 4, 4) - 0.5));
    const val = 0.3 + (n - 0.5) * 0.12 + (g - 0.5) * 0.12 + (g2 - 0.5) * 0.1 - patch * 0.06 - (1 - crack) * 0.1;
    tint(o, 1.0, 1.0, 1.04, val);
    o.h = 0.5 + (g - 0.5) * 0.5 + (g2 - 0.5) * 0.4 - (1 - crack) * 0.5;
  }, 1.6),

  [MAT.SAND]: () => generate(512, (u, v, o) => {
    const n = fbm(u, v, 3, 4), g = fbm(u, v, 128, 2);
    const ripple = Math.sin((v + fbm(u, v, 4, 3) * 0.25) * Math.PI * 2 * 22) * 0.5 + 0.5;
    const peb = smooth(0.8, 0.86, vnoise(u * 60, v * 60, 60));
    const val = 0.74 + (n - 0.5) * 0.22 + (g - 0.5) * 0.1 + (ripple - 0.5) * 0.05 - peb * 0.18;
    tint(o, 1.0, 0.86, 0.62, val);
    o.h = 0.5 + (n - 0.5) * 0.3 + (ripple - 0.5) * 0.22 + (g - 0.5) * 0.15 + peb * 0.4;
  }, 1.5),

  [MAT.METAL]: () => generate(256, (u, v, o) => {
    const streak = fbm(u * 0.25, v, 48, 3), n = fbm(u, v, 4, 3);
    const px = Math.abs(((u * 2) % 1) - 0.5), py = Math.abs(((v * 2) % 1) - 0.5);
    const seam = Math.max(smooth(0.485, 0.5, px), smooth(0.485, 0.5, py));
    // rivets aux angles des plaques
    const rx = Math.abs(((u * 8) % 1) - 0.5), ry = Math.abs(((v * 8) % 1) - 0.5);
    const edge = px > 0.44 || py > 0.44;
    const rivet = edge ? 1 - smooth(0.05, 0.16, Math.hypot(rx, ry)) : 0;
    const val = 0.62 + (streak - 0.5) * 0.18 + (n - 0.5) * 0.14 - seam * 0.3 + rivet * 0.12;
    tint(o, 0.96, 0.98, 1.0, val);
    o.h = 0.5 + (streak - 0.5) * 0.08 - seam * 0.5 + rivet * 0.45;
  }, 2.5),

  [MAT.DARKMETAL]: () => generate(256, (u, v, o) => {
    const streak = fbm(u, v * 0.25, 48, 3), n = fbm(u, v, 6, 3);
    const wear = smooth(0.62, 0.75, fbm(u + 0.4, v + 0.1, 8, 3));
    const val = 0.2 + (streak - 0.5) * 0.08 + (n - 0.5) * 0.08 + wear * 0.12;
    tint(o, 0.96, 0.98, 1.0, val);
    o.h = 0.5 + (streak - 0.5) * 0.1 + wear * 0.1;
  }, 1.2),

  [MAT.WOOD]: () => generate(256, (u, v, o) => {
    // planches horizontales (4 par pavé), veinage le long de u
    const pv = v * 4, pi = Math.floor(pv), pf = pv - pi;
    const grain = fbm(u * 0.4 + pi * 0.37, v * 3, 24, 4);
    const ring = Math.sin((pf + grain * 0.6) * 38) * 0.5 + 0.5;
    const gap = smooth(0.0, 0.035, Math.min(pf, 1 - pf));
    const knot = 1 - smooth(0.0, 0.05, Math.hypot(((u * 2 + pi * 0.31) % 1) - 0.5, (pf - 0.5) * 0.25));
    const tone = 0.85 + hash2(pi, 7) * 0.3;
    const val = (0.52 + (grain - 0.5) * 0.25 + (ring - 0.5) * 0.08 - knot * 0.25) * tone * (0.35 + 0.65 * gap);
    tint(o, 1.0, 0.76, 0.48, val);
    o.h = 0.5 * gap + (ring - 0.5) * 0.12 + (grain - 0.5) * 0.1;
  }, 2.4),

  [MAT.BRICK]: () => generate(512, (u, v, o) => {
    const rows = 8, cols = 4;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * cols + (row % 2) * 0.5, colI = Math.floor(rx), fx = rx - colI;
    const mx = Math.min(fx, 1 - fx) * (1 / cols) * 4, my = Math.min(fy, 1 - fy) * (1 / rows) * 8;
    const mortar = 1 - Math.min(smooth(0.02, 0.07, mx), smooth(0.04, 0.14, my));
    const tone = hash2(colI * 3 + 1, row * 5 + 2);
    const n = fbm(u, v, 32, 3), n2 = fbm(u, v, 6, 3);
    const br = 0.5 + tone * 0.28 + (n - 0.5) * 0.2 + (n2 - 0.5) * 0.1;
    const r = mix(0.72 * br + 0.1, 0.62, mortar), g = mix(0.36 * br + 0.06, 0.6, mortar), b = mix(0.28 * br + 0.05, 0.56, mortar);
    o.r = clamp01(r * (1 - mortar * 0.15 + (n - 0.5) * 0.1)); o.g = clamp01(g * (1 - mortar * 0.15)); o.b = clamp01(b * (1 - mortar * 0.15));
    o.h = (1 - mortar) * 0.6 + (n - 0.5) * 0.2;
  }, 3),

  [MAT.SANDBAG]: () => generate(256, (u, v, o) => {
    const rows = 4, cols = 2;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * cols + (row % 2) * 0.5, colI = Math.floor(rx), fx = rx - colI;
    // sac bombé : relief en coussin
    const px = Math.sin(fx * Math.PI), py = Math.sin(fy * Math.PI);
    const pillow = Math.pow(px, 0.35) * Math.pow(py, 0.5);
    const weave = (Math.sin(u * 256 * 0.9) * Math.sin(v * 256 * 0.9)) * 0.5 + 0.5;
    const tone = 0.86 + hash2(colI + 11, row + 5) * 0.22;
    const n = fbm(u, v, 8, 3);
    const val = (0.3 + 0.5 * pillow) * tone + (weave - 0.5) * 0.06 + (n - 0.5) * 0.12;
    tint(o, 0.95, 0.85, 0.62, val + 0.12);
    o.h = pillow * 0.9 + (weave - 0.5) * 0.06;
  }, 3.4),

  [MAT.CONTAINER]: () => generate(512, (u, v, o) => {
    // tôle ondulée : nervures verticales trapézoïdales
    const t = (u * 16) % 1;
    const tri = Math.abs(t - 0.5) * 2;
    const rib = smooth(0.25, 0.75, tri);
    const dirt = fbm(u, v, 4, 4), streak = fbm(u * 4, v * 0.3, 16, 3);
    const rust = smooth(0.66, 0.8, fbm(u + 0.2, v + 0.6, 6, 4)) * smooth(0.3, 0.9, v + (streak - 0.5) * 0.5);
    const scratch = smooth(0.78, 0.8, vnoise(u * 3, v * 90, 90)) * 0.5;
    let val = 0.78 + (rib - 0.5) * 0.1 + (dirt - 0.5) * 0.22 - (streak - 0.5) * 0.12 - scratch * 0.2;
    o.r = clamp01(mix(val, 0.42, rust)); o.g = clamp01(mix(val, 0.24, rust)); o.b = clamp01(mix(val, 0.14, rust));
    o.h = rib * 0.9 + (dirt - 0.5) * 0.05;
  }, 3.2),

  [MAT.ROOF]: () => generate(256, (u, v, o) => {
    const t = (u * 16) % 1;
    const wave = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
    const dirt = fbm(u, v, 4, 4), streak = fbm(u * 6, v * 0.25, 12, 3);
    const seam = smooth(0.48, 0.5, Math.abs(((v * 2) % 1) - 0.5));
    const val = 0.74 + (wave - 0.5) * 0.14 + (dirt - 0.5) * 0.2 - (streak - 0.5) * 0.16 - seam * 0.2;
    tint(o, 0.97, 1.0, 1.02, val);
    o.h = wave * 0.8 - seam * 0.4;
  }, 2.6),

  [MAT.HESCO]: () => generate(256, (u, v, o) => {
    // toile géotextile maintenue par un grillage
    const gx = Math.abs(((u * 12) % 1) - 0.5), gy = Math.abs(((v * 12) % 1) - 0.5);
    const wire = Math.max(smooth(0.42, 0.5, gx), smooth(0.42, 0.5, gy));
    const seam = smooth(0.47, 0.5, Math.abs(((u * 1) % 1) - 0.5));
    const n = fbm(u, v, 5, 4), fine = fbm(u, v, 64, 2);
    const bulge = Math.sin(((u * 1) % 1) * Math.PI);
    const val = 0.5 + (n - 0.5) * 0.3 + (fine - 0.5) * 0.12 + bulge * 0.08 - seam * 0.2;
    const r = mix(0.86 * val, 0.3, wire * 0.75), g = mix(0.76 * val, 0.31, wire * 0.75), b = mix(0.56 * val, 0.32, wire * 0.75);
    o.r = clamp01(r + 0.1); o.g = clamp01(g + 0.08); o.b = clamp01(b + 0.05);
    o.h = bulge * 0.4 + wire * 0.35 + (n - 0.5) * 0.3 - seam * 0.5;
  }, 2.6),

  [MAT.PLASTER]: () => generate(512, (u, v, o) => {
    const n = fbm(u, v, 3, 5), fine = fbm(u, v, 80, 2);
    const stain = smooth(0.5, 0.75, fbm(u * 2, v * 0.6, 3, 4));
    const crack = smooth(0, 0.01, Math.abs(fbm(u + 0.6, v + 0.2, 4, 4) - 0.5));
    const chip = smooth(0.7, 0.74, fbm(u + 0.9, v + 0.3, 7, 3));
    const val = 0.82 + (n - 0.5) * 0.2 + (fine - 0.5) * 0.08 - stain * 0.1 - (1 - crack) * 0.2 - chip * 0.16;
    tint(o, 1.0, 0.98, 0.93, val);
    o.h = 0.5 + (fine - 0.5) * 0.2 - (1 - crack) * 0.5 - chip * 0.35;
  }, 1.8),

  [MAT.RUST]: () => generate(256, (u, v, o) => {
    const n = fbm(u, v, 5, 5), n2 = fbm(u + 0.5, v + 0.5, 12, 4), fine = fbm(u, v, 64, 2);
    const flake = smooth(0.5, 0.62, n2);
    const val = 0.6 + (n - 0.5) * 0.4 + (fine - 0.5) * 0.14;
    o.r = clamp01(mix(0.78, 0.55, flake) * val + 0.1); o.g = clamp01(mix(0.66, 0.36, flake) * val + 0.08); o.b = clamp01(mix(0.6, 0.24, flake) * val + 0.06);
    o.h = 0.5 + (n2 - 0.5) * 0.7 + (fine - 0.5) * 0.2;
  }, 2.2),

  [MAT.TARP]: () => generate(256, (u, v, o) => {
    const fold = Math.sin((u + fbm(u, v, 3, 3) * 0.4) * Math.PI * 2 * 5) * 0.5 + 0.5;
    const weave = (Math.sin(u * 256 * 1.2) + Math.sin(v * 256 * 1.2)) * 0.25 + 0.5;
    const n = fbm(u, v, 6, 4);
    const val = 0.72 + (fold - 0.5) * 0.2 + (n - 0.5) * 0.16 + (weave - 0.5) * 0.05;
    grey(o, val);
    o.h = fold * 0.7 + (weave - 0.5) * 0.08;
  }, 2.2),

  [MAT.RUBBER]: () => generate(128, (u, v, o) => {
    const tread = smooth(0.3, 0.5, Math.abs(((u * 8 + v * 4) % 1) - 0.5));
    const n = fbm(u, v, 16, 3);
    grey(o, 0.1 + tread * 0.05 + (n - 0.5) * 0.05);
    o.h = tread * 0.8;
  }, 2.5),

  [MAT.LAMP]: () => generate(64, (u, v, o) => { grey(o, 0.95 + (fbm(u, v, 8, 2) - 0.5) * 0.06); o.h = 0.5; }, 0.5),

  [MAT.PAINT]: () => generate(256, (u, v, o) => {
    const n = fbm(u, v, 5, 4), fine = fbm(u, v, 64, 2);
    const chip = smooth(0.68, 0.72, fbm(u + 0.3, v + 0.8, 9, 4));
    const val = 0.88 + (n - 0.5) * 0.16 + (fine - 0.5) * 0.06 - chip * 0.3;
    grey(o, val);
    o.h = 0.5 - chip * 0.4 + (fine - 0.5) * 0.1;
  }, 1.4),

  [MAT.CAMO]: () => generate(256, (u, v, o) => {
    const a = fbm(u, v, 4, 3), b = fbm(u + 0.37, v + 0.71, 5, 3), fine = fbm(u, v, 64, 2);
    let r = 0.42, g = 0.44, bl = 0.3;
    if (a > 0.55) { r = 0.28; g = 0.32; bl = 0.22; }
    if (b > 0.58) { r = 0.52; g = 0.46; bl = 0.34; }
    if (a < 0.38) { r = 0.16; g = 0.17; bl = 0.14; }
    const k = 0.9 + (fine - 0.5) * 0.25;
    o.r = clamp01(r * k * 1.6); o.g = clamp01(g * k * 1.6); o.b = clamp01(bl * k * 1.6);
    o.h = 0.5 + (fine - 0.5) * 0.3;
  }, 1.0),

  [MAT.ROCK]: () => generate(512, (u, v, o) => {
    const n = fbm(u, v, 3, 5), strata = Math.sin((v + fbm(u, v, 2, 3) * 0.35) * Math.PI * 2 * 9) * 0.5 + 0.5;
    const crack = smooth(0, 0.02, Math.abs(fbm(u + 0.2, v + 0.9, 5, 4) - 0.5));
    const fine = fbm(u, v, 72, 2);
    const val = 0.7 + (n - 0.5) * 0.36 + (strata - 0.5) * 0.14 + (fine - 0.5) * 0.12 - (1 - crack) * 0.22;
    tint(o, 1.0, 0.92, 0.8, val);
    o.h = 0.5 + (n - 0.5) * 0.5 + (strata - 0.5) * 0.35 - (1 - crack) * 0.6;
  }, 3),

  [MAT.TILE]: () => generate(256, (u, v, o) => {
    const tx = Math.abs(((u * 4) % 1) - 0.5), ty = Math.abs(((v * 4) % 1) - 0.5);
    const grout = Math.max(smooth(0.46, 0.5, tx), smooth(0.46, 0.5, ty));
    const n = fbm(u, v, 8, 3);
    grey(o, 0.8 + (n - 0.5) * 0.12 - grout * 0.35);
    o.h = 0.6 - grout * 0.5;
  }, 2),
};

/** Paramètres physiques : taille d'un pavé (m), rugosité, métal, intensité du relief. */
const PROPS = {
  [MAT.CONCRETE]: { tile: 4, rough: 0.92, metal: 0, ns: 1 },
  [MAT.METAL]: { tile: 2, rough: 0.48, metal: 0.75, ns: 1 },
  [MAT.WOOD]: { tile: 1.6, rough: 0.82, metal: 0, ns: 1 },
  [MAT.SAND]: { tile: 5, rough: 1, metal: 0, ns: 1 },
  [MAT.BRICK]: { tile: 2, rough: 0.9, metal: 0, ns: 1.2 },
  [MAT.ASPHALT]: { tile: 5, rough: 0.9, metal: 0, ns: 1 },
  [MAT.SANDBAG]: { tile: 1.2, rough: 0.95, metal: 0, ns: 1.3 },
  [MAT.CONTAINER]: { tile: 2.44, rough: 0.55, metal: 0.35, ns: 1.2 },
  [MAT.HESCO]: { tile: 1.5, rough: 0.95, metal: 0, ns: 1 },
  [MAT.PLASTER]: { tile: 4, rough: 0.94, metal: 0, ns: 1 },
  [MAT.RUST]: { tile: 2, rough: 0.85, metal: 0.4, ns: 1 },
  [MAT.TARP]: { tile: 2, rough: 0.85, metal: 0, ns: 1 },
  [MAT.RUBBER]: { tile: 0.6, rough: 0.9, metal: 0, ns: 1 },
  [MAT.LAMP]: { tile: 1, rough: 0.3, metal: 0, ns: 0.2 },
  [MAT.PAINT]: { tile: 2.5, rough: 0.6, metal: 0.15, ns: 0.8 },
  [MAT.DARKMETAL]: { tile: 1.5, rough: 0.5, metal: 0.8, ns: 0.8 },
  [MAT.ROOF]: { tile: 2.5, rough: 0.5, metal: 0.55, ns: 1.2 },
  [MAT.CAMO]: { tile: 2, rough: 0.9, metal: 0, ns: 0.6 },
  [MAT.ROCK]: { tile: 6, rough: 0.96, metal: 0, ns: 1.4 },
  [MAT.TILE]: { tile: 2, rough: 0.4, metal: 0, ns: 1 },
};

const matCache = new Map();

/** Matériau Three.js d'un matériau du monde (créé à la demande, mis en cache). */
export function worldMaterial(matId) {
  let m = matCache.get(matId);
  if (m) return m;
  const gen = GEN[matId] || GEN[MAT.CONCRETE];
  const p = PROPS[matId] || PROPS[MAT.CONCRETE];
  const tex = gen();
  m = new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, roughness: p.rough, metalness: p.metal, vertexColors: true,
  });
  m.normalScale.set(p.ns, p.ns);
  if (matId === MAT.PAINT) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; }
  m.userData.tile = p.tile;
  matCache.set(matId, m);
  return m;
}

export function materialTile(matId) { return (PROPS[matId] || PROPS[MAT.CONCRETE]).tile; }

// ---------------------------------------------------------------------------------------------
// Atlas de sprites (particules) et de décalcomanies
// ---------------------------------------------------------------------------------------------

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** Tache irrégulière (sang, suie) : amas de disques + éclaboussures satellites. */
function blob(ctx, cx, cy, r, rnd, satellites, streak = 0) {
  ctx.beginPath();
  const lobes = 9 + Math.floor(rnd() * 6);
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = r * (0.62 + rnd() * 0.5);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * (1 + streak);
    if (i === 0) ctx.moveTo(x, y); else ctx.quadraticCurveTo(cx + Math.cos(a - Math.PI / lobes) * rr * 1.25, cy + Math.sin(a - Math.PI / lobes) * rr * 1.25 * (1 + streak), x, y);
  }
  ctx.fill();
  for (let i = 0; i < satellites; i++) {
    const a = rnd() * Math.PI * 2, d = r * (1.0 + rnd() * 1.1), s = r * (0.04 + rnd() * 0.14);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * (1 + streak), s * (1 + rnd()), s, a, 0, Math.PI * 2);
    ctx.fill();
    if (rnd() < 0.5) {            // filet reliant la goutte à la tache
      ctx.lineWidth = s * 0.7;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
      ctx.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d * (1 + streak));
      ctx.stroke();
    }
  }
}

const _shared = {};
/** Atlas créés une seule fois et partagés (particules, sang, impacts). */
export function sharedAtlas(name) {
  if (!_shared[name]) _shared[name] = name === 'particles' ? makeParticleAtlas() : name === 'blood' ? makeBloodAtlas() : makeImpactAtlas();
  return _shared[name];
}

/** Atlas 4×4 des sprites de particules (canal alpha = forme). */
export function makeParticleAtlas() {
  const N = 4, S = 512, cs = S / N;
  return canvasTex(S, (ctx) => {
    const rnd = lcg(77);
    const cell = (i) => [(i % N) * cs + cs / 2, Math.floor(i / N) * cs + cs / 2];
    const radial = (i, stops) => {
      const [cx, cy] = cell(i);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs / 2);
      for (const [p, a] of stops) g.addColorStop(p, `rgba(255,255,255,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - cs / 2, cy - cs / 2, cs, cs);
    };
    // 0 : halo doux
    radial(0, [[0, 1], [0.35, 0.55], [1, 0]]);
    // 1 : volute de fumée (amas de halos)
    {
      const [cx, cy] = cell(1);
      ctx.save(); ctx.beginPath(); ctx.rect(cx - cs / 2, cy - cs / 2, cs, cs); ctx.clip();
      for (let k = 0; k < 26; k++) {
        const a = rnd() * 6.28, d = rnd() * cs * 0.24, r = cs * (0.1 + rnd() * 0.15);
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
    // 2 : point dur (étincelle)
    radial(2, [[0, 1], [0.18, 1], [0.3, 0.25], [0.5, 0]]);
    // 3 : flash en étoile
    {
      const [cx, cy] = cell(3);
      radial(3, [[0, 1], [0.2, 0.7], [0.55, 0]]);
      ctx.save(); ctx.translate(cx, cy);
      for (let k = 0; k < 7; k++) {
        ctx.rotate(Math.PI * 2 / 7 + rnd() * 0.3);
        const len = cs * (0.3 + rnd() * 0.18);
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, -cs * 0.045); ctx.lineTo(len, 0); ctx.lineTo(0, cs * 0.045); ctx.fill();
      }
      ctx.restore();
    }
    // 4, 5 : gouttes / giclées de sang
    for (const i of [4, 5]) {
      const [cx, cy] = cell(i);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
      blob(ctx, cx, cy, cs * (i === 4 ? 0.2 : 0.14), rnd, i === 4 ? 5 : 10, i === 5 ? 0.5 : 0);
    }
    // 6 : éclat anguleux (débris)
    {
      const [cx, cy] = cell(6);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * 6.28 + rnd() * 0.5, r = cs * (0.16 + rnd() * 0.2);
        if (k === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.fill();
    }
    // 7 : anneau (onde de choc)
    radial(7, [[0, 0], [0.62, 0], [0.8, 0.9], [0.9, 0.5], [1, 0]]);
    // 8 : boule de feu (amas dense)
    {
      const [cx, cy] = cell(8);
      ctx.save(); ctx.beginPath(); ctx.rect(cx - cs / 2, cy - cs / 2, cs, cs); ctx.clip();
      for (let k = 0; k < 34; k++) {
        const a = rnd() * 6.28, d = rnd() * cs * 0.22, r = cs * (0.07 + rnd() * 0.14);
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
    // 9 : douille (rectangle arrondi)
    {
      const [cx, cy] = cell(9);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.roundRect(cx - cs * 0.1, cy - cs * 0.3, cs * 0.2, cs * 0.6, cs * 0.05); ctx.fill();
    }
    // 10 : trait fin (traînée)
    {
      const [cx, cy] = cell(10);
      const g = ctx.createLinearGradient(cx, cy - cs / 2, cx, cy + cs / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - cs * 0.05, cy - cs / 2, cs * 0.1, cs);
    }
    // 11 : morceau de chair (tache pleine)
    {
      const [cx, cy] = cell(11);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
      blob(ctx, cx, cy, cs * 0.26, rnd, 0);
    }
  });
}

/** Atlas 4×2 de taches de sang pour les décalcomanies. */
export function makeBloodAtlas() {
  const S = 1024, cw = S / 4, ch = S / 2;
  const tex = canvasTex(S, (ctx) => {
    const rnd = lcg(4041);
    for (let i = 0; i < 8; i++) {
      const cx = (i % 4) * cw + cw / 2, cy = Math.floor(i / 4) * ch + ch / 2;
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - cw / 2, cy - ch / 2, cw, ch); ctx.clip();
      const streak = i >= 6 ? 0.8 : 0;         // les deux dernières : coulures verticales
      const layers = 3;
      for (let l = 0; l < layers; l++) {
        const shade = 70 + l * 34;
        ctx.fillStyle = `rgba(${shade},${l * 3},${l * 2},${0.75 + l * 0.08})`;
        ctx.strokeStyle = ctx.fillStyle;
        blob(ctx, cx + (rnd() - 0.5) * 10, cy + (rnd() - 0.5) * 10, cw * (0.24 - l * 0.055), rnd, l === 0 ? 16 + Math.floor(rnd() * 14) : 3, streak);
      }
      if (streak) {
        // coulures
        for (let k = 0; k < 5; k++) {
          const x = cx + (rnd() - 0.5) * cw * 0.4, len = ch * (0.15 + rnd() * 0.28), w = 3 + rnd() * 6;
          const g = ctx.createLinearGradient(0, cy, 0, cy + len);
          g.addColorStop(0, 'rgba(110,4,4,0.9)'); g.addColorStop(1, 'rgba(90,2,2,0.55)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.roundRect(x - w / 2, cy, w, len, w / 2); ctx.fill();
        }
      }
      ctx.restore();
    }
  });
  return tex;
}

/** Atlas 2×2 : impacts de balle (béton, métal, bois) et trace de brûlure. */
export function makeImpactAtlas() {
  const S = 512, cs = S / 2;
  return canvasTex(S, (ctx) => {
    const rnd = lcg(909);
    const cell = (i) => [(i % 2) * cs + cs / 2, Math.floor(i / 2) * cs + cs / 2];
    // 0 : béton — cratère clair fissuré, trou sombre
    {
      const [cx, cy] = cell(0);
      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 0.34);
      g.addColorStop(0, 'rgba(210,205,195,0.9)'); g.addColorStop(0.6, 'rgba(170,165,155,0.5)'); g.addColorStop(1, 'rgba(150,145,135,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - cs / 2, cy - cs / 2, cs, cs);
      ctx.strokeStyle = 'rgba(40,38,35,0.7)';
      for (let k = 0; k < 7; k++) {
        const a = rnd() * 6.28; let x = cx, y = cy;
        ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y);
        for (let s = 0; s < 4; s++) { x += Math.cos(a + (rnd() - 0.5)) * cs * 0.07; y += Math.sin(a + (rnd() - 0.5)) * cs * 0.07; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 0.1);
      g.addColorStop(0, 'rgba(8,8,8,1)'); g.addColorStop(0.7, 'rgba(20,18,16,0.95)'); g.addColorStop(1, 'rgba(40,36,32,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.1, 0, 6.28); ctx.fill();
    }
    // 1 : métal — trou net, couronne brillante
    {
      const [cx, cy] = cell(1);
      let g = ctx.createRadialGradient(cx, cy, cs * 0.05, cx, cy, cs * 0.2);
      g.addColorStop(0, 'rgba(235,235,240,0.95)'); g.addColorStop(0.5, 'rgba(120,122,128,0.6)'); g.addColorStop(1, 'rgba(60,60,64,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.2, 0, 6.28); ctx.fill();
      ctx.fillStyle = 'rgba(4,4,5,1)'; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.07, 0, 6.28); ctx.fill();
    }
    // 2 : bois — éclats
    {
      const [cx, cy] = cell(2);
      ctx.fillStyle = 'rgba(214,180,128,0.85)';
      for (let k = 0; k < 9; k++) {
        const a = rnd() * 6.28, len = cs * (0.1 + rnd() * 0.2);
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(len, 0); ctx.lineTo(0, 3); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(18,12,6,1)'; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.075, 0, 6.28); ctx.fill();
    }
    // 3 : brûlure d'explosion
    {
      const [cx, cy] = cell(3);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 0.48);
      g.addColorStop(0, 'rgba(6,5,4,0.95)'); g.addColorStop(0.45, 'rgba(14,12,10,0.8)'); g.addColorStop(0.8, 'rgba(30,26,22,0.3)'); g.addColorStop(1, 'rgba(30,26,22,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - cs / 2, cy - cs / 2, cs, cs);
      ctx.strokeStyle = 'rgba(8,7,6,0.5)';
      for (let k = 0; k < 40; k++) {
        const a = rnd() * 6.28, r0 = cs * (0.15 + rnd() * 0.15), r1 = r0 + cs * (0.08 + rnd() * 0.18);
        ctx.lineWidth = 1 + rnd() * 4;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
      }
    }
  });
}
