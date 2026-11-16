// Déplacement d'un personnage : même code pour la prédiction client et l'autorité serveur.
// Toute divergence entre les deux côtés provoque des corrections visibles : rester déterministe.

import { HULL, MOVE, BTN } from './constants.js';

const _res = { pos: 0, blocked: false, top: 0 };
const _res2 = { pos: 0, blocked: false, top: 0 };

/** État de déplacement. (x,y,z) = position des pieds. */
export function createMoveState() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, crouching: false };
}

export function copyMoveState(dst, src) {
  dst.x = src.x; dst.y = src.y; dst.z = src.z;
  dst.vx = src.vx; dst.vy = src.vy; dst.vz = src.vz;
  dst.onGround = src.onGround; dst.crouching = src.crouching;
  return dst;
}

/** Entrée analogique de déplacement, dérivée d'une commande ou produite par l'IA. */
export function createMoveInput() {
  return { mf: 0, ms: 0, yaw: 0, jump: false, crouch: false, sprint: false, speedMul: 1 };
}

/**
 * Convertit les boutons d'une commande en entrée de déplacement.
 * `speedMul` dépend de l'arme en main et de la visée (voir weapons.js).
 */
export function buttonsToMove(buttons, yaw, speedMul, inp) {
  let mf = 0, ms = 0;
  if (buttons & BTN.FWD) mf += 1;
  if (buttons & BTN.BACK) mf -= 1;
  if (buttons & BTN.RIGHT) ms += 1;
  if (buttons & BTN.LEFT) ms -= 1;
  inp.mf = mf; inp.ms = ms; inp.yaw = yaw;
  inp.jump = (buttons & BTN.JUMP) !== 0;
  inp.crouch = (buttons & BTN.CROUCH) !== 0;
  // On ne sprinte que vers l'avant, sans tirer ni viser.
  inp.sprint = (buttons & BTN.SPRINT) !== 0 && mf > 0 && (buttons & (BTN.FIRE | BTN.ADS | BTN.CROUCH)) === 0;
  inp.speedMul = speedMul;
  return inp;
}

function moveAxis(s, axis, d, world, hw, h, grounded) {
  if (d === 0) return;
  world.sweepAxis(axis, s.x, s.y, s.z, hw, h, d, _res);
  if (_res.blocked) {
    const rise = _res.top - s.y;
    const maxRise = grounded ? HULL.step : HULL.airStep;
    if (rise > 1e-6 && rise <= maxRise && world.hullFree(s.x, _res.top, s.z, hw, h)) {
      world.sweepAxis(axis, s.x, _res.top, s.z, hw, h, d, _res2);
      const gain = d > 0 ? _res2.pos - _res.pos : _res.pos - _res2.pos;
      if (gain > 1e-4) {
        s.y = _res.top;
        if (axis === 0) s.x = _res2.pos; else s.z = _res2.pos;
        if (_res2.blocked) { if (axis === 0) s.vx = 0; else s.vz = 0; }
        if (grounded) { s.onGround = true; if (s.vy < 0) s.vy = 0; }
        return;
      }
    }
    if (axis === 0) { s.x = _res.pos; s.vx = 0; } else { s.z = _res.pos; s.vz = 0; }
    return;
  }
  if (axis === 0) s.x = _res.pos; else s.z = _res.pos;
}

/**
 * Avance l'état d'un pas `dt`.
 * @returns vitesse d'impact à l'atterrissage (0 sinon), utile pour les dégâts de chute et le son.
 */
export function stepMove(s, inp, dt, world, hull = HULL) {
  const hw = hull.halfW;

  // --- Accroupissement (se relever exige la place au-dessus)
  if (inp.crouch) s.crouching = true;
  else if (s.crouching && world.hullFree(s.x, s.y, s.z, hw, hull.height)) s.crouching = false;
  const h = s.crouching ? hull.crouchHeight : hull.height;

  // --- Vitesse souhaitée
  let mf = inp.mf, ms = inp.ms;
  const len = Math.hypot(mf, ms);
  let wx = 0, wz = 0;
  const moving = len > 1e-6;
  if (moving) {
    const inv = 1 / (len > 1 ? len : 1);
    mf *= inv; ms *= inv;
    const speed = (s.crouching ? MOVE.crouch : (inp.sprint ? MOVE.sprint : MOVE.walk)) * inp.speedMul;
    const sn = Math.sin(inp.yaw), cs = Math.cos(inp.yaw);
    wx = (-sn * mf + cs * ms) * speed;
    wz = (-cs * mf - sn * ms) * speed;
  }
  const accel = s.onGround ? (moving ? MOVE.accel : MOVE.friction) : (moving ? MOVE.airAccel : 0);
  const dvx = wx - s.vx, dvz = wz - s.vz;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = accel * dt;
  if (dv > maxDv) {
    if (maxDv > 0) { s.vx += dvx / dv * maxDv; s.vz += dvz / dv * maxDv; }
  } else if (s.onGround || moving) {
    s.vx = wx; s.vz = wz;
  }

  // --- Saut et gravité
  const wasOnGround = s.onGround;
  let jumped = false;
  if (inp.jump && s.onGround) {
    s.vy = MOVE.jumpVel;
    s.onGround = false;
    jumped = true;
  }
  s.vy -= MOVE.gravity * dt;
  if (s.vy < -MOVE.maxFall) s.vy = -MOVE.maxFall;
  const fallSpeed = -s.vy;

  // --- Déplacements horizontaux (avec franchissement de marches)
  const grounded = wasOnGround && !jumped;
  moveAxis(s, 0, s.vx * dt, world, hw, h, grounded);
  moveAxis(s, 2, s.vz * dt, world, hw, h, grounded);

  // --- Déplacement vertical
  let landSpeed = 0;
  const dy = s.vy * dt;
  if (dy <= 0) {
    const gy = world.sweepDown(s.x, s.y, s.z, hw, -dy);
    if (gy > -Infinity) {
      if (!wasOnGround) landSpeed = fallSpeed;
      s.y = gy; s.vy = 0; s.onGround = true;
    } else {
      s.y += dy; s.onGround = false;
    }
  } else {
    const cy = world.sweepUp(s.x, s.y + h, s.z, hw, dy);
    if (cy < Infinity) { s.y = cy - h - 0.001; s.vy = 0; }
    else s.y += dy;
    s.onGround = false;
  }

  // --- Collage au sol en descendant un escalier
  if (grounded && !s.onGround && s.vy <= 0) {
    const gy = world.sweepDown(s.x, s.y, s.z, hw, hull.step);
    if (gy > -Infinity) { s.y = gy; s.vy = 0; s.onGround = true; }
  }
  return landSpeed;
}

/** Hauteur des yeux au-dessus des pieds. */
export function eyeHeight(crouching, hull = HULL) {
  return crouching ? hull.crouchEye : hull.eye;
}
