// Intelligence artificielle : bots (PvP) et ennemis de la survie coop.
//
// Une IA ne triche pas sur la physique : elle produit des entrées (direction, visée, boutons) qui
// passent par la même simulation que celles d'un joueur. Elle perçoit par lancers de rayon,
// se déplace sur le graphe de navigation, et vise avec une erreur qui dépend de la difficulté.

import { BTN, SLOT_SHIFT, SIM_DT, SUBSTEPS } from '../public/shared/constants.js';
import { wrapAngle, clamp } from '../public/shared/mathx.js';
import { W, WEAPONS, SLOT, WEV, GRENADE } from '../public/shared/weapons.js';
import { KIND } from '../public/shared/actors.js';
import { eyeHeight, createMoveInput } from '../public/shared/physics.js';
import { chestHeight, headHeight } from '../public/shared/anatomy.js';
import { spawnGrenade } from './combat.js';

const deg = Math.PI / 180;

export const BOT_PROFILES = [
  { react: 0.8, aimErr: 5.6 * deg, turn: 4.2, burst: [2, 5], pause: [0.55, 1.2], sight: 60, head: 0, strafe: 0.4, nade: 0.01 },
  { react: 0.45, aimErr: 3.1 * deg, turn: 6.5, burst: [3, 7], pause: [0.3, 0.8], sight: 75, head: 0.1, strafe: 0.7, nade: 0.03 },
  { react: 0.24, aimErr: 1.6 * deg, turn: 9.5, burst: [4, 9], pause: [0.18, 0.5], sight: 95, head: 0.28, strafe: 0.9, nade: 0.05 },
];

/** Portée [mini, idéale, maxi] selon l'arme tenue par un bot. */
const WEAPON_RANGE = {
  [W.PISTOL]: [2, 9, 26], [W.AR]: [5, 17, 48], [W.SMG]: [1, 8, 24], [W.SHOTGUN]: [0, 4.5, 13],
  [W.SNIPER]: [16, 38, 120], [W.LMG]: [6, 20, 52], [W.RPG]: [9, 20, 50], [W.KNIFE]: [0, 0.8, 4], [W.MINIGUN]: [0, 12, 44],
};

export const ENEMY_PROFILES = {
  [KIND.GRUNT]: { react: 0.75, aimErr: 4.4 * deg, turn: 5, burst: [3, 6], pause: [0.7, 1.5], sight: 58, range: [5, 15, 32], strafe: 0.5 },
  [KIND.RUSHER]: { react: 0.42, aimErr: 5.8 * deg, turn: 7.5, burst: [5, 10], pause: [0.3, 0.7], sight: 48, range: [0, 5, 13], strafe: 0.9, sprint: true },
  [KIND.HEAVY]: { react: 0.9, aimErr: 4.6 * deg, turn: 3.2, burst: [12, 26], pause: [0.9, 1.7], sight: 62, range: [4, 14, 36], strafe: 0.1 },
  [KIND.MARKSMAN]: { react: 1.8, aimErr: 1.0 * deg, turn: 4, burst: [1, 1], pause: [2.4, 3.6], sight: 115, range: [20, 42, 110], strafe: 0.1, ads: true },
  [KIND.GRENADIER]: { react: 0.6, aimErr: 5 * deg, turn: 5, burst: [1, 2], pause: [0.7, 1.3], sight: 52, range: [2, 8, 20], strafe: 0.5, nadeEvery: [5.5, 9.5] },
  [KIND.JUGGERNAUT]: { react: 0.5, aimErr: 4.2 * deg, turn: 2.6, burst: [45, 95], pause: [1.1, 2.1], sight: 85, range: [0, 9, 42], strafe: 0, nadeEvery: [7, 11], volley: 3 },
};

const MODE = { ROAM: 0, ADVANCE: 1, ENGAGE: 2, CHASE: 3 };

function gauss() {
  // somme de 4 uniformes : assez proche d'une gaussienne, écart-type ~0,58 → normalisé à 1
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.7321;
}
function rnd(a, b) { return a + Math.random() * (b - a); }
function rndInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }

export class AI {
  constructor(room) {
    this.room = room;
    this.fields = new Map();     // id du joueur ciblé → { node, t, dist }
    this.fieldBudget = 0;
    this.evs = [];
    this.inp = createMoveInput();
  }

  createBrain(a, profile) {
    a.brain = {
      p: profile,
      target: null, visible: false, seenAt: -1e9, acquiredAt: 0,
      lsx: 0, lsy: 0, lsz: 0, tvx: 0, tvz: 0,
      thinkAt: this.room.time + Math.random() * 120,
      mode: MODE.ROAM, node: -1,
      path: null, pathI: 0, repathAt: 0, goalX: 0, goalZ: 0, hasGoal: false,
      field: null,
      strafeDir: 0, strafeUntil: 0, crouch: false,
      errYaw: 0, errPitch: 0, aimHead: false,
      burstLeft: 0, pauseUntil: 0, nextTap: 0,
      stuck: 0, lx: a.move.x, lz: a.move.z, unstickUntil: 0, ux: 0, uz: 0, jumpUntil: 0,
      wantMove: false,
      alertUntil: 0, nadeAt: this.room.time + rnd(3000, 8000),
      slot: WEAPONS[a.ws.slots[SLOT.PRIMARY].id >= 0 ? a.ws.slots[SLOT.PRIMARY].id : W.PISTOL].slot,
      seed: Math.floor(Math.random() * 1e6),
      retargetAt: 0, lastProgress: this.room.time,
    };
    if (a.ws.slots[SLOT.PRIMARY].id < 0) a.brain.slot = SLOT.SECONDARY;
    return a.brain;
  }

  onHurt(v, attacker) {
    const br = v.brain;
    if (!br) return;
    br.alertUntil = this.room.time + 4000;
    if (!br.target || !br.visible) {
      br.target = attacker;
      br.seenAt = this.room.time;
      br.lsx = attacker.move.x; br.lsy = attacker.move.y; br.lsz = attacker.move.z;
    }
  }

  /** Champ de distance vers un joueur (partagé par tous les ennemis qui le visent). */
  fieldFor(target) {
    const room = this.room, nav = room.nav, time = room.time;
    let rec = this.fields.get(target.id);
    const node = nav.nodeAt(target.move.x, target.move.y, target.move.z);
    if (node < 0) return rec || null;
    if (!rec) {
      rec = { node, t: time, dist: nav.distanceField(node) };
      this.fields.set(target.id, rec);
    } else if (rec.node !== node && time - rec.t > 550 && this.fieldBudget > 0) {
      this.fieldBudget--;
      rec.node = node; rec.t = time;
      nav.distanceField(node, rec.dist);
    }
    return rec;
  }

  beginTick() {
    this.fieldBudget = 1;        // au plus un recalcul de champ par tick
    if (this.fields.size > 0 && this.room.tick % 150 === 0) {
      for (const id of this.fields.keys()) if (!this.room.actors.has(id)) this.fields.delete(id);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Réflexion (≈ 10 fois par seconde) : perception, choix de cible, mode, itinéraire
  // -------------------------------------------------------------------------------------------
  think(a) {
    const room = this.room, nav = room.nav, world = room.world, time = room.time;
    const br = a.brain, p = br.p, m = a.move;
    br.node = nav.nodeAt(m.x, m.y, m.z);

    // --- détection de blocage
    const moved = Math.hypot(m.x - br.lx, m.z - br.lz);
    br.lx = m.x; br.lz = m.z;
    if (br.wantMove && moved < 0.06) br.stuck += 0.1; else br.stuck = Math.max(0, br.stuck - 0.25);
    if (moved > 0.15) br.lastProgress = time;
    if (br.stuck > 0.45 && time >= br.unstickUntil) {
      const ang = Math.random() * Math.PI * 2;
      br.ux = Math.cos(ang); br.uz = Math.sin(ang);
      br.unstickUntil = time + 380;
      br.jumpUntil = time + 120;
      br.path = null; br.repathAt = 0;
    }
    if (br.stuck > 3.5 && br.node >= 0) {
      // dernier recours : recalage sur le graphe de navigation
      m.x = nav.px[br.node]; m.y = nav.py[br.node]; m.z = nav.pz[br.node];
      m.vx = m.vy = m.vz = 0;
      br.stuck = 0;
    }

    // --- perception et choix de cible
    const eyeY = m.y + eyeHeight(m.crouching) * a.scale;
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    let best = null, bestScore = Infinity, bestVis = false;
    const list = room.actorList;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t.alive || t === a || !room.mode.canDamage(a, t)) continue;
      const dx = t.move.x - m.x, dz = t.move.z - m.z, dy = t.move.y - m.y;
      const dist = Math.hypot(dx, dy, dz);
      let vis = false;
      if (dist < p.sight) {
        const inFov = a.isEnemy || dist < 7 || br.alertUntil > time || t === br.target || (dx * fx + dz * fz) > 0.2 * dist;
        if (inFov) {
          vis = !world.segmentBlocked(m.x, eyeY, m.z, t.move.x, t.move.y + chestHeight(t.move.crouching, t.scale), t.move.z)
            || !world.segmentBlocked(m.x, eyeY, m.z, t.move.x, t.move.y + headHeight(t.move.crouching, t.scale), t.move.z);
        }
      }
      let score;
      if (vis) score = dist;
      else if (a.isEnemy) score = dist * 2.2 + 6;                                    // les ennemis coop savent où sont les joueurs
      else if (t === br.target && time - br.seenAt < 4500) score = dist * 2 + 10;    // cible perdue de vue récemment
      else if (time - t.lastShotAt < 700 && dist < 42) score = dist * 2.5 + 16;      // coups de feu entendus
      else continue;
      if (t === br.target) score *= 0.72;
      if (score < bestScore) { bestScore = score; best = t; bestVis = vis; }
    }

    if (best !== br.target) {
      br.target = best;
      br.visible = false;
      br.field = null;
      br.path = null; br.repathAt = 0;
      br.burstLeft = 0;
    }
    const t = br.target;
    if (t) {
      if (bestVis) {
        if (!br.visible) br.acquiredAt = time - (time - br.seenAt < 1500 ? p.react * 500 : 0);
        br.visible = true;
        br.seenAt = time;
        br.lsx = t.move.x; br.lsy = t.move.y; br.lsz = t.move.z;
        br.tvx = t.move.vx; br.tvz = t.move.vz;
      } else {
        br.visible = false;
        if (!a.isEnemy && time - t.lastShotAt < 700) { br.lsx = t.move.x; br.lsy = t.move.y; br.lsz = t.move.z; }
      }
    }

    // --- arme en main (bots) : on bascule sur l'arme de poing puis le couteau quand tout est vide
    if (!a.isEnemy) {
      const pr = a.ws.slots[SLOT.PRIMARY], se = a.ws.slots[SLOT.SECONDARY];
      if (pr.id >= 0 && (pr.ammo > 0 || pr.reserve > 0)) br.slot = SLOT.PRIMARY;
      else if (se.id >= 0 && (se.ammo > 0 || se.reserve > 0)) br.slot = SLOT.SECONDARY;
      else br.slot = SLOT.MELEE;
    }
    const cur = a.ws.slots[a.ws.cur].id;
    const range = p.range || WEAPON_RANGE[cur] || WEAPON_RANGE[W.AR];

    // --- mode de déplacement
    if (t && br.visible) {
      const dist = Math.hypot(t.move.x - m.x, t.move.z - m.z);
      br.mode = dist <= range[1] * 1.3 ? MODE.ENGAGE : MODE.ADVANCE;
      if (dist > range[2]) br.mode = MODE.ADVANCE;
    } else if (t) br.mode = a.isEnemy ? MODE.ADVANCE : MODE.CHASE;
    else br.mode = MODE.ROAM;

    // --- itinéraire
    if (a.isEnemy) {
      br.field = t ? this.fieldFor(t) : null;
    } else if (br.mode === MODE.ROAM) {
      if (!br.path || br.pathI >= br.path.length) this.pickRoamGoal(a);
    } else {
      // vers la cible (visible) ou sa dernière position connue
      const gx = br.visible ? t.move.x : br.lsx, gy = br.visible ? t.move.y : br.lsy, gz = br.visible ? t.move.z : br.lsz;
      if (time >= br.repathAt || !br.path) {
        const goal = nav.nodeAt(gx, gy, gz);
        br.path = nav.findPath(br.node, goal);
        br.pathI = br.path && br.path.length > 1 ? 1 : 0;
        br.repathAt = time + 700 + Math.random() * 500;
      }
      if (br.mode === MODE.CHASE && Math.hypot(gx - m.x, gz - m.z) < 1.5) {
        // arrivé à la dernière position connue : la cible a disparu
        br.target = null; br.path = null;
      }
    }

    // --- erreur de visée (processus bruité à mémoire courte)
    if (t) {
      const dist = Math.hypot(t.move.x - m.x, t.move.z - m.z) || 1;
      const lat = Math.abs(br.tvx * (t.move.z - m.z) - br.tvz * (t.move.x - m.x)) / dist;
      let f = (1 + lat / 6) * (1 + dist / 70);
      if (time - br.acquiredAt < 900) f *= 1.6;
      if (Math.hypot(m.vx, m.vz) > 2.5) f *= 1.25;
      f *= room.mode.aimErrorScale(a);
      br.errYaw = br.errYaw * 0.55 + gauss() * p.aimErr * f * 0.83;
      br.errPitch = br.errPitch * 0.55 + gauss() * p.aimErr * f * 0.5;
      if (Math.random() < 0.15) br.aimHead = Math.random() < (p.head || 0);
    }

    // --- mitraillage latéral
    if (br.mode === MODE.ENGAGE && time >= br.strafeUntil) {
      br.strafeDir = Math.random() < (p.strafe || 0) ? (Math.random() < 0.5 ? -1 : 1) : 0;
      br.strafeUntil = time + rnd(500, 1500);
      br.crouch = !a.isEnemy ? Math.random() < 0.15 : (a.kind === KIND.MARKSMAN ? Math.random() < 0.5 : Math.random() < 0.12);
    }
    if (br.mode !== MODE.ENGAGE) br.crouch = false;
  }

  pickRoamGoal(a) {
    const room = this.room, nav = room.nav, br = a.brain, m = a.move;
    let goal = -1;
    // un bot blessé ou à court de munitions cherche un objet utile
    const pr = a.ws.slots[SLOT.PRIMARY];
    const wantHealth = a.hp < 55, wantAmmo = pr.id >= 0 && pr.reserve < WEAPONS[pr.id].mag;
    if ((wantHealth || wantAmmo) && Math.random() < 0.8) {
      let bd = 70;
      for (const pk of room.pickups) {
        if (!pk.on) continue;
        if (!((wantHealth && pk.type === 'health') || (wantAmmo && pk.type === 'ammo'))) continue;
        const d = Math.hypot(pk.x - m.x, pk.z - m.z);
        if (d < bd) { bd = d; goal = nav.nodeAt(pk.x, pk.y, pk.z); }
      }
    }
    if (goal < 0 && Math.random() < 0.45 && room.hotspots.length) {
      const h = room.hotspots[Math.floor(Math.random() * room.hotspots.length)];
      goal = nav.nodeAt(h.x + rnd(-4, 4), h.y, h.z + rnd(-4, 4));
    }
    if (goal < 0) goal = nav.randomNode();
    br.path = nav.findPath(br.node, goal);
    br.pathI = br.path && br.path.length > 1 ? 1 : 0;
  }

  // -------------------------------------------------------------------------------------------
  // Action (chaque tick) : direction, visée, boutons, puis simulation
  // -------------------------------------------------------------------------------------------
  update(a) {
    const room = this.room, nav = room.nav, time = room.time;
    const br = a.brain, p = br.p, m = a.move;
    if (time >= br.thinkAt) { this.think(a); br.thinkAt = time + 85 + Math.random() * 40; }

    const t = br.target && br.target.alive ? br.target : null;
    if (!t && br.target) { br.target = null; br.visible = false; }
    const cur = a.ws.slots[a.ws.cur].id;
    const def = cur >= 0 ? WEAPONS[cur] : null;
    const range = p.range || WEAPON_RANGE[cur] || WEAPON_RANGE[W.AR];

    // --- direction de déplacement (repère monde)
    let dirX = 0, dirZ = 0, sprint = false;
    let tdx = 0, tdz = 0, tdist = 0;
    if (t) { tdx = t.move.x - m.x; tdz = t.move.z - m.z; tdist = Math.hypot(tdx, tdz) || 1e-3; }

    if (time < br.unstickUntil) {
      dirX = br.ux; dirZ = br.uz;
    } else if (br.mode === MODE.ENGAGE && t) {
      const nx = tdx / tdist, nz = tdz / tdist;
      let fwd = 0;
      if (tdist < range[0]) fwd = -1;
      else if (tdist > range[1] * 1.1) fwd = 0.7;
      let side = br.strafeDir;
      if (p.ads && a.ws.ads > 0.2) { side = 0; fwd = Math.min(fwd, 0); }
      if (side !== 0) {
        // ne pas mitrailler vers le vide ou un mur
        const sx = m.x - nz * side * 1.1, sz = m.z + nx * side * 1.1;
        const n = nav.nodeAt(sx, m.y, sz);
        if (n < 0 || Math.hypot(nav.px[n] - sx, nav.pz[n] - sz) > 0.7 || Math.abs(nav.py[n] - m.y) > 0.6) {
          br.strafeDir = -br.strafeDir; side = 0;
        }
      }
      dirX = nx * fwd - nz * side; dirZ = nz * fwd + nx * side;
    } else if (a.isEnemy) {
      // descente du champ de distance vers le joueur ciblé
      if (br.field && br.node >= 0) {
        const n1 = nav.descend(br.field.dist, br.node);
        if (n1 >= 0) {
          let tgt = n1;
          const n2 = nav.descend(br.field.dist, n1);
          if (n2 >= 0 && nav.lineWalkable(br.node, n2)) tgt = n2;
          dirX = nav.px[tgt] - m.x; dirZ = nav.pz[tgt] - m.z;
          sprint = !!p.sprint && tdist > 9;
        } else if (t && tdist > 1.2) { dirX = tdx; dirZ = tdz; }
      } else if (t) { dirX = tdx; dirZ = tdz; }
      if (br.mode === MODE.ADVANCE && br.visible && p.ads && a.ws.ads > 0.2) { dirX = 0; dirZ = 0; }
    } else if (br.path && br.pathI < br.path.length) {
      let wp = br.path[br.pathI];
      let wx = nav.px[wp], wz = nav.pz[wp];
      if (Math.hypot(wx - m.x, wz - m.z) < 0.45) {
        br.pathI++;
        if (br.pathI < br.path.length) { wp = br.path[br.pathI]; wx = nav.px[wp]; wz = nav.pz[wp]; }
      }
      if (br.pathI < br.path.length) {
        dirX = wx - m.x; dirZ = wz - m.z;
        sprint = !br.visible && (br.mode === MODE.CHASE || Math.random() < 0.7);
      }
    }

    // --- séparation avec les voisins
    if (a.isEnemy || br.mode !== MODE.ENGAGE) {
      const list = room.aiList;
      let px = 0, pz = 0;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === a || !o.alive) continue;
        const ox = m.x - o.move.x, oz = m.z - o.move.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > 1.3 * 1.3 || d2 < 1e-6 || Math.abs(m.y - o.move.y) > 1.5) continue;
        const d = Math.sqrt(d2);
        px += ox / d * (1.3 - d); pz += oz / d * (1.3 - d);
      }
      const dl = Math.hypot(dirX, dirZ);
      if (dl > 1e-4) { dirX = dirX / dl + px * 0.9; dirZ = dirZ / dl + pz * 0.9; }
      else { dirX = px; dirZ = pz; }
    }
    const dl = Math.hypot(dirX, dirZ);
    br.wantMove = dl > 0.05;
    if (br.wantMove) { dirX /= dl; dirZ /= dl; } else { dirX = 0; dirZ = 0; }

    // --- visée
    let wantYaw = a.yaw, wantPitch = 0, aimErr = 9;
    const eyeY = m.y + eyeHeight(m.crouching) * a.scale;
    const aiming = t && (br.visible || time - br.seenAt < 900);
    if (aiming) {
      const ax = br.visible ? t.move.x : br.lsx, az = br.visible ? t.move.z : br.lsz;
      const baseY = br.visible ? t.move.y : br.lsy;
      const ay = baseY + (br.aimHead ? headHeight(t.move.crouching, t.scale) : chestHeight(t.move.crouching, t.scale));
      const dx = ax - m.x, dz = az - m.z, dy = ay - eyeY;
      const h = Math.hypot(dx, dz) || 1e-3;
      const trueYaw = Math.atan2(-dx, -dz), truePitch = Math.atan2(dy, h);
      wantYaw = trueYaw + br.errYaw;
      wantPitch = truePitch + br.errPitch;
      aimErr = Math.hypot(wrapAngle(a.yaw - trueYaw), a.pitch - truePitch);
    } else if (br.wantMove) {
      wantYaw = Math.atan2(-dirX, -dirZ);
    }
    const maxTurn = p.turn / 30;
    a.yaw = wrapAngle(a.yaw + clamp(wrapAngle(wantYaw - a.yaw), -maxTurn, maxTurn));
    a.pitch = clamp(a.pitch + clamp(wantPitch - a.pitch, -maxTurn, maxTurn), -1.4, 1.4);

    // --- entrée de déplacement relative au regard
    const inp = this.inp;
    const sn = Math.sin(a.yaw), cs = Math.cos(a.yaw);
    inp.mf = -sn * dirX - cs * dirZ;
    inp.ms = cs * dirX - sn * dirZ;
    inp.yaw = a.yaw;
    inp.jump = time < br.jumpUntil;
    inp.crouch = br.crouch;

    // --- boutons
    let buttons = br.slot << SLOT_SHIFT;
    let fire = false;
    const ready = aiming && br.visible && time - br.acquiredAt >= p.react * 1000;
    if (def && def.melee) {
      fire = !!t && br.visible && tdist < 2.0;
    } else if (ready && def) {
      const tol = Math.max(3.2 * deg, Math.atan2(0.5, tdist)) + p.aimErr * 1.4;
      if (aimErr < tol && time >= br.pauseUntil && tdist < range[2] * 1.15) fire = true;
    }
    if (p.ads && t && br.visible && tdist > 12) buttons |= BTN.ADS;
    if (p.ads && fire && a.ws.ads < 0.98) fire = false;        // le tireur d'élite épaule avant de tirer
    if (fire && br.burstLeft <= 0) br.burstLeft = rndInt(p.burst[0], p.burst[1]);
    if (!t && def && !def.melee) {
      const s = a.ws.slots[a.ws.cur];
      if (s.ammo < def.mag * 0.5 && s.reserve > 0 && a.ws.reloadT <= 0) buttons |= BTN.RELOAD;
    }
    inp.sprint = sprint && !fire && inp.mf > 0.5 && !(buttons & BTN.ADS);

    // grenades
    if (t && time >= br.nadeAt) {
      if (p.nadeEvery) {
        const seen = br.visible || time - br.seenAt < 3500;
        if (seen && tdist > 7 && tdist < 30) {
          const n = p.volley || 1;
          for (let k = 0; k < n; k++) this.lobGrenade(a, br.lsx + rnd(-1.5, 1.5) * k, br.lsy, br.lsz + rnd(-1.5, 1.5) * k);
          br.nadeAt = time + rnd(p.nadeEvery[0], p.nadeEvery[1]) * 1000;
        } else br.nadeAt = time + 800;
      } else if (p.nade && a.ws.grenades > 0) {
        if (Math.random() < p.nade && tdist > 9 && tdist < 24 && (br.visible || time - br.seenAt < 2500)) {
          this.lobGrenade(a, br.lsx, br.lsy, br.lsz);
          a.ws.grenades--;
        }
        br.nadeAt = time + 1000;
      }
    }

    // --- simulation (deux sous-pas à 60 Hz), en gérant les armes semi-automatiques
    const evs = this.evs;
    for (let s = 0; s < SUBSTEPS; s++) {
      let b = buttons;
      if (fire) {
        if (def && !def.auto) {
          if (!(a.ws.prevButtons & BTN.FIRE) && time >= br.nextTap && a.ws.cooldown <= 0) b |= BTN.FIRE;
        } else b |= BTN.FIRE;
      }
      evs.length = 0;
      room.stepActor(a, b, a.yaw, a.pitch, SIM_DT, br.seed++, evs, inp);
      for (let i = 0; i < evs.length; i++) {
        if (evs[i].type === WEV.FIRE) {
          br.burstLeft--;
          if (def && !def.auto) br.nextTap = time + rnd(140, 330);
          if (br.burstLeft <= 0) br.pauseUntil = time + rnd(p.pause[0], p.pause[1]) * 1000;
        }
      }
      if (!a.alive) return;
    }
  }

  /** Lance une grenade en cloche vers un point (solution balistique à temps de vol choisi). */
  lobGrenade(a, tx, ty, tz) {
    const m = a.move;
    const sy = m.y + eyeHeight(m.crouching) * a.scale - 0.1;
    const dx = tx - m.x, dz = tz - m.z, dy = ty + 0.2 - sy;
    const d = Math.hypot(dx, dz);
    const T = clamp(d / 15, 0.75, 1.9);
    const g = 19;
    spawnGrenade(this.room, a, dx / T, (dy + 0.5 * g * T * T) / T, dz / T);
  }
}

export const AIMODE = MODE;
export { GRENADE };
