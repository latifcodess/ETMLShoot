// Zones de touche d'un personnage : jambes et torse en cylindres verticaux, tête en sphère.
// Utilisé par le serveur (autorité, avec compensation de latence) et par le client (effets prédits).

export const ZONE = { NONE: 0, LEGS: 1, TORSO: 2, HEAD: 3 };

const STAND = { legsTop: 0.84, torsoTop: 1.5, headY: 1.655, legsR: 0.25, torsoR: 0.3, headR: 0.17 };
const CROUCH = { legsTop: 0.5, torsoTop: 1.02, headY: 1.15, legsR: 0.28, torsoR: 0.3, headR: 0.17 };

const _out = { t: 0, zone: 0 };

export function rayCylinder(ox, oy, oz, dx, dy, dz, px, pz, y0, y1, r) {
  // Intersection de deux convexes : cylindre infini x²+z²<=r² et tranche y0<=y<=y1.
  const rx = ox - px, rz = oz - pz;
  const a = dx * dx + dz * dz;
  const c = rx * rx + rz * rz - r * r;
  let tIn = -Infinity, tOut = Infinity;
  if (a < 1e-12) {
    if (c > 0) return -1;
  } else {
    const b = rx * dx + rz * dz;
    const disc = b * b - a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    tIn = (-b - sq) / a;
    tOut = (-b + sq) / a;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < y0 || oy > y1) return -1;
  } else {
    let ta = (y0 - oy) / dy, tb = (y1 - oy) / dy;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > tIn) tIn = ta;
    if (tb < tOut) tOut = tb;
  }
  if (tIn > tOut || tOut < 0) return -1;
  return tIn < 0 ? 0 : tIn;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const rx = ox - cx, ry = oy - cy, rz = oz - cz;
  const b = rx * dx + ry * dy + rz * dz;
  const c = rx * rx + ry * ry + rz * rz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = -b + sq;
  if (t1 < 0) return -1;
  const t0 = -b - sq;
  return t0 < 0 ? 0 : t0;
}

/**
 * Rayon (direction normalisée) contre un personnage dont les pieds sont en (px,py,pz).
 * @returns {{t:number, zone:number}|null} l'objet renvoyé est réutilisé : le copier si besoin.
 */
export function rayVsActor(ox, oy, oz, dx, dy, dz, px, py, pz, crouching, scale, maxT) {
  // Rejet rapide : distance du rayon à l'axe vertical du personnage
  const rx = px - ox, rz = pz - oz;
  const along = rx * dx + rz * dz;
  // derrière le tireur (sauf tir quasi vertical)
  if (along < -1.5 * scale && dx * dx + dz * dz > 0.05) return null;
  const S = crouching ? CROUCH : STAND;
  let best = maxT, zone = ZONE.NONE;
  let t = raySphere(ox, oy, oz, dx, dy, dz, px, py + S.headY * scale, pz, S.headR * scale);
  if (t >= 0 && t < best) { best = t; zone = ZONE.HEAD; }
  t = rayCylinder(ox, oy, oz, dx, dy, dz, px, pz, py + S.legsTop * scale, py + S.torsoTop * scale, S.torsoR * scale);
  if (t >= 0 && t < best) { best = t; zone = ZONE.TORSO; }
  t = rayCylinder(ox, oy, oz, dx, dy, dz, px, pz, py, py + S.legsTop * scale, S.legsR * scale);
  if (t >= 0 && t < best) { best = t; zone = ZONE.LEGS; }
  if (zone === ZONE.NONE) return null;
  _out.t = best; _out.zone = zone;
  return _out;
}

/** Hauteur du centre du torse (point visé par l'IA, origine des effets de sang). */
export function chestHeight(crouching, scale = 1) {
  return (crouching ? 0.8 : 1.2) * scale;
}
export function headHeight(crouching, scale = 1) {
  return (crouching ? CROUCH.headY : STAND.headY) * scale;
}
