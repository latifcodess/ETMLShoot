// Logique réseau du client, sans aucune dépendance au navigateur (testable sous Node) :
//   * décodage des snapshots binaires et encodage des commandes
//   * horloge serveur estimée
//   * prédiction locale du joueur + réconciliation avec l'état faisant autorité
//   * tampon d'interpolation des entités distantes

import { ByteReader, ByteWriter, MSG, EV, OF, quantYaw, dequantYaw, quantPitch, dequantPitch } from '../shared/protocol.js';
import { SIM_DT, INTERP_DELAY_MS } from '../shared/constants.js';
import { createMoveState, copyMoveState } from '../shared/physics.js';
import { createWeaponState, copyWeaponState, NUM_SLOTS } from '../shared/weapons.js';
import { simulate } from '../shared/sim.js';

// ---------------------------------------------------------------------------------------------
// Décodage / encodage
// ---------------------------------------------------------------------------------------------

/** Décode un snapshot. Les tableaux renvoyés appartiennent à l'appelant. */
export function decodeSnapshot(data) {
  const r = new ByteReader(data);
  if (r.u8() !== MSG.SNAPSHOT) return null;
  const snap = { time: r.u32(), ack: r.u32(), own: null, actors: [], index: new Map(), projectiles: [], events: [] };

  // --- bloc « moi »
  const f = r.u8();
  const own = {
    alive: (f & OF.ALIVE) !== 0, protected: (f & OF.PROTECTED) !== 0, spawnCount: r.u8(),
    move: createMoveState(), hp: 0, armor: 0, ws: createWeaponState(),
  };
  const m = own.move;
  m.x = r.f32(); m.y = r.f32(); m.z = r.f32(); m.vx = r.f32(); m.vy = r.f32(); m.vz = r.f32();
  m.onGround = (f & OF.GROUND) !== 0; m.crouching = (f & OF.CROUCH) !== 0;
  own.hp = r.u8(); own.armor = r.u8();
  const ws = own.ws;
  ws.prevButtons = r.u16();
  ws.cur = r.u8(); ws.grenades = r.u8(); ws.ads = r.u8() / 255;
  ws.cooldown = r.f32(); ws.reloadT = r.f32(); ws.switchT = r.f32(); ws.meleeT = r.f32(); ws.nadeT = r.f32(); ws.heat = r.f32();
  for (let i = 0; i < NUM_SLOTS; i++) { ws.slots[i].id = r.i8(); ws.slots[i].ammo = r.u16(); ws.slots[i].reserve = r.u16(); }
  snap.own = own;

  // --- acteurs
  const n = r.u16();
  for (let i = 0; i < n; i++) {
    const a = {
      id: r.u16(), x: r.p16(), y: r.p16(), z: r.p16(),
      yaw: dequantYaw(r.u16()), pitch: r.i8() * (1.5708 / 127),
      flags: r.u8(), weapon: r.u8(), hp: r.u8() / 200,
    };
    snap.actors.push(a);
    snap.index.set(a.id, a);
  }
  // --- projectiles
  const np = r.u8();
  for (let i = 0; i < np; i++) snap.projectiles.push({ id: r.u16(), type: r.u8(), x: r.p16(), y: r.p16(), z: r.p16() });
  // --- événements
  const ne = r.u16();
  for (let i = 0; i < ne; i++) {
    const type = r.u8();
    if (type === EV.SHOT) {
      const e = { type, shooter: r.u16(), weapon: r.u8(), pts: [] };
      const k = r.u8();
      for (let j = 0; j < k; j++) {
        const x = r.p16(), y = r.p16(), z = r.p16(), kind = r.u8(), fs = r.u8();
        e.pts.push({ x, y, z, kind, face: fs & 15, surf: fs >> 4 });
      }
      snap.events.push(e);
    } else if (type === EV.HIT) {
      snap.events.push({
        type, victim: r.u16(), attacker: r.u16(), weapon: r.u8(), dmg: r.u8(), flags: r.u8(),
        dx: r.i8() / 127, dy: r.i8() / 127, dz: r.i8() / 127,
      });
    } else if (type === EV.EXPLODE) {
      snap.events.push({ type, x: r.p16(), y: r.p16(), z: r.p16(), kind: r.u8() });
    } else if (type === EV.MELEE || type === EV.THROW) {
      snap.events.push({ type, actor: r.u16() });
    } else {
      break;   // type inconnu : on ne peut pas continuer à décoder la suite
    }
  }
  return snap;
}

const _iw = new ByteWriter(256);

/** Encode un lot de commandes consécutives. cmds : [{buttons, yawQ, pitchQ}] */
export function encodeInput(firstSeq, renderTime, cmds) {
  const w = _iw.reset();
  w.u8(MSG.INPUT).u32(firstSeq).u32(Math.max(0, Math.round(renderTime))).u8(cmds.length);
  for (const c of cmds) w.u16(c.buttons).u16(c.yawQ).i16(c.pitchQ);
  return w.view().slice();
}

export { quantYaw, dequantYaw, quantPitch, dequantPitch };

// ---------------------------------------------------------------------------------------------
// Horloge serveur
// ---------------------------------------------------------------------------------------------

/**
 * Estime l'heure du serveur à partir de l'horodatage des snapshots.
 * La gigue réseau ne peut que RETARDER un paquet : on retient donc l'écart le plus favorable,
 * avec une lente dérive vers le bas pour suivre les horloges qui glissent.
 */
export class ServerClock {
  constructor() { this.offset = null; }
  onSnapshot(serverTime, now) {
    const o = serverTime - now;
    if (this.offset === null || Math.abs(o - this.offset) > 400) this.offset = o;
    else this.offset = Math.max(o, this.offset - 0.25);
  }
  now(localNow) { return this.offset === null ? 0 : localNow + this.offset; }
  renderTime(localNow) { return this.now(localNow) - INTERP_DELAY_MS; }
}

// ---------------------------------------------------------------------------------------------
// Prédiction et réconciliation
// ---------------------------------------------------------------------------------------------

const POOL = 256;

export class Predictor {
  constructor(world) {
    this.world = world;
    this.move = createMoveState();
    this.prev = createMoveState();       // état précédent, pour l'interpolation de rendu
    this.ws = createWeaponState();
    this.alive = false;
    this.spawnCount = -1;
    this.speed = 1;
    this.pool = [];
    for (let i = 0; i < POOL; i++) this.pool.push({ seq: 0, buttons: 0, yaw: 0, move: createMoveState(), ws: createWeaponState() });
    this.head = 0;                        // index du plus ancien élément en attente
    this.count = 0;
    this.ackMove = createMoveState();
    this.ackWs = createWeaponState();
    this.ackSeq = 0;
    this.hasAck = false;
    this.errX = 0; this.errY = 0; this.errZ = 0;   // erreur visuelle à résorber en douceur
    this.corrections = 0;
    this.evs = [];
    this.silent = [];
    this.respawned = false;
  }

  /**
   * Simule une nouvelle commande. Renvoie la vitesse d'atterrissage ;
   * les événements d'arme sont dans this.evs (à consommer avant le prochain appel).
   */
  step(seq, buttons, yaw) {
    copyMoveState(this.prev, this.move);
    this.evs.length = 0;
    let land = 0;
    if (this.alive) land = simulate(this.move, this.ws, buttons, yaw, SIM_DT, this.world, this.speed, this.evs);
    else this.ws.prevButtons = buttons;
    if (this.count === POOL) { this.head = (this.head + 1) % POOL; this.count--; }
    const e = this.pool[(this.head + this.count) % POOL];
    this.count++;
    e.seq = seq; e.buttons = buttons; e.yaw = yaw;
    copyMoveState(e.move, this.move);
    copyWeaponState(e.ws, this.ws);
    return land;
  }

  _differs(m, ws, om, ows) {
    if (Math.abs(m.x - om.x) > 0.008 || Math.abs(m.y - om.y) > 0.008 || Math.abs(m.z - om.z) > 0.008) return true;
    if (Math.abs(m.vx - om.vx) > 0.05 || Math.abs(m.vy - om.vy) > 0.05 || Math.abs(m.vz - om.vz) > 0.05) return true;
    if (m.onGround !== om.onGround || m.crouching !== om.crouching) return true;
    if (ws.cur !== ows.cur || ws.grenades !== ows.grenades) return true;
    for (let i = 0; i < NUM_SLOTS; i++) {
      const a = ws.slots[i], b = ows.slots[i];
      if (a.id !== b.id || a.ammo !== b.ammo || a.reserve !== b.reserve) return true;
    }
    if (Math.abs(ws.reloadT - ows.reloadT) > 0.03 || Math.abs(ws.switchT - ows.switchT) > 0.03) return true;
    if (Math.abs(ws.cooldown - ows.cooldown) > 0.03) return true;
    return false;
  }

  /** Confronte la prédiction à l'état serveur du snapshot. Renvoie vrai s'il a fallu corriger. */
  reconcile(snap) {
    const own = snap.own, ack = snap.ack;
    this.respawned = false;
    // on retire les commandes acquittées, en gardant l'état prédit pour la dernière
    let matched = false;
    while (this.count > 0) {
      const e = this.pool[this.head];
      if (e.seq > ack) break;
      if (e.seq === ack) { copyMoveState(this.ackMove, e.move); copyWeaponState(this.ackWs, e.ws); matched = true; }
      this.head = (this.head + 1) % POOL;
      this.count--;
    }
    if (matched) { this.ackSeq = ack; this.hasAck = true; }

    const spawned = own.alive && (!this.alive || own.spawnCount !== this.spawnCount);
    const wasAlive = this.alive;
    this.alive = own.alive;
    this.spawnCount = own.spawnCount;
    if (!own.alive) {
      if (wasAlive) { copyMoveState(this.move, own.move); copyMoveState(this.prev, own.move); copyWeaponState(this.ws, own.ws); }
      this.hasAck = false;
      return false;
    }

    if (!spawned && this.hasAck && !this._differs(this.ackMove, this.ackWs, own.move, own.ws)) return false;

    // --- correction : on repart de l'état serveur et on rejoue les commandes non acquittées
    const bx = this.move.x, by = this.move.y, bz = this.move.z;
    copyMoveState(this.move, own.move);
    copyWeaponState(this.ws, own.ws);
    copyMoveState(this.ackMove, own.move);
    copyWeaponState(this.ackWs, own.ws);
    this.ackSeq = ack; this.hasAck = true;
    for (let i = 0; i < this.count; i++) {
      const e = this.pool[(this.head + i) % POOL];
      this.silent.length = 0;
      simulate(this.move, this.ws, e.buttons, e.yaw, SIM_DT, this.world, this.speed, this.silent);
      copyMoveState(e.move, this.move);
      copyWeaponState(e.ws, this.ws);
    }
    if (spawned) {
      this.errX = this.errY = this.errZ = 0;
      copyMoveState(this.prev, this.move);
      this.respawned = true;
    } else {
      const ex = bx - this.move.x, ey = by - this.move.y, ez = bz - this.move.z;
      const d = Math.hypot(ex, ey, ez);
      if (d < 2.5) { this.errX += ex; this.errY += ey; this.errZ += ez; }
      else { this.errX = this.errY = this.errZ = 0; }
      // l'état précédent subit la même translation pour ne pas créer de saut d'interpolation
      this.prev.x -= ex; this.prev.y -= ey; this.prev.z -= ez;
      this.corrections++;
    }
    return true;
  }

  /** Résorbe l'erreur visuelle (à appeler une fois par image). */
  decayError(dt) {
    const k = Math.exp(-dt * 14);
    this.errX *= k; this.errY *= k; this.errZ *= k;
  }
}

// ---------------------------------------------------------------------------------------------
// Tampon d'interpolation
// ---------------------------------------------------------------------------------------------

export class SnapshotBuffer {
  constructor() { this.snaps = []; }
  clear() { this.snaps.length = 0; }
  push(snap) {
    const s = this.snaps;
    if (s.length && snap.time <= s[s.length - 1].time) return;    // doublon ou retour en arrière
    s.push(snap);
    if (s.length > 48) s.shift();
  }
  get latest() { return this.snaps.length ? this.snaps[this.snaps.length - 1] : null; }

  /**
   * Trouve les deux snapshots encadrant l'instant t.
   * @returns {{a, b, f}|null} f dans [0,1] ; a === b si un seul est disponible.
   */
  sample(t, out) {
    const s = this.snaps;
    if (!s.length) return null;
    if (t <= s[0].time) { out.a = s[0]; out.b = s[0]; out.f = 0; return out; }
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].time <= t) {
        if (i === s.length - 1) {
          // plus récent que tout : légère extrapolation bornée, portée par la paire précédente
          out.a = s[i]; out.b = s[i]; out.f = 0;
          if (i > 0) {
            const span = s[i].time - s[i - 1].time;
            const over = Math.min(t - s[i].time, 100);
            if (span > 0) { out.a = s[i - 1]; out.b = s[i]; out.f = 1 + over / span; }
          }
          return out;
        }
        out.a = s[i]; out.b = s[i + 1];
        const span = s[i + 1].time - s[i].time;
        out.f = span > 0 ? (t - s[i].time) / span : 0;
        return out;
      }
    }
    return null;
  }
}
