// Combat côté serveur : tirs instantanés avec compensation de latence, dégâts, explosions, projectiles.

import { MAX_REWIND_MS, HITK, MAT_SURF, SURF, FACE_NORMALS } from '../public/shared/constants.js';
import { shotDir, aimDir, clamp } from '../public/shared/mathx.js';
import { W, GRENADE, MELEE, WEAPONS } from '../public/shared/weapons.js';
import { rayVsActor, rayCylinder, ZONE, chestHeight, headHeight } from '../public/shared/hitbox.js';
import { eyeHeight } from '../public/shared/physics.js';
import { EV, HF, NO_ACTOR } from '../public/shared/protocol.js';
import { makeHit } from '../public/shared/world.js';
import { BARREL } from '../public/shared/maps/index.js';

const HN = 48;                    // ~1,6 s d'historique à 30 Hz
const _hit = makeHit();
const _dir = [0, 0, 0];
const _s = { x: 0, y: 0, z: 0, crouch: false };

// ---------------------------------------------------------------------------------------------
// Historique de positions (compensation de latence)
// ---------------------------------------------------------------------------------------------

export function histInit(a) {
  a.hT = new Float64Array(HN);
  a.hP = new Float32Array(HN * 3);
  a.hC = new Uint8Array(HN);
  a.hI = 0; a.hN = 0;
}
export function histClear(a) { a.hI = 0; a.hN = 0; }
export function histPush(a, t) {
  const i = a.hI;
  a.hT[i] = t;
  a.hP[i * 3] = a.move.x; a.hP[i * 3 + 1] = a.move.y; a.hP[i * 3 + 2] = a.move.z;
  a.hC[i] = a.move.crouching ? 1 : 0;
  a.hI = (i + 1) % HN;
  if (a.hN < HN) a.hN++;
}
/** Position de l'acteur telle qu'elle était à l'instant t (interpolée). */
export function histSample(a, t, out) {
  if (a.hN === 0) { out.x = a.move.x; out.y = a.move.y; out.z = a.move.z; out.crouch = a.move.crouching; return out; }
  let newer = -1;
  for (let k = 0; k < a.hN; k++) {
    const i = (a.hI - 1 - k + HN * 2) % HN;       // du plus récent au plus ancien
    if (a.hT[i] <= t) {
      if (newer < 0) { out.x = a.move.x; out.y = a.move.y; out.z = a.move.z; out.crouch = a.move.crouching; return out; }
      const span = a.hT[newer] - a.hT[i];
      const f = span > 0 ? (t - a.hT[i]) / span : 0;
      out.x = a.hP[i * 3] + (a.hP[newer * 3] - a.hP[i * 3]) * f;
      out.y = a.hP[i * 3 + 1] + (a.hP[newer * 3 + 1] - a.hP[i * 3 + 1]) * f;
      out.z = a.hP[i * 3 + 2] + (a.hP[newer * 3 + 2] - a.hP[i * 3 + 2]) * f;
      out.crouch = a.hC[i] === 1;
      return out;
    }
    newer = i;
  }
  // plus ancien que tout l'historique : on prend l'entrée la plus vieille
  out.x = a.hP[newer * 3]; out.y = a.hP[newer * 3 + 1]; out.z = a.hP[newer * 3 + 2]; out.crouch = a.hC[newer] === 1;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dégâts
// ---------------------------------------------------------------------------------------------

function falloff(def, dist) {
  const [a, b, min] = def.falloff;
  if (dist <= a) return 1;
  if (dist >= b) return min;
  return 1 - (1 - min) * ((dist - a) / (b - a));
}

/**
 * Inflige des dégâts. Renvoie vrai si la victime est tuée.
 * (dx,dy,dz) : direction de l'impact, transmise aux clients pour les effets (sang, ragdoll).
 */
export function applyDamage(room, v, attacker, dmg, weapon, flags, dx, dy, dz) {
  if (!v.alive || dmg <= 0) return false;
  if (room.time < v.protectedUntil) return false;
  if (room.mode.phase === 'end') return false;
  let amount = dmg;
  if (v.armor > 0 && weapon !== W.FALL && weapon !== W.BLEED) {
    const absorb = Math.min(v.armor, amount * 0.55);
    v.armor -= absorb;
    amount -= absorb;
    flags |= HF.ARMOR;
  }
  v.hp -= amount;
  v.lastHurtAt = room.time;
  if (attacker && attacker !== v) {
    const rec = v.damagers.get(attacker.id);
    if (rec) { rec.dmg += amount; rec.t = room.time; } else v.damagers.set(attacker.id, { dmg: amount, t: room.time });
    if (v.brain) room.ai.onHurt(v, attacker);
    attacker.dmgDealt += amount;
  }
  const killed = v.hp <= 0;
  if (killed) {
    flags |= HF.KILL;
    if ((flags & HF.HEAD) && (weapon === W.SNIPER || weapon === W.SHOTGUN || weapon === W.LMG || weapon === W.MINIGUN || Math.random() < 0.35)) flags |= HF.BEHEAD;
    if ((flags & HF.NOSHOT) && (weapon === W.GRENADE || weapon === W.RPG || weapon === W.BARREL) && dmg >= 55) flags |= HF.GIB;
  }
  const len = Math.hypot(dx, dy, dz) || 1;
  room.ev.u8(EV.HIT).u16(v.id).u16(attacker ? attacker.id : NO_ACTOR).u8(weapon)
    .u8(Math.min(255, Math.round(dmg))).u8(flags)
    .i8(Math.round(dx / len * 127)).i8(Math.round(dy / len * 127)).i8(Math.round(dz / len * 127));
  room.evCount++;
  if (killed) room.killActor(v, attacker, weapon, flags);
  return killed;
}

// ---------------------------------------------------------------------------------------------
// Tirs
// ---------------------------------------------------------------------------------------------

const _victims = [], _vdmg = [], _vflags = [], _vdir = [];

/** Tir d'une arme (appelé quand la machine à états de l'arme émet FIRE). */
export function fireWeapon(room, a, def, seed, spread) {
  const m = a.move;
  const ox = m.x, oy = m.y + eyeHeight(m.crouching) * a.scale, oz = m.z;
  a.lastShotAt = room.time;
  a.protectedUntil = 0;

  if (def.projectile) {
    shotDir(a.yaw, a.pitch, spread, seed, 0, _dir);
    spawnRocket(room, a, ox + _dir[0] * 0.5, oy + _dir[1] * 0.5 - 0.08, oz + _dir[2] * 0.5, _dir[0], _dir[1], _dir[2], def);
    // un tir sans impact : sert aux clients pour le son, le flash et le recul vus de l'extérieur
    room.ev.u8(EV.SHOT).u16(a.id).u8(def.id).u8(0);
    room.evCount++;
    return;
  }

  const world = room.world;
  const rewind = a.client ? clamp(a.renderTime, room.time - MAX_REWIND_MS, room.time) : -1;
  const actors = room.actorList;
  const dmgScale = a.def.dmgMul * room.mode.damageScale(a);
  _victims.length = 0; _vdmg.length = 0; _vflags.length = 0; _vdir.length = 0;

  const ev = room.ev;
  ev.u8(EV.SHOT).u16(a.id).u8(def.id).u8(def.pellets);
  room.evCount++;

  for (let i = 0; i < def.pellets; i++) {
    shotDir(a.yaw, a.pitch, spread, seed, i, _dir);
    const dx = _dir[0], dy = _dir[1], dz = _dir[2];
    let best = def.range, kind = HITK.NONE, face = 0, surf = 0;
    let victim = null, zone = 0, barrel = null;
    if (world.raycast(ox, oy, oz, dx, dy, dz, best, _hit)) {
      best = _hit.t; kind = HITK.WORLD; face = _hit.face; surf = MAT_SURF[world.mat[_hit.box]];
    }
    for (let k = 0; k < actors.length; k++) {
      const t = actors[k];
      if (!t.alive || t === a || !room.mode.canDamage(a, t)) continue;
      let px, py, pz, cr;
      if (rewind >= 0) { histSample(t, rewind, _s); px = _s.x; py = _s.y; pz = _s.z; cr = _s.crouch; }
      else { px = t.move.x; py = t.move.y; pz = t.move.z; cr = t.move.crouching; }
      const h = rayVsActor(ox, oy, oz, dx, dy, dz, px, py, pz, cr, t.scale, best);
      if (h && h.t < best) { best = h.t; victim = t; zone = h.zone; barrel = null; }
    }
    for (let k = 0; k < room.barrels.length; k++) {
      const b = room.barrels[k];
      if (!b.alive) continue;
      const t = rayCylinder(ox, oy, oz, dx, dy, dz, b.x, b.z, b.y, b.y + BARREL.height, BARREL.radius);
      if (t >= 0 && t < best) { best = t; barrel = b; victim = null; }
    }
    const ex = ox + dx * best, ey = oy + dy * best, ez = oz + dz * best;
    if (victim) {
      kind = zone === ZONE.HEAD ? HITK.HEAD : HITK.FLESH;
      const mul = zone === ZONE.HEAD ? def.headMul * (victim.def.boss ? 0.5 : 1) : zone === ZONE.LEGS ? def.legMul : 1;
      const dmg = def.dmg * falloff(def, best) * mul * dmgScale;
      let idx = _victims.indexOf(victim);
      if (idx < 0) { idx = _victims.length; _victims.push(victim); _vdmg.push(0); _vflags.push(0); _vdir.push(dx, dy, dz); }
      _vdmg[idx] += dmg;
      if (zone === ZONE.HEAD) _vflags[idx] |= HF.HEAD;
      face = 0; surf = 0;
    } else if (barrel) {
      kind = HITK.WORLD; surf = SURF.METAL;
      face = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 0) : (dz > 0 ? 5 : 4);
      barrel.hp -= def.dmg * falloff(def, best);
      if (barrel.hp <= 0 && barrel.fuseAt === 0) { barrel.fuseAt = room.time + 60; barrel.by = a; }
    }
    ev.pos3(ex, ey, ez).u8(kind).u8(face | (surf << 4));
  }
  for (let i = 0; i < _victims.length; i++) {
    applyDamage(room, _victims[i], a, _vdmg[i], def.id, _vflags[i], _vdir[i * 3], _vdir[i * 3 + 1], _vdir[i * 3 + 2]);
  }
}

/** Coup de couteau : touche l'ennemi le plus proche dans un cône devant l'attaquant. */
export function meleeAttack(room, a) {
  const m = a.move;
  const ox = m.x, oy = m.y + eyeHeight(m.crouching) * a.scale, oz = m.z;
  aimDir(a.yaw, a.pitch, _dir);
  a.lastShotAt = room.time;
  a.protectedUntil = 0;
  room.ev.u8(EV.MELEE).u16(a.id);
  room.evCount++;
  let best = null, bd = MELEE.range + 0.4;
  for (const t of room.actorList) {
    if (!t.alive || t === a || !room.mode.canDamage(a, t)) continue;
    const cx = t.move.x - ox, cy = t.move.y + chestHeight(t.move.crouching, t.scale) - oy, cz = t.move.z - oz;
    const d = Math.hypot(cx, cy, cz);
    if (d > bd || d < 1e-3) continue;
    const dot = (cx * _dir[0] + cy * _dir[1] + cz * _dir[2]) / d;
    if (dot < 0.6) continue;
    if (room.world.segmentBlocked(ox, oy, oz, t.move.x, t.move.y + chestHeight(t.move.crouching, t.scale), t.move.z)) continue;
    bd = d; best = t;
  }
  if (!best) return;
  // coup dans le dos : la victime regarde dans la même direction que l'attaquant
  const back = Math.cos(best.yaw - a.yaw) > 0.45 && !best.def.boss;
  const dmg = MELEE.dmg * (back ? MELEE.backstabMul : 1) * a.def.dmgMul * room.mode.damageScale(a) * (a.def.id === 0 ? 1 : 1.6);
  applyDamage(room, best, a, dmg, W.KNIFE, HF.NOSHOT, _dir[0], _dir[1], _dir[2]);
}

// ---------------------------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------------------------

/** kind : 0 grenade, 1 roquette, 2 baril */
export function explode(room, x, y, z, radius, maxDmg, attacker, weapon, kind) {
  room.ev.u8(EV.EXPLODE).pos3(x, y, z).u8(kind);
  room.evCount++;
  const world = room.world;
  const cy = y + 0.15;
  const scale = attacker ? attacker.def.dmgMul * room.mode.damageScale(attacker) : 1;
  const list = room.actorList.slice();
  for (const t of list) {
    if (!t.alive) continue;
    const m = t.move;
    const head = headHeight(m.crouching, t.scale), chest = chestHeight(m.crouching, t.scale);
    const ny = clamp(y, m.y + 0.15, m.y + head);
    const d = Math.hypot(m.x - x, ny - y, m.z - z);
    if (d >= radius) continue;
    const self = t === attacker;
    if (!self && attacker && !room.mode.canDamage(attacker, t)) continue;
    if (world.segmentBlocked(x, cy, z, m.x, m.y + chest, m.z)
      && world.segmentBlocked(x, cy, z, m.x, m.y + head, m.z)
      && world.segmentBlocked(x, cy, z, m.x, m.y + 0.25, m.z)) continue;
    const frac = 1 - d / radius;
    let dmg = maxDmg * (0.12 + 0.88 * frac) * (self ? 0.55 : scale);
    if (t.def.boss) dmg *= 0.6;
    let dx = m.x - x, dy = m.y + chest - y, dz = m.z - z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    if (!t.def.boss) {
      const push = 4 + 9 * frac;
      m.vx += dx * push; m.vz += dz * push; m.vy += 2.5 + 4 * frac;
      m.onGround = false;
    }
    applyDamage(room, t, attacker, dmg, weapon, HF.NOSHOT, dx, dy + 0.35, dz);
  }
  for (const b of room.barrels) {
    if (!b.alive || b.fuseAt !== 0) continue;
    const d = Math.hypot(b.x - x, b.y + 0.5 - y, b.z - z);
    if (d < radius * 0.9 && !world.segmentBlocked(x, cy, z, b.x, b.y + 0.6, b.z)) {
      b.fuseAt = room.time + 130 + Math.random() * 260;
      b.by = attacker;
    }
  }
}

export function explodeBarrel(room, b) {
  b.alive = false;
  b.fuseAt = 0;
  b.respawnAt = room.time + BARREL.respawn * 1000;
  room.broadcast({ t: 'brl', i: b.id, on: 0 });
  const by = b.by && room.actors.has(b.by.id) ? b.by : null;
  explode(room, b.x, b.y + 0.5, b.z, BARREL.blast, BARREL.dmg, by, W.BARREL, 2);
}

// ---------------------------------------------------------------------------------------------
// Projectiles (grenades, roquettes)
// ---------------------------------------------------------------------------------------------

export const PROJ = { GRENADE: 0, ROCKET: 1 };

export function spawnGrenade(room, a, vx, vy, vz) {
  const m = a.move;
  const eye = m.y + eyeHeight(m.crouching) * a.scale;
  if (vx === undefined) {
    aimDir(a.yaw, a.pitch + 0.12, _dir);
    vx = _dir[0] * GRENADE.throwSpeed + m.vx * 0.6;
    vy = _dir[1] * GRENADE.throwSpeed + 1.5;
    vz = _dir[2] * GRENADE.throwSpeed + m.vz * 0.6;
  }
  aimDir(a.yaw, 0, _dir);
  // départ légèrement devant le lanceur, en vérifiant qu'on ne traverse pas un mur
  let sx = m.x + _dir[0] * 0.45, sz = m.z + _dir[2] * 0.45;
  const sy = eye - 0.1;
  if (room.world.segmentBlocked(m.x, sy, m.z, sx, sy, sz)) { sx = m.x; sz = m.z; }
  room.projectiles.push({
    id: room.nextProjId(), type: PROJ.GRENADE, x: sx, y: sy, z: sz, vx, vy, vz,
    owner: a, fuse: GRENADE.fuse, rest: false, travelled: 0,
  });
  room.ev.u8(EV.THROW).u16(a.id);
  room.evCount++;
  a.protectedUntil = 0;
}

function spawnRocket(room, a, x, y, z, dx, dy, dz, def) {
  const p = def.projectile;
  room.projectiles.push({
    id: room.nextProjId(), type: PROJ.ROCKET, x, y, z, vx: dx * p.speed, vy: dy * p.speed, vz: dz * p.speed,
    owner: a, fuse: p.life, rest: false, travelled: 0,
  });
}

export function updateProjectiles(room, dt) {
  const world = room.world;
  const list = room.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.fuse -= dt;
    let boom = p.fuse <= 0;
    const owner = room.actors.has(p.owner.id) ? p.owner : null;
    if (p.type === PROJ.GRENADE) {
      if (!p.rest) {
        let remaining = dt;
        for (let iter = 0; iter < 3 && remaining > 1e-5; iter++) {
          p.vy -= 19 * remaining;
          const sp = Math.hypot(p.vx, p.vy, p.vz);
          if (sp < 1e-4) break;
          const dist = sp * remaining;
          const dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
          if (world.raycast(p.x, p.y, p.z, dx, dy, dz, dist + 0.06, _hit)) {
            const t = Math.max(0, _hit.t - 0.06);
            p.x += dx * t; p.y += dy * t; p.z += dz * t;
            const n = FACE_NORMALS[_hit.face];
            const vn = p.vx * n[0] + p.vy * n[1] + p.vz * n[2];
            p.vx = (p.vx - 2 * vn * n[0]); p.vy = (p.vy - 2 * vn * n[1]); p.vz = (p.vz - 2 * vn * n[2]);
            // amortissement : fort sur la composante normale, modéré sur la tangentielle
            const vn2 = p.vx * n[0] + p.vy * n[1] + p.vz * n[2];
            p.vx = (p.vx - vn2 * n[0]) * 0.72 + vn2 * n[0] * 0.42;
            p.vy = (p.vy - vn2 * n[1]) * 0.72 + vn2 * n[1] * 0.42;
            p.vz = (p.vz - vn2 * n[2]) * 0.72 + vn2 * n[2] * 0.42;
            remaining *= 1 - (dist > 0 ? t / dist : 1);
            if (n[1] > 0.5 && Math.hypot(p.vx, p.vy, p.vz) < 1.4) { p.rest = true; p.vx = p.vy = p.vz = 0; break; }
          } else {
            p.x += dx * dist; p.y += dy * dist; p.z += dz * dist;
            remaining = 0;
          }
        }
        if (p.y < -5) boom = true;
      }
      if (boom) {
        list.splice(i, 1);
        if (p.y >= -5) explode(room, p.x, p.y + 0.1, p.z, GRENADE.radius, GRENADE.dmg, owner, W.GRENADE, 0);
      }
    } else {
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      const dist = sp * dt;
      const dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
      let best = dist, hit = false;
      if (world.raycast(p.x, p.y, p.z, dx, dy, dz, dist, _hit)) { best = _hit.t; hit = true; }
      for (const t of room.actorList) {
        if (!t.alive || t === p.owner) continue;
        if (owner && !room.mode.canDamage(owner, t)) continue;
        const h = rayVsActor(p.x, p.y, p.z, dx, dy, dz, t.move.x, t.move.y, t.move.z, t.move.crouching, t.scale * 1.15, best);
        if (h && h.t < best) { best = h.t; hit = true; }
      }
      for (const b of room.barrels) {
        if (!b.alive) continue;
        const t = rayCylinder(p.x, p.y, p.z, dx, dy, dz, b.x, b.z, b.y, b.y + BARREL.height, BARREL.radius);
        if (t >= 0 && t < best) { best = t; hit = true; }
      }
      p.x += dx * best; p.y += dy * best; p.z += dz * best;
      p.travelled += best;
      if (hit || boom || Math.abs(p.x) > 300 || Math.abs(p.z) > 300 || p.y > 200) {
        list.splice(i, 1);
        if (hit || boom) {
          const def = WEAPONS[W.RPG];
          explode(room, p.x - dx * 0.15, p.y - dy * 0.15, p.z - dz * 0.15, def.projectile.radius, def.dmg, owner, W.RPG, 1);
        }
      }
    }
  }
}
