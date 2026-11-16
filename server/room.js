// Salle de jeu : une partie autoritaire (monde, acteurs, boucle de simulation, snapshots).

import { TICK_MS, SIM_DT, HULL, MOVE, AF, MODES } from '../public/shared/constants.js';
import { createMoveState } from '../public/shared/physics.js';
import { createWeaponState, WEAPONS, W, WEV, NUM_SLOTS, SLOT, GRENADE, PRIMARIES } from '../public/shared/weapons.js';
import { KINDS } from '../public/shared/actors.js';
import { MSG, HF, OF, ByteWriter, ByteReader, quantYaw, dequantYaw, dequantPitch } from '../public/shared/protocol.js';
import { getMap, createWorld, isValidMap, BARREL } from '../public/shared/maps/index.js';
import { simulate } from '../public/shared/sim.js';
import { clamp } from '../public/shared/mathx.js';
import { Nav } from './nav.js';
import { AI } from './ai.js';
import { createMode, SHOP } from './modes.js';
import {
  histInit, histClear, histPush, applyDamage, fireWeapon, meleeAttack, spawnGrenade,
  updateProjectiles, explodeBarrel,
} from './combat.js';

const TICK_DT = TICK_MS / 1000;
const navCache = new Map();
const PICKUP_RESPAWN = { health: 20000, armor: 30000, ammo: 18000, grenade: 25000, rpg: 50000 };

function sanitizeText(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

export class Room {
  constructor(id, cfg) {
    this.id = id;
    this.cfg = cfg;                 // {name, mode, map, bots, difficulty, maxPlayers, private, rotate, permanent}
    this.clients = new Set();
    this.actors = new Map();
    this.actorList = [];
    this.aiList = [];
    this.projectiles = [];
    this.pickups = [];
    this.barrels = [];
    this.hotspots = [];
    this.tick = 0;
    this.time = 0;
    this.nextActorId = 1;
    this.nextProj = 1;
    this.nextPickupId = 1;
    this.ev = new ByteWriter(2048);
    this.evCount = 0;
    this.common = new ByteWriter(8192);
    this.out = new ByteWriter(8192);
    this.scoresDirty = true;
    this.lastScoresAt = 0;
    this.lastStateAt = 0;
    this.emptySince = Date.now();
    this.evs = [];
    this.loadMap(cfg.map);
    this.ai = new AI(this);
    this.mode = createMode(this);
    if (this.mode.syncBots) this.mode.syncBots();
  }

  // -------------------------------------------------------------------------------------------
  // Carte
  // -------------------------------------------------------------------------------------------
  loadMap(mapId) {
    if (!isValidMap(mapId)) mapId = 'depot';
    this.cfg.map = mapId;
    this.map = getMap(mapId);
    let cached = navCache.get(mapId);
    if (!cached) {
      const world = createWorld(this.map);
      cached = { world, nav: new Nav(world, this.map) };
      navCache.set(mapId, cached);
    }
    // Le monde et le graphe sont en lecture seule : partagés entre les salles d'une même carte.
    this.world = cached.world;
    this.nav = cached.nav;
    this.resetWorldObjects();
    this.hotspots = this.map.pickups.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  }

  resetWorldObjects() {
    this.projectiles.length = 0;
    this.pickups = this.map.pickups.map((p) => ({
      id: this.nextPickupId++, type: p.type, x: p.x, y: p.y, z: p.z, on: true, respawnAt: 0, expireAt: 0, dynamic: false,
    }));
    // En coop les objets fixes de la carte ne sont pas disponibles (on achète, on ramasse le butin).
    if (this.cfg.mode === 'coop') this.pickups = [];
    this.barrels = this.map.barrels.map((b, i) => ({ id: i, x: b.x, y: b.y, z: b.z, hp: BARREL.hp, alive: true, fuseAt: 0, respawnAt: 0, by: null }));
    if (this.clients.size) {
      this.broadcast({ t: 'pks', l: this.pickupList() });
      this.broadcast({ t: 'brls', l: this.barrels.map((b) => (b.alive ? 1 : 0)) });
    }
  }

  changeMap(mapId) {
    for (const a of this.actorList.slice()) if (a.isEnemy || a.isBot) this.removeActor(a);
    for (const a of this.actorList) { a.alive = false; a.ready = false; }
    this.loadMap(mapId);
    this.ai = new AI(this);
    this.mode = createMode(this);
    for (const a of this.actorList) this.mode.onJoin(a);
    for (const c of this.clients) this.sendInit(c);
  }

  // -------------------------------------------------------------------------------------------
  // Acteurs
  // -------------------------------------------------------------------------------------------
  createActor(kind, opts = {}) {
    let id = this.nextActorId;
    while (this.actors.has(id) || id === 0xffff || id === 0) id = (id % 0xfffe) + 1;
    this.nextActorId = (id % 0xfffe) + 1;
    const def = KINDS[kind];
    const a = {
      id, kind, def, name: opts.name || def.name, team: 0,
      isBot: !!opts.isBot, isEnemy: !!opts.isEnemy, client: opts.client || null,
      alive: false, ready: !!opts.isBot || !!opts.isEnemy, remove: false,
      hp: def.hp, maxHp: def.hp, armor: 0, scale: def.scale, speed: def.speed,
      move: createMoveState(), yaw: 0, pitch: 0,
      ws: createWeaponState(), loadout: W.AR, inv: null,
      cmds: [], lastSeq: 0, lastQueued: 0, timeBank: 0, renderTime: 0, spawnCount: 0,
      kills: 0, deaths: 0, score: 0, assists: 0, headshots: 0, money: 0, streak: 0, multi: 0, lastKillAt: -1e9, dmgDealt: 0,
      respawnAt: 0, protectedUntil: 0, lastHurtAt: -1e9, lastShotAt: -1e9, spawnedAt: 0, diedAt: 0,
      damagers: new Map(), brain: null,
    };
    histInit(a);
    this.actors.set(id, a);
    this.actorList.push(a);
    if (a.isBot || a.isEnemy) this.aiList.push(a);
    return a;
  }

  actorMeta(a) { return { id: a.id, n: a.name, k: a.kind, tm: a.team, b: a.isBot ? 1 : 0, e: a.isEnemy ? 1 : 0 }; }
  announceActor(a) { this.broadcast({ t: 'a+', a: this.actorMeta(a) }); }

  removeActor(a) {
    if (!this.actors.has(a.id)) return;
    this.actors.delete(a.id);
    let i = this.actorList.indexOf(a);
    if (i >= 0) this.actorList.splice(i, 1);
    i = this.aiList.indexOf(a);
    if (i >= 0) this.aiList.splice(i, 1);
    a.alive = false;
    this.broadcast({ t: 'a-', id: a.id });
    this.scoresDirty = true;
  }

  spawnActor(a, pt) {
    const m = a.move;
    m.x = pt.x; m.y = pt.y + 0.01; m.z = pt.z;
    // sécurité : si le point est encombré, on se rabat sur le nœud de navigation le plus proche
    if (!this.world.hullFree(m.x, m.y, m.z, HULL.halfW, HULL.height)) {
      const n = this.nav.nodeAt(pt.x, pt.y, pt.z);
      if (n >= 0) { m.x = this.nav.px[n]; m.y = this.nav.py[n] + 0.01; m.z = this.nav.pz[n]; }
    }
    m.vx = m.vy = m.vz = 0; m.onGround = false; m.crouching = false;
    a.yaw = pt.yaw || 0; a.pitch = 0;
    a.alive = true;
    a.spawnCount = (a.spawnCount + 1) & 255;
    a.protectedUntil = this.time + 2200;
    a.lastHurtAt = -1e9;
    a.spawnedAt = this.time;
    a.damagers.clear();
    a.streak = 0;
    histClear(a);
    this.scoresDirty = true;
  }

  despawnActor(a) { a.alive = false; }

  killActor(v, attacker, weapon, flags) {
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.diedAt = this.time;
    this.mode.onKill(v, attacker && this.actors.has(attacker.id) ? attacker : null, weapon, flags);
    if (v.isEnemy) v.remove = true;
    this.scoresDirty = true;
  }

  /** Simule une commande pour un acteur (joueur ou IA) et traite les événements d'arme. */
  stepActor(a, buttons, yaw, pitch, dt, seed, evs, aiInput) {
    a.yaw = yaw; a.pitch = pitch;
    const land = simulate(a.move, a.ws, buttons, yaw, dt, this.world, a.speed, evs, aiInput);
    if (land > 15.5 && !a.def.boss) applyDamage(this, a, null, (land - 15.5) * 7, W.FALL, HF.NOSHOT, 0, -1, 0);
    if (a.move.y < -30 && a.alive) { a.protectedUntil = 0; applyDamage(this, a, null, 9999, W.FALL, HF.NOSHOT, 0, -1, 0); }
    for (let i = 0; i < evs.length && a.alive; i++) {
      const e = evs[i];
      if (e.type === WEV.FIRE) fireWeapon(this, a, WEAPONS[e.weapon], seed, e.spread);
      else if (e.type === WEV.MELEE) meleeAttack(this, a);
      else if (e.type === WEV.GRENADE) spawnGrenade(this, a);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Objets
  // -------------------------------------------------------------------------------------------
  nextProjId() { const id = this.nextProj; this.nextProj = (this.nextProj % 0xfffe) + 1; return id; }

  pickupList() { return this.pickups.map((p) => [p.id, p.type, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), p.on ? 1 : 0]); }

  addPickup(type, x, y, z, lifeMs) {
    const g = this.world.groundBelow(x, y + 0.6, z);
    const p = { id: this.nextPickupId++, type, x, y: g > -Infinity ? g : y, z, on: true, respawnAt: 0, expireAt: this.time + lifeMs, dynamic: true };
    this.pickups.push(p);
    this.broadcast({ t: 'pk+', p: [p.id, p.type, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), 1] });
  }

  tryPickup(a, p) {
    const ws = a.ws;
    if (p.type === 'health') {
      if (a.hp >= a.maxHp) return false;
      a.hp = Math.min(a.maxHp, a.hp + 50);
    } else if (p.type === 'armor') {
      if (a.armor >= 100) return false;
      a.armor = Math.min(100, a.armor + 50);
    } else if (p.type === 'ammo') {
      let any = false;
      for (const s of ws.slots) {
        if (s.id < 0 || s.id === W.KNIFE) continue;
        const d = WEAPONS[s.id];
        if (s.reserve < d.reserve) { s.reserve = Math.min(d.reserve, s.reserve + Math.max(d.mag * 2, Math.ceil(d.reserve * 0.5))); any = true; }
      }
      if (!any) return false;
    } else if (p.type === 'grenade') {
      if (ws.grenades >= GRENADE.max) return false;
      ws.grenades = Math.min(GRENADE.max, ws.grenades + 2);
    } else if (p.type === 'rpg') {
      const s = ws.slots[SLOT.SPECIAL];
      const d = WEAPONS[W.RPG];
      if (s.id === W.RPG) {
        if (s.reserve >= d.reserve + 2) return false;
        s.reserve = Math.min(d.reserve + 2, s.reserve + 2);
      } else { s.id = W.RPG; s.ammo = d.mag; s.reserve = d.reserve; }
    } else return false;
    return true;
  }

  updateObjects() {
    const time = this.time;
    // objets à ramasser
    if (this.tick % 2 === 0) {
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const p = this.pickups[i];
        if (!p.on) {
          if (!p.dynamic && time >= p.respawnAt) { p.on = true; this.broadcast({ t: 'pk', id: p.id, on: 1 }); }
          continue;
        }
        if (p.dynamic && time >= p.expireAt) {
          this.pickups.splice(i, 1);
          this.broadcast({ t: 'pk-', id: p.id });
          continue;
        }
        for (const a of this.actorList) {
          if (!a.alive || a.isEnemy) continue;
          const dx = a.move.x - p.x, dz = a.move.z - p.z, dy = a.move.y - p.y;
          if (dx * dx + dz * dz > 1.15 * 1.15 || dy < -1.7 || dy > 1.2) continue;
          if (!this.tryPickup(a, p)) continue;
          if (p.dynamic) { this.pickups.splice(i, 1); this.broadcast({ t: 'pk-', id: p.id, by: a.id }); }
          else { p.on = false; p.respawnAt = time + (PICKUP_RESPAWN[p.type] || 20000); this.broadcast({ t: 'pk', id: p.id, on: 0, by: a.id }); }
          break;
        }
      }
    }
    // barils
    for (const b of this.barrels) {
      if (b.alive) { if (b.fuseAt !== 0 && time >= b.fuseAt) explodeBarrel(this, b); }
      else if (time >= b.respawnAt) {
        // ne réapparaît que si personne n'est dessus
        let free = true;
        for (const a of this.actorList) if (a.alive && Math.hypot(a.move.x - b.x, a.move.z - b.z) < 1.5) free = false;
        if (free) { b.alive = true; b.hp = BARREL.hp; b.fuseAt = 0; b.by = null; this.broadcast({ t: 'brl', i: b.id, on: 1 }); }
      }
    }
    // régénération (joueurs et bots) après quelques secondes sans dégâts
    for (const a of this.actorList) {
      if (!a.alive || a.isEnemy || a.hp >= a.maxHp) continue;
      if (time - a.lastHurtAt > 5500) a.hp = Math.min(a.maxHp, a.hp + 14 * TICK_DT);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------------------------
  get humanCount() { return this.clients.size; }

  info() {
    return {
      id: this.id, name: this.cfg.name, mode: this.cfg.mode, map: this.cfg.map, mapName: this.map.name,
      players: this.clients.size, max: this.cfg.maxPlayers, bots: this.actorList.filter((a) => a.isBot).length,
      priv: this.cfg.private ? 1 : 0, wave: this.mode.wave || 0, diff: this.cfg.difficulty,
    };
  }

  addClient(c) {
    const a = this.createActor(0, { name: c.name, client: c });
    c.room = this; c.actor = a;
    this.clients.add(c);
    this.emptySince = 0;
    this.mode.onJoin(a);
    this.announceActor(a);
    this.sendInit(c);
    this.broadcast({ t: 'sys', m: `${a.name} a rejoint la partie.` });
    this.scoresDirty = true;
  }

  sendInit(c) {
    const a = c.actor;
    a.ready = false;
    a.cmds.length = 0;
    c.send({
      t: 'init', you: a.id, time: this.time,
      room: { id: this.id, name: this.cfg.name, mode: this.cfg.mode, modeName: MODES[this.cfg.mode].name, map: this.cfg.map, mapName: this.map.name, diff: this.cfg.difficulty, max: this.cfg.maxPlayers },
      actors: this.actorList.map((x) => this.actorMeta(x)),
      pickups: this.pickupList(),
      barrels: this.barrels.map((b) => (b.alive ? 1 : 0)),
      state: this.mode.state(),
      scores: this.scoreList(),
      shop: this.cfg.mode === 'coop' ? Object.entries(SHOP).map(([k, v]) => [k, v.name, v.price, v.weapon === undefined ? -1 : v.weapon]) : null,
    });
  }

  removeClient(c) {
    if (!this.clients.has(c)) return;
    this.clients.delete(c);
    const a = c.actor;
    c.room = null; c.actor = null;
    if (a) {
      this.removeActor(a);
      this.broadcast({ t: 'sys', m: `${a.name} a quitté la partie.` });
      this.mode.onLeave(a);
    }
    if (!this.clients.size) this.emptySince = Date.now();
  }

  broadcast(obj) {
    if (!this.clients.size) return;
    const s = JSON.stringify(obj);
    for (const c of this.clients) c.sendRaw(s);
  }
  sendTo(actor, obj) { if (actor && actor.client) actor.client.send(obj); }

  scoreList() {
    return this.actorList.filter((a) => !a.isEnemy).map((a) => [
      a.id, a.kills, a.deaths, Math.round(a.score), a.client ? Math.round(a.client.rtt) : 0, Math.round(a.money), a.alive ? 1 : 0, a.assists,
    ]);
  }

  onJson(c, msg) {
    const a = c.actor;
    if (!a) return;
    switch (msg.t) {
      case 'ready':
        if (PRIMARIES.includes(msg.w)) a.loadout = msg.w;
        a.ready = true;
        this.mode.onReady(a);
        break;
      case 'loadout':
        if (PRIMARIES.includes(msg.w)) a.loadout = msg.w;
        break;
      case 'spawn':
        if (a.ready) this.mode.wantSpawn(a);
        break;
      case 'buy': {
        const err = this.mode.buy(a, String(msg.k));
        c.send({ t: 'buy', ok: err ? 0 : 1, m: err || '', k: String(msg.k).slice(0, 16), money: Math.round(a.money) });
        break;
      }
      case 'chat': {
        const now = Date.now();
        if (now - c.lastChat < 600) break;
        c.lastChat = now;
        const text = sanitizeText(msg.m, 140);
        if (text) this.broadcast({ t: 'chat', id: a.id, n: a.name, tm: a.team, m: text });
        break;
      }
      default:
    }
  }

  onBinary(c, data) {
    const a = c.actor;
    if (!a || data.byteLength < 10) return;
    const r = new ByteReader(data);
    if (r.u8() !== MSG.INPUT) return;
    const first = r.u32();
    const renderTime = r.u32();
    const n = r.u8();
    if (r.left < n * 6) return;
    for (let i = 0; i < n; i++) {
      const buttons = r.u16(), yawQ = r.u16(), pitchQ = r.i16();
      const seq = (first + i) >>> 0;
      if (seq <= a.lastQueued && a.lastQueued - seq < 100000) continue;       // doublon ou retardataire
      a.lastQueued = seq;
      if (a.cmds.length >= 45) a.cmds.shift();
      a.cmds.push({ seq, buttons, yaw: dequantYaw(yawQ), pitch: clamp(dequantPitch(pitchQ), -1.55, 1.55), rt: renderTime });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Boucle de simulation
  // -------------------------------------------------------------------------------------------
  tickOnce() {
    this.tick++;
    this.time = Math.round(this.tick * TICK_MS);
    this.ev.reset();
    this.evCount = 0;
    const evs = this.evs;

    // 1. joueurs : on consomme leurs commandes (pas fixe 1/60 s) dans la limite d'un budget de temps
    for (const c of this.clients) {
      const a = c.actor;
      if (!a) continue;
      a.timeBank = Math.min(a.timeBank + TICK_DT * 1.1, 0.45);
      while (a.cmds.length && a.timeBank >= SIM_DT * 0.5) {
        const cmd = a.cmds.shift();
        a.timeBank -= SIM_DT;
        a.lastSeq = cmd.seq;
        a.renderTime = cmd.rt;
        if (a.alive) {
          evs.length = 0;
          this.stepActor(a, cmd.buttons, cmd.yaw, cmd.pitch, SIM_DT, cmd.seq, evs, null);
        } else a.ws.prevButtons = cmd.buttons;
      }
    }

    // 2. IA
    this.ai.beginTick();
    const ais = this.aiList;
    for (let i = 0; i < ais.length; i++) {
      const a = ais[i];
      if (a.alive && a.brain) this.ai.update(a);
    }

    // 3. projectiles, objets, règles
    updateProjectiles(this, TICK_DT);
    this.updateObjects();
    this.mode.update(TICK_DT);

    // 4. purge des ennemis morts
    for (let i = this.actorList.length - 1; i >= 0; i--) if (this.actorList[i].remove) this.removeActor(this.actorList[i]);

    // 5. historique de positions
    for (const a of this.actorList) if (a.alive) histPush(a, this.time);

    // 6. réseau
    this.sendSnapshots();
    if (this.mode.dirty || this.time - this.lastStateAt > 2000) {
      this.mode.dirty = false;
      this.lastStateAt = this.time;
      this.broadcast({ t: 'st', time: this.time, s: this.mode.state() });
    }
    if ((this.scoresDirty && this.time - this.lastScoresAt > 400) || this.time - this.lastScoresAt > 2500) {
      this.scoresDirty = false;
      this.lastScoresAt = this.time;
      this.broadcast({ t: 'sc', p: this.scoreList() });
    }
  }

  writeOwn(w, a) {
    const m = a.move, ws = a.ws;
    let f = 0;
    if (a.alive) f |= OF.ALIVE;
    if (m.onGround) f |= OF.GROUND;
    if (m.crouching) f |= OF.CROUCH;
    if (this.time < a.protectedUntil) f |= OF.PROTECTED;
    w.u8(f).u8(a.spawnCount);
    w.f32(m.x).f32(m.y).f32(m.z).f32(m.vx).f32(m.vy).f32(m.vz);
    w.u8(clamp(Math.ceil(a.hp), 0, 255)).u8(clamp(Math.ceil(a.armor), 0, 255));
    w.u16(ws.prevButtons);
    w.u8(ws.cur).u8(ws.grenades).u8(Math.round(ws.ads * 255));
    w.f32(ws.cooldown).f32(ws.reloadT).f32(ws.switchT).f32(ws.meleeT).f32(ws.nadeT).f32(ws.heat);
    for (let i = 0; i < NUM_SLOTS; i++) {
      const s = ws.slots[i];
      w.i8(s.id).u16(Math.min(65535, s.ammo)).u16(Math.min(65535, s.reserve));
    }
  }

  sendSnapshots() {
    if (!this.clients.size) return;
    const w = this.common.reset();
    const time = this.time;
    // --- acteurs vivants
    let n = 0;
    for (const a of this.actorList) if (a.alive) n++;
    w.u16(n);
    for (const a of this.actorList) {
      if (!a.alive) continue;
      const m = a.move;
      let f = 0;
      if (m.crouching) f |= AF.CROUCH;
      if (m.onGround) f |= AF.GROUND;
      if (m.onGround && Math.hypot(m.vx, m.vz) > MOVE.walk * a.speed * 1.2) f |= AF.SPRINT;
      if (a.ws.reloadT > 0) f |= AF.RELOAD;
      if (a.ws.ads > 0.5) f |= AF.ADS;
      if (time < a.protectedUntil) f |= AF.PROTECTED;
      if (time - a.lastShotAt < 160) f |= AF.FIRING;
      const wid = a.ws.slots[a.ws.cur].id;
      w.u16(a.id).pos3(m.x, m.y, m.z).u16(quantYaw(a.yaw)).i8(Math.round(clamp(a.pitch, -1.57, 1.57) * (127 / 1.5708)));
      w.u8(f).u8(wid < 0 ? 255 : wid).u8(clamp(Math.round(a.hp / a.maxHp * 200), 0, 200));
    }
    // --- projectiles
    w.u8(Math.min(255, this.projectiles.length));
    for (let i = 0; i < this.projectiles.length && i < 255; i++) {
      const p = this.projectiles[i];
      w.u16(p.id).u8(p.type).pos3(p.x, p.y, p.z);
    }
    // --- événements
    w.u16(this.evCount);
    w.bytes(this.ev.u8a, this.ev.pos);

    const common = w.view();
    for (const c of this.clients) {
      const a = c.actor;
      if (!a) continue;
      const o = this.out.reset();
      o.u8(MSG.SNAPSHOT).u32(time).u32(a.lastSeq);
      this.writeOwn(o, a);
      o.bytes(common, common.length);
      c.sendBinary(o.view().slice());   // copie : le tampon est réutilisé pour le client suivant
    }
  }
}

export function sanitizeName(s) {
  const n = sanitizeText(s, 16).replace(/\s+/g, ' ');
  return n.length >= 2 ? n : 'Recrue' + Math.floor(100 + Math.random() * 900);
}
