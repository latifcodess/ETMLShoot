// Petits utilitaires mathématiques déterministes, partagés client/serveur.

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Ramène un angle dans ]-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Interpolation d'angle par le plus court chemin. */
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

/** Fait tendre `cur` vers `target` d'au plus `maxStep`. */
export function approach(cur, target, maxStep) {
  const d = target - cur;
  if (d > maxStep) return cur + maxStep;
  if (d < -maxStep) return cur - maxStep;
  return target;
}

/** Hachage entier 32 bits (bon mélange, déterministe partout). */
export function hash32(a) {
  a = a | 0;
  a = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
  a = Math.imul(a ^ (a >>> 15), 0x735a2d97);
  return (a ^ (a >>> 15)) >>> 0;
}

/** Nombre pseudo-aléatoire dans [0,1[ à partir de deux entiers. */
export function rand2(a, b) {
  return hash32(Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) / 4294967296;
}

/** Générateur mulberry32 : renvoie une fonction () => [0,1[. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Direction de visée à partir du lacet/tangage (convention Three.js : -Z devant, Y en haut). */
export function aimDir(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}

/**
 * Direction d'un projectile dévié dans un cône de demi-angle `spread` autour de la visée.
 * Déterministe : même (seed, index) => même direction côté client et serveur.
 */
export function shotDir(yaw, pitch, spread, seed, index, out) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  // base : f = devant, r = droite, u = haut (orthonormée)
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  const rx = cy, rz = -sy;                      // droite (ry = 0)
  const ux = sy * sp, uy = cp, uz = cy * sp;    // haut = r x f
  if (spread <= 0) { out[0] = fx; out[1] = fy; out[2] = fz; return out; }
  const u1 = rand2(seed, index * 2 + 1);
  const u2 = rand2(seed, index * 2 + 2);
  const r = Math.tan(spread) * Math.sqrt(u1);
  const a = TAU * u2;
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  let dx = fx + rx * ox + ux * oy;
  let dy = fy + uy * oy;
  let dz = fz + rz * ox + uz * oy;
  const inv = 1 / Math.hypot(dx, dy, dz);
  out[0] = dx * inv; out[1] = dy * inv; out[2] = dz * inv;
  return out;
}

export function dist2(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}
