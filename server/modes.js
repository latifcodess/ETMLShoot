// Règles des modes de jeu : mêlée générale, match à mort par équipes, survie coopérative par vagues.

import { TEAM } from '../public/shared/constants.js';
import { W, WEAPONS, SLOT, PRIMARIES, giveWeapon, createWeaponState, copyWeaponState, GRENADE } from '../public/shared/weapons.js';
import { KIND, KINDS } from '../public/shared/actors.js';
import { HF } from '../public/shared/protocol.js';
import { MAP_LIST } from '../public/shared/maps/index.js';
import { BOT_PROFILES, ENEMY_PROFILES } from './ai.js';
import { BOT_NAMES } from './names.js';

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

class ModeBase {
  constructor(room) {
    this.room = room;
    this.phase = 'play';
    this.phaseEnd = 0;
    this.dirty = true;
  }
  canDamage(a, v) { return a !== v; }
  damageScale() { return 1; }
  aimErrorScale() { return 1; }
  onJoin() {}
  onLeave() {}
  onReady(a) { if (!a.alive) this.respawn(a); }
  wantSpawn(a) { if (!a.alive && this.room.time >= a.respawnAt) this.respawn(a); }
  update() {}
  state() { return { phase: this.phase }; }
  buy() { return 'Indisponible dans ce mode.'; }

  spawnPoints() { return this.room.map.spawns.ffa; }

  /** Choisit le point d'apparition le plus éloigné des adversaires (avec un peu d'aléa). */
  pickSpawn(a, pts = this.spawnPoints(a)) {
    const room = this.room;
    let best = null, bs = -Infinity;
    for (const p of pts) {
      let minD = 60, occupied = false;
      for (const o of room.actorList) {
        if (!o.alive || o === a) continue;
        const d = Math.hypot(o.move.x - p.x, o.move.z - p.z);
        if (d < 1.4 && Math.abs(o.move.y - p.y) < 2) occupied = true;
        if (this.canDamage(o, a) && d < minD) minD = d;
      }
      if (occupied) continue;
      const score = Math.min(minD, 38) + Math.random() * 9;
      if (score > bs) { bs = score; best = p; }
    }
    return best || pts[Math.floor(Math.random() * pts.length)];
  }

  respawn(a) {
    const pt = this.pickSpawn(a);
    this.loadout(a);
    this.room.spawnActor(a, pt);
  }
  loadout() {}
}

// =============================================================================================
// PvP : mêlée générale et match à mort par équipes
// =============================================================================================

export class ModePvp extends ModeBase {
  constructor(room, teams) {
    super(room);
    this.teams = teams;
    this.teamScore = [0, 0, 0];
    this.scoreLimit = room.cfg.scoreLimit || (teams ? 50 : 25);
    this.timeLimit = (room.cfg.timeLimit || 10) * 60000;
    this.firstBlood = false;
    this.winner = null;
    this.startMatch();
  }

  startMatch() {
    const room = this.room;
    this.phase = 'play';
    this.phaseEnd = room.time + this.timeLimit;
    this.teamScore = [0, 0, 0];
    this.firstBlood = false;
    this.winner = null;
    for (const a of room.actorList) {
      a.kills = a.deaths = a.score = a.assists = a.streak = a.headshots = 0;
      a.dmgDealt = 0;
    }
    this.dirty = true;
  }

  canDamage(a, v) {
    if (a === v) return false;
    return !this.teams || a.team !== v.team;
  }

  spawnPoints(a) {
    const s = this.room.map.spawns;
    if (!this.teams) return s.ffa;
    return a.team === TEAM.ALPHA ? s.alpha : s.bravo;
  }

  teamCount(team) {
    let n = 0;
    for (const a of this.room.actorList) if (!a.isEnemy && a.team === team) n++;
    return n;
  }

  onJoin(a) {
    if (this.teams) a.team = this.teamCount(TEAM.ALPHA) <= this.teamCount(TEAM.BRAVO) ? TEAM.ALPHA : TEAM.BRAVO;
    else a.team = TEAM.NONE;
    this.syncBots();
  }
  onLeave() { this.syncBots(); }

  /** Ajuste le nombre de bots pour atteindre l'effectif voulu. */
  syncBots() {
    const room = this.room;
    let humans = 0;
    const bots = [];
    for (const a of room.actorList) { if (a.isBot) bots.push(a); else if (a.client) humans++; }
    const want = Math.max(0, Math.min(room.cfg.bots, room.cfg.maxPlayers) - humans);
    while (bots.length > want) {
      // on retire d'abord un bot de l'équipe la plus nombreuse
      let idx = bots.length - 1;
      if (this.teams) {
        const big = this.teamCount(TEAM.ALPHA) >= this.teamCount(TEAM.BRAVO) ? TEAM.ALPHA : TEAM.BRAVO;
        const k = bots.findIndex((b) => b.team === big);
        if (k >= 0) idx = k;
      }
      room.removeActor(bots[idx]);
      bots.splice(idx, 1);
    }
    while (bots.length < want) {
      const used = new Set(room.actorList.map((a) => a.name));
      const free = BOT_NAMES.filter((n) => !used.has(n));
      const name = free.length ? free[Math.floor(Math.random() * free.length)] : 'Bot ' + (bots.length + 1);
      const a = room.createActor(KIND.SOLDIER, { name, isBot: true });
      a.team = this.teams ? (this.teamCount(TEAM.ALPHA) <= this.teamCount(TEAM.BRAVO) ? TEAM.ALPHA : TEAM.BRAVO) : TEAM.NONE;
      a.loadout = PRIMARIES[Math.floor(Math.random() * PRIMARIES.length)];
      room.announceActor(a);
      a.respawnAt = room.time + 500 + Math.random() * 1500;
      bots.push(a);
    }
  }

  loadout(a) {
    const ws = createWeaponState();
    if (a.isBot && Math.random() < 0.3) a.loadout = PRIMARIES[Math.floor(Math.random() * PRIMARIES.length)];
    const prim = PRIMARIES.includes(a.loadout) ? a.loadout : W.AR;
    giveWeapon(ws, prim);
    giveWeapon(ws, W.PISTOL);
    giveWeapon(ws, W.KNIFE);
    ws.grenades = 2;
    ws.cur = SLOT.PRIMARY;
    copyWeaponState(a.ws, ws);
    a.maxHp = 100; a.hp = 100; a.armor = 0;
    if (a.isBot) this.room.ai.createBrain(a, BOT_PROFILES[this.room.cfg.difficulty] || BOT_PROFILES[1]);
  }

  onKill(v, attacker, weapon, flags) {
    const room = this.room;
    v.respawnAt = room.time + 3200;
    v.streak = 0;
    if (!attacker || attacker === v) {
      v.kills = Math.max(0, v.kills - 1);
      return;
    }
    attacker.kills++;
    attacker.score += 100 + ((flags & HF.HEAD) ? 25 : 0);
    if (flags & HF.HEAD) attacker.headshots++;
    attacker.streak++;
    attacker.multi = room.time - attacker.lastKillAt < 3500 ? attacker.multi + 1 : 1;
    attacker.lastKillAt = room.time;
    if (this.teams) this.teamScore[attacker.team]++;
    // assistances
    for (const [id, rec] of v.damagers) {
      if (id === attacker.id || rec.dmg < 35 || room.time - rec.t > 8000) continue;
      const h = room.actors.get(id);
      if (h && this.canDamage(h, v)) { h.assists++; h.score += 40; }
    }
    if (!this.firstBlood) { this.firstBlood = true; room.broadcast({ t: 'ann', k: 'first', id: attacker.id }); }
    if (attacker.multi >= 2) room.sendTo(attacker, { t: 'ann', k: 'multi', n: attacker.multi });
    if (attacker.streak === 3 || attacker.streak === 5 || attacker.streak === 7 || attacker.streak >= 10 && attacker.streak % 5 === 0) {
      room.broadcast({ t: 'ann', k: 'streak', id: attacker.id, n: attacker.streak });
    }
    room.scoresDirty = true;
    // condition de victoire
    if (this.phase === 'play') {
      if (this.teams ? this.teamScore[attacker.team] >= this.scoreLimit : attacker.kills >= this.scoreLimit) this.endMatch();
    }
  }

  endMatch() {
    const room = this.room;
    this.phase = 'end';
    this.phaseEnd = room.time + 13000;
    if (this.teams) {
      const [, a, b] = this.teamScore;
      this.winner = a === b ? { team: 0 } : { team: a > b ? TEAM.ALPHA : TEAM.BRAVO };
    } else {
      let best = null;
      for (const a of room.actorList) if (!best || a.kills > best.kills || (a.kills === best.kills && a.deaths < best.deaths)) best = a;
      this.winner = best ? { id: best.id, name: best.name } : null;
    }
    this.dirty = true;
    room.scoresDirty = true;
  }

  update() {
    const room = this.room;
    if (this.phase === 'play') {
      if (room.time >= this.phaseEnd) this.endMatch();
      for (const a of room.actorList) {
        if (a.alive || a.isEnemy) continue;
        // réapparition automatique : immédiate pour les bots, après un délai de grâce pour les humains
        if (a.isBot ? room.time >= a.respawnAt : (a.ready && room.time >= a.respawnAt + 6000)) this.respawn(a);
      }
    } else if (room.time >= this.phaseEnd) {
      // nouvelle manche (rotation de carte si demandée)
      if (room.cfg.rotate) {
        const i = MAP_LIST.findIndex((m) => m.id === room.cfg.map);
        room.changeMap(MAP_LIST[(i + 1) % MAP_LIST.length].id);
      } else {
        for (const a of room.actorList) { if (a.alive) room.despawnActor(a); a.respawnAt = room.time + (a.isBot ? Math.random() * 1500 : 0); }
        room.resetWorldObjects();
        this.startMatch();
        for (const a of room.actorList) if (!a.isBot && a.ready) this.respawn(a);
      }
    }
  }

  state() {
    return {
      phase: this.phase, end: this.phaseEnd, limit: this.scoreLimit, teams: this.teams ? 1 : 0,
      ts: [this.teamScore[1], this.teamScore[2]], win: this.winner,
    };
  }
}

// =============================================================================================
// Survie coopérative
// =============================================================================================

export const SHOP = {
  smg: { name: 'PM-5 Frelon', price: 700, weapon: W.SMG },
  shotgun: { name: 'M-12 Brèche', price: 900, weapon: W.SHOTGUN },
  ar: { name: 'FA-7 Mistral', price: 1300, weapon: W.AR },
  sniper: { name: 'FR-90 Faucon', price: 1700, weapon: W.SNIPER },
  lmg: { name: 'ML-249 Ouragan', price: 2600, weapon: W.LMG },
  rpg: { name: 'LR-7 Titan', price: 3200, weapon: W.RPG },
  ammo: { name: 'Munitions (toutes armes)', price: 300 },
  armor: { name: 'Gilet pare-balles', price: 500 },
  grenades: { name: 'Grenades ×2', price: 250 },
  medkit: { name: 'Trousse de soins', price: 300 },
};

export class ModeCoop extends ModeBase {
  constructor(room) {
    super(room);
    this.phase = 'wait';
    this.wave = 0;
    this.queue = [];
    this.nextSpawnAt = 0;
    this.enemiesAlive = 0;
    this.total = 0;
    this.best = 0;
  }

  canDamage(a, v) { return a !== v && a.isEnemy !== v.isEnemy; }
  damageScale(a) { return a.isEnemy ? Math.min(2.4, 1 + (this.wave - 1) * 0.04) : 1; }
  aimErrorScale(a) { return a.isEnemy ? Math.max(0.6, 1.15 - this.wave * 0.03) : 1; }
  spawnPoints() { return this.room.map.spawns.coop; }

  humans() { return this.room.actorList.filter((a) => a.client); }

  onJoin(a) {
    a.team = TEAM.ALPHA;
    a.money = 500;
    a.inv = null;
  }
  onLeave() {
    if (!this.humans().length) this.resetRun();
  }
  onReady(a) {
    if (this.phase === 'wait') { this.phase = 'inter'; this.phaseEnd = this.room.time + 10000; this.dirty = true; }
    if (!a.alive && this.phase !== 'over') this.respawn(a);
  }
  wantSpawn() { /* en coop, on revient à la vague suivante */ }

  loadout(a) {
    const ws = createWeaponState();
    if (a.inv) {
      copyWeaponState(ws, a.inv);
      // ravitaillement minimal au retour au combat
      for (const s of ws.slots) {
        if (s.id < 0) continue;
        const d = WEAPONS[s.id];
        s.ammo = d.mag;
        if (s.reserve < d.mag * 2) s.reserve = d.mag * 2;
      }
      ws.cooldown = ws.reloadT = ws.switchT = ws.meleeT = ws.nadeT = ws.heat = ws.ads = 0;
      ws.prevButtons = 0;
      if (ws.grenades < 1) ws.grenades = 1;
    } else {
      giveWeapon(ws, W.PISTOL);
      giveWeapon(ws, W.KNIFE);
      ws.grenades = 1;
      ws.cur = SLOT.SECONDARY;
    }
    ws.slots[SLOT.SECONDARY].reserve = 9999;      // arme de poing : réserve illimitée
    copyWeaponState(a.ws, ws);
    a.maxHp = 100; a.hp = 100;
    if (!a.inv) a.armor = 0;
  }

  resetRun() {
    const room = this.room;
    for (const a of room.actorList.slice()) if (a.isEnemy) room.removeActor(a);
    room.projectiles.length = 0;
    room.resetWorldObjects();
    this.best = Math.max(this.best, this.wave);
    this.wave = 0; this.queue = []; this.enemiesAlive = 0; this.total = 0;
    this.phase = 'wait';
    for (const a of room.actorList) {
      a.money = 500; a.inv = null; a.kills = a.deaths = a.score = a.assists = a.headshots = 0; a.dmgDealt = 0;
      if (a.alive) room.despawnActor(a);
    }
    const ready = this.humans().filter((a) => a.ready);
    if (ready.length) {
      this.phase = 'inter';
      this.phaseEnd = room.time + 10000;
      for (const a of ready) this.respawn(a);
    }
    this.dirty = true;
    room.scoresDirty = true;
  }

  composeWave(n, players) {
    const list = [];
    const scale = 0.55 + 0.45 * players;
    let budget = Math.round((7 + n * 2.6) * scale);
    if (n % 5 === 0) {
      list.push(KIND.JUGGERNAUT);
      if (players >= 4 && n >= 10) list.push(KIND.JUGGERNAUT);
      budget = Math.round(budget * 0.6);
    }
    const pool = [[KIND.GRUNT, 1, 10]];
    if (n >= 2) pool.push([KIND.RUSHER, 1, 6]);
    if (n >= 3) pool.push([KIND.MARKSMAN, 2, 2 + Math.min(3, n / 4)]);
    if (n >= 4) pool.push([KIND.GRENADIER, 3, 2 + Math.min(3, n / 5)]);
    if (n >= 6) pool.push([KIND.HEAVY, 4, 1.5 + Math.min(4, n / 4)]);
    const rest = [];
    while (budget > 0) {
      const ok = pool.filter((p) => p[1] <= budget);
      let tot = 0;
      for (const p of ok) tot += p[2];
      let r = Math.random() * tot, pick = ok[0];
      for (const p of ok) { r -= p[2]; if (r <= 0) { pick = p; break; } }
      rest.push(pick[0]);
      budget -= pick[1];
    }
    return list.concat(shuffle(rest));
  }

  startWave() {
    const room = this.room;
    this.wave++;
    const players = Math.max(1, this.humans().length);
    this.queue = this.composeWave(this.wave, players);
    this.total = this.queue.length;
    this.maxAlive = Math.min(34, 6 + players * 4 + this.wave);
    this.phase = 'wave';
    this.nextSpawnAt = room.time + 1500;
    this.waveStart = room.time;
    this.dirty = true;
    room.broadcast({ t: 'ann', k: 'wave', n: this.wave, boss: this.wave % 5 === 0 ? 1 : 0, total: this.total });
  }

  spawnEnemy(kind) {
    const room = this.room;
    const players = this.humans().filter((a) => a.alive);
    // point d'apparition : hors de vue des joueurs et pas trop près
    const pts = room.map.spawns.enemy;
    let best = null, bs = -Infinity;
    for (const p of pts) {
      let minD = 999, seen = false, occupied = false;
      for (const pl of players) {
        const d = Math.hypot(pl.move.x - p.x, pl.move.z - p.z);
        if (d < minD) minD = d;
        if (d < 70 && !room.world.segmentBlocked(p.x, p.y + 1.5, p.z, pl.move.x, pl.move.y + 1.5, pl.move.z)) seen = true;
      }
      for (const o of room.actorList) if (o.alive && Math.hypot(o.move.x - p.x, o.move.z - p.z) < 1.2) occupied = true;
      if (occupied) continue;
      let score = Math.random() * 14 - Math.abs(minD - 34) * 0.25;
      if (seen) score -= 12;
      if (minD < 14) score -= 40;
      if (score > bs) { bs = score; best = p; }
    }
    if (!best) return false;
    const def = KINDS[kind];
    const a = room.createActor(kind, { name: def.name, isEnemy: true });
    a.team = TEAM.HOSTILE;
    const ws = createWeaponState();
    giveWeapon(ws, def.weapon);
    const slot = WEAPONS[def.weapon].slot;
    ws.slots[slot].reserve = 60000;
    ws.cur = slot;
    copyWeaponState(a.ws, ws);
    const pc = Math.max(1, this.humans().length);
    a.maxHp = Math.round(def.hp * (1 + (this.wave - 1) * 0.05) * (def.boss ? 0.55 + 0.45 * pc : 1));
    a.hp = a.maxHp;
    a.armor = def.armor;
    room.announceActor(a);
    room.ai.createBrain(a, ENEMY_PROFILES[kind]);
    room.spawnActor(a, { x: best.x, y: best.y, z: best.z, yaw: Math.random() * 6.28 });
    a.protectedUntil = 0;
    this.enemiesAlive++;
    return true;
  }

  onKill(v, attacker) {
    const room = this.room;
    if (v.isEnemy) {
      this.enemiesAlive = Math.max(0, this.enemiesAlive - 1);
      const def = v.def;
      if (attacker && !attacker.isEnemy) {
        attacker.kills++;
        attacker.money += def.bounty;
        attacker.score += def.bounty;
        attacker.streak++;
      }
      for (const [id, rec] of v.damagers) {
        const h = room.actors.get(id);
        if (!h || h === attacker || h.isEnemy || rec.dmg < 25) continue;
        const share = Math.round(def.bounty * 0.4);
        h.money += share; h.score += share; h.assists++;
      }
      // butin
      const r = Math.random();
      const m = v.move;
      if (def.boss) {
        room.addPickup('armor', m.x + 0.7, m.y, m.z, 40000);
        room.addPickup('health', m.x - 0.7, m.y, m.z, 40000);
        room.addPickup('ammo', m.x, m.y, m.z + 0.7, 40000);
        room.broadcast({ t: 'ann', k: 'bossdown', id: attacker ? attacker.id : 0 });
      } else if (v.kind === KIND.HEAVY || r < 0.13) room.addPickup('ammo', m.x, m.y, m.z, 26000);
      else if (r < 0.2) room.addPickup('health', m.x, m.y, m.z, 26000);
      else if (r < 0.235) room.addPickup('grenade', m.x, m.y, m.z, 26000);
      room.scoresDirty = true;
      this.dirty = true;
      return;
    }
    // un joueur tombe : on mémorise son équipement pour son retour
    v.inv = copyWeaponState(createWeaponState(), v.ws);
    v.streak = 0;
    v.respawnAt = Infinity;
    room.scoresDirty = true;
  }

  update() {
    const room = this.room, time = room.time;
    const humans = this.humans();
    if (!humans.length) return;
    if (this.phase === 'inter') {
      if (time >= this.phaseEnd) this.startWave();
    } else if (this.phase === 'wave') {
      const ready = humans.filter((a) => a.ready);
      if (ready.length && !ready.some((a) => a.alive)) {
        this.phase = 'over';
        this.phaseEnd = time + 13000;
        this.dirty = true;
        room.broadcast({ t: 'ann', k: 'over', n: this.wave });
        return;
      }
      if (this.queue.length && this.enemiesAlive < this.maxAlive && time >= this.nextSpawnAt) {
        if (this.spawnEnemy(this.queue[0])) this.queue.shift();
        this.nextSpawnAt = time + 350 + Math.random() * 650;
        this.dirty = true;
      }
      // filet de sécurité : un ennemi isolé qui ne progresse plus est ramené près des joueurs
      if (!this.queue.length && this.enemiesAlive > 0 && this.enemiesAlive <= 3 && room.tick % 90 === 0) {
        for (const e of room.actorList) {
          if (!e.isEnemy || !e.alive || !e.brain) continue;
          if (time - e.brain.lastProgress > 20000 || time - Math.max(e.brain.seenAt, e.spawnedAt) > 45000) {
            const p = this.pickSpawn(e, room.map.spawns.enemy);
            e.move.x = p.x; e.move.y = p.y; e.move.z = p.z; e.move.vx = e.move.vy = e.move.vz = 0;
            e.brain.lastProgress = time; e.brain.seenAt = time; e.brain.path = null;
            e.spawnCount = (e.spawnCount + 1) & 255;
          }
        }
      }
      if (!this.queue.length && this.enemiesAlive === 0) {
        // vague nettoyée
        const bonus = 200 + 40 * this.wave;
        for (const a of humans) { a.money += bonus; a.score += bonus; }
        this.phase = 'inter';
        this.phaseEnd = time + 18000;
        this.dirty = true;
        room.broadcast({ t: 'ann', k: 'clear', n: this.wave, bonus });
        for (const a of humans) if (!a.alive && a.ready) this.respawn(a);
        room.scoresDirty = true;
      }
    } else if (this.phase === 'over') {
      if (time >= this.phaseEnd) this.resetRun();
    }
  }

  /** Achat à la boutique. Renvoie un message d'erreur ou null. */
  buy(a, key) {
    const item = Object.prototype.hasOwnProperty.call(SHOP, key) ? SHOP[key] : null;
    if (!item) return 'Article inconnu.';
    if (!a.alive) return 'Vous êtes hors de combat.';
    if (a.money < item.price) return 'Fonds insuffisants.';
    const ws = a.ws;
    if (item.weapon !== undefined) {
      const def = WEAPONS[item.weapon];
      const s = ws.slots[def.slot];
      if (s.id === item.weapon) {
        if (s.reserve >= def.reserve) return 'Vous possédez déjà cette arme, munitions pleines.';
        s.reserve = def.reserve;       // racheter l'arme possédée = refaire le plein
      } else {
        giveWeapon(ws, item.weapon);
        ws.reloadT = 0;
      }
    } else if (key === 'ammo') {
      let any = false;
      for (const s of ws.slots) {
        if (s.id < 0 || s.id === W.KNIFE || s.id === W.PISTOL) continue;
        const d = WEAPONS[s.id];
        if (s.reserve < d.reserve) { s.reserve = d.reserve; any = true; }
      }
      if (!any) return 'Munitions déjà pleines.';
    } else if (key === 'armor') {
      if (a.armor >= 100) return 'Gilet déjà intact.';
      a.armor = 100;
    } else if (key === 'grenades') {
      if (ws.grenades >= GRENADE.max) return 'Vous ne pouvez pas porter plus de grenades.';
      ws.grenades = Math.min(GRENADE.max, ws.grenades + 2);
    } else if (key === 'medkit') {
      if (a.hp >= a.maxHp) return 'Vous êtes déjà en pleine forme.';
      a.hp = a.maxHp;
    }
    a.money -= item.price;
    this.room.scoresDirty = true;
    return null;
  }

  state() {
    return {
      phase: this.phase, end: this.phaseEnd, wave: this.wave, left: this.enemiesAlive + this.queue.length,
      total: this.total, best: this.best,
    };
  }
}

export function createMode(room) {
  if (room.cfg.mode === 'coop') return new ModeCoop(room);
  return new ModePvp(room, room.cfg.mode === 'tdm');
}
