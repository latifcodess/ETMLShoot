// Partie en cours côté client : prédiction du joueur local, interpolation des autres acteurs,
// traitement des événements du serveur, caméra, effets, sons et ATH.

import * as THREE from 'three';
import { SIM_DT, BTN, SLOT_SHIFT, HULL, AF, MAT_SURF, SURF, HITK, MODES } from '../shared/constants.js';
import { getMap, createWorld } from '../shared/maps/index.js';
import { W, WEAPONS, WEV, SLOT, NUM_SLOTS, currentSpread, DAMAGE_NAMES } from '../shared/weapons.js';
import { KINDS, KIND } from '../shared/actors.js';
import { EV, HF, NO_ACTOR } from '../shared/protocol.js';
import { shotDir, lerpAngle, clamp, aimDir } from '../shared/mathx.js';
import { eyeHeight } from '../shared/physics.js';
import { rayVsActor, chestHeight } from '../shared/anatomy.js';
import { makeHit } from '../shared/world.js';
import { decodeSnapshot, encodeInput, quantYaw, quantPitch, dequantYaw, dequantPitch, Predictor, ServerClock, SnapshotBuffer } from './netcode.js';
import { buildWorldMesh, makeSky, makeLighting, makeBarrel, makePickup } from './gfx/worldmesh.js';
import { Soldier, Ragdoll, SEVER, lookFor, LOOKS } from './gfx/character.js';
import { ViewModel } from './gfx/viewmodel.js';
import { Effects } from './gfx/effects.js';
import { makeGrenadeMesh, makeRocketMesh } from './gfx/weapons3d.js';
import { fmtTime } from './ui/hud.js';
import { keyLabel } from './input.js';

const _hit = makeHit();
const _dir = [0, 0, 0];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _mouse = { x: 0, y: 0 };
const _pair = { a: null, b: null, f: 0 };
const worldCache = new Map();           // idCarte|qualité → groupe de maillages (réutilisé entre parties)
const PICKUP_TEXT = { health: 'Soins +50', armor: 'Gilet +50', ammo: 'Munitions', grenade: 'Grenades +2', rpg: 'Lance-roquettes LR-7' };
const TEAM_CLASS = ['t0', 't1', 't2', 't3'];

/** Construit (ou récupère) le décor d'une carte. */
export async function getWorldMesh(map, world, quality, onProgress) {
  const key = `${map.id}|${quality}`;
  let g = worldCache.get(key);
  if (!g) { g = await buildWorldMesh(map, world, quality, onProgress); worldCache.set(key, g); }
  return g;
}

export class Game {
  /** @param app {renderer, settings, input, net, audio, hud, menus} */
  constructor(app, init) {
    this.app = app;
    this.init = init;
    this.mode = init.room.mode;
    this.myId = init.you;
    this.map = getMap(init.room.map);
    this.world = createWorld(this.map);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(app.settings.get('fov'), app.renderer.aspect, 0.06, 1600);
    this.camera.rotation.order = 'YXZ';
    this.actors = new Map();
    this.scores = new Map();
    this.state = init.state || {};
    this.pickups = new Map();
    this.barrels = [];
    this.projectiles = new Map();
    this.ragdolls = [];
    this.events = [];
    this.buffer = new SnapshotBuffer();
    this.clock = new ServerClock();
    this.pred = new Predictor(this.world);
    this.cmdBatch = [];
    this.acc = 0;
    this.last = 0;
    this.ready = false;
    this.disposed = false;
    // vue
    this.yaw = 0; this.pitch = 0;
    this.kickP = 0; this.kickY = 0; this.offP = 0; this.offY = 0; this.lastShot = -9;
    this.wantSlot = SLOT.PRIMARY; this.lastSlot = SLOT.SECONDARY;
    this.eyeH = HULL.eye; this.smoothY = 0; this.shake = 0; this.stepDist = 0;
    this.shade = 1; this.frame = 0;
    // état du joueur
    this.hp = 100; this.armor = 0; this.alive = false; this.spawnedOnce = false;
    this.diedAt = 0; this.killer = null; this.killWeapon = 0; this.deathRagdoll = null; this.specId = 0;
    this.reloadSnd = 0; this.heartT = 0; this.time = 0;
    this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;
    this.money = 0;
    this.chatWasOpen = false;
    this.endShown = false;
    this.firstSpawnAt = 0; this.fpsWarned = false;
    for (const a of init.actors) this._addActor(a);
    this._onScores(init.scores || []);
  }

  // ===========================================================================================
  // Chargement
  // ===========================================================================================
  async load(onProgress) {
    const { renderer, settings } = this.app;
    const env = this.map.env;
    const quality = this.app.quality;
    renderer.setQuality(quality);
    renderer.setExposure(env.exposure || 1);
    this.scene.fog = new THREE.FogExp2(new THREE.Color().setHex(env.fogColor, THREE.SRGBColorSpace), env.fogDensity);
    this.sky = makeSky(env);
    this.scene.add(this.sky);
    onProgress(0.05, 'Génération des textures…');
    await new Promise((r) => setTimeout(r, 20));
    this.worldMesh = await getWorldMesh(this.map, this.world, quality, (f) => onProgress(0.1 + f * 0.7, 'Calcul de l\'éclairage…'));
    this.scene.add(this.worldMesh);
    this.lighting = makeLighting(this.scene, this.map, quality);
    this.scene.environment = renderer.makeEnvironment(this.sky);
    this.scene.environmentIntensity = 0.45;
    onProgress(0.85, 'Préparation des effets…');
    await new Promise((r) => setTimeout(r, 0));
    this.effects = new Effects(this.scene, this.world, env, quality, settings.get('gore'));
    this.view = new ViewModel(env);
    this.view.scene.environment = this.scene.environment;
    this.view.scene.environmentIntensity = 0.5;
    this.barrels = this.map.barrels.map((b, i) => {
      const m = makeBarrel();
      m.position.set(b.x, b.y, b.z);
      m.userData.setAlive(!this.init.barrels || this.init.barrels[i] !== 0);
      this.scene.add(m);
      return m;
    });
    for (const p of this.init.pickups || []) this._addPickup(p);
    // ombre du joueur local (corps invisible, ombre visible)
    this.selfShadow = new Soldier('alpha', 1, true);
    this.scene.add(this.selfShadow.root);
    this.selfShadow.setVisible(false);
    // lasers des tireurs d'élite
    this.lasers = [];
    const lm = new THREE.LineBasicMaterial({ color: new THREE.Color(6, 0.2, 0.1), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const l = new THREE.Line(g, lm);
      l.frustumCulled = false; l.visible = false;
      this.scene.add(l);
      this.lasers.push(l);
    }
    this.app.hud.setMap(this.map);
    this.app.hud.reset();
    onProgress(1, 'Prêt');
    this.ready = true;
    this.last = performance.now();
    this.app.net.send({ t: 'ready', w: settings.get('loadout') });
  }

  dispose() {
    this.disposed = true;
    if (this.worldMesh) this.scene.remove(this.worldMesh);      // conservé dans le cache
    if (this.effects) this.effects.dispose();
    for (const a of this.actors.values()) if (a.soldier) a.soldier.dispose();
    for (const r of this.ragdolls) if (r.mesh) r.mesh.skeleton.dispose();
    if (this.selfShadow) this.selfShadow.dispose();
    if (this.lasers) for (const l of this.lasers) l.geometry.dispose();
    if (this.scene.environment) this.scene.environment.dispose();
    this.app.audio.stopAmbient();
  }

  // ===========================================================================================
  // Acteurs et messages du serveur
  // ===========================================================================================
  _addActor(m) {
    const def = KINDS[m.k] || KINDS[0];
    this.actors.set(m.id, {
      id: m.id, name: m.n, kind: m.k, team: m.tm, bot: !!m.b, enemy: !!m.e, def,
      soldier: null, shown: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, flags: 0, weapon: 255, hp: 1,
      lastX: 0, lastZ: 0, hasLast: false, firedAt: -9,
    });
  }
  _removeActor(id) {
    const a = this.actors.get(id);
    if (!a) return;
    if (a.soldier) { this.scene.remove(a.soldier.root); a.soldier.dispose(); }
    this.actors.delete(id);
    this.scores.delete(id);
  }
  nameOf(id) { const a = this.actors.get(id); return a ? a.name : '?'; }
  teamClass(id) {
    const a = this.actors.get(id);
    if (!a) return 't0';
    if (a.enemy) return 't3';
    return this.mode === 'ffa' ? (id === this.myId ? 't1' : 't0') : TEAM_CLASS[a.team] || 't0';
  }
  isHostile(a) {
    if (a.id === this.myId) return false;
    if (this.mode === 'ffa') return true;
    const me = this.actors.get(this.myId);
    return !me || a.team !== me.team;
  }

  _onScores(list) {
    for (const r of list) this.scores.set(r[0], { kills: r[1], deaths: r[2], score: r[3], ping: r[4], money: r[5], alive: !!r[6], assists: r[7] || 0 });
    const mine = this.scores.get(this.myId);
    if (mine) this.money = mine.money;
  }

  _addPickup(p) {
    const [id, type, x, y, z, on] = p;
    const mesh = makePickup(type);
    mesh.position.set(x, y, z);
    mesh.visible = !!on;
    this.scene.add(mesh);
    this.pickups.set(id, { id, type, x, y, z, on: !!on, mesh });
  }
  _removePickup(id) {
    const p = this.pickups.get(id);
    if (!p) return;
    this.scene.remove(p.mesh);
    this.pickups.delete(id);
  }

  onJson(msg) {
    const { hud, audio, menus } = this.app;
    switch (msg.t) {
      case 'a+': if (!this.actors.has(msg.a.id)) this._addActor(msg.a); break;
      case 'a-': this._removeActor(msg.id); break;
      case 'sc': this._onScores(msg.p); break;
      case 'st': this.state = msg.s; break;
      case 'pks': for (const id of [...this.pickups.keys()]) this._removePickup(id); for (const p of msg.l) this._addPickup(p); break;
      case 'pk+': this._addPickup(msg.p); break;
      case 'pk-': case 'pk': {
        const p = this.pickups.get(msg.id);
        if (!p) break;
        if (msg.by === this.myId) { hud.pickup(PICKUP_TEXT[p.type] || p.type); audio.play(p.type === 'health' ? 'health' : 'pickup', null, { gain: 0.6 }); }
        else if (msg.by) audio.play('pickup', p, { gain: 0.5 });
        if (msg.t === 'pk-') this._removePickup(msg.id);
        else { p.on = !!msg.on; p.mesh.visible = p.on; }
        break;
      }
      case 'brl': if (this.barrels[msg.i]) this.barrels[msg.i].userData.setAlive(!!msg.on); break;
      case 'brls': msg.l.forEach((on, i) => { if (this.barrels[i]) this.barrels[i].userData.setAlive(!!on); }); break;
      case 'chat': hud.chatLine(msg.n, this.teamClass(msg.id), msg.m, false); audio.play('ui', null, { gain: 0.4 }); break;
      case 'sys': hud.chatLine('', '', msg.m, true); break;
      case 'buy':
        if (typeof msg.money === 'number') this.money = msg.money;
        if (msg.ok) {
          audio.play('buy', null, { gain: 0.6 });
          // la boutique est redessinée une fois l'arsenal mis à jour par le snapshot suivant
          if (menus.screen === 'shop') setTimeout(() => { if (menus.screen === 'shop' && !this.disposed) { this._syncMenuGame(); menus.show('shop'); } }, 220);
        }
        else { audio.play('error', null, { gain: 0.5 }); this.app.toast(msg.m); }
        break;
      case 'ann': this._announce(msg); break;
      default:
    }
  }

  _announce(m) {
    const { hud, audio } = this.app;
    if (m.k === 'wave') {
      hud.announce(`Vague ${m.n}`, m.boss ? 'Juggernaut en approche !' : `${m.total} hostiles`, m.boss ? '#ff4433' : '');
      audio.play('horn', null, { gain: 0.6 });
    } else if (m.k === 'clear') { hud.announce('Vague repoussée', `+${m.bonus} $ — boutique ouverte (${keyLabel('shop')})`, '#49e08a'); audio.play('stinger', null, { gain: 0.5 }); }
    else if (m.k === 'over') { hud.announce('Escouade anéantie', `Vague ${m.n} atteinte`, '#ff4433'); audio.play('defeat', null, { gain: 0.6 }); }
    else if (m.k === 'bossdown') { hud.announce('Juggernaut abattu', this.nameOf(m.id), '#ffb238'); audio.play('stinger', null, { gain: 0.6 }); }
    else if (m.k === 'first') hud.announce('Premier sang', this.nameOf(m.id), '#ff4433');
    else if (m.k === 'multi') { hud.announce(['', '', 'Doublé', 'Triplé', 'Quadruplé'][Math.min(4, m.n)] || 'Carnage', '', '#ffb238'); audio.play('stinger', null, { gain: 0.45, pitch: 1 + m.n * 0.08 }); }
    else if (m.k === 'streak') hud.announce(`Série de ${m.n}`, this.nameOf(m.id), '#ffb238');
  }

  onSnapshot(buf) {
    const snap = decodeSnapshot(buf);
    if (!snap) return;
    const now = performance.now();
    this.clock.onSnapshot(snap.time, now);
    this.buffer.push(snap);
    const wasAlive = this.pred.alive;
    this.pred.reconcile(snap);
    this.hp = snap.own.hp; this.armor = snap.own.armor;
    this.alive = snap.own.alive;
    if (this.pred.respawned) this._onRespawn(snap);
    if (wasAlive && !this.alive) this._onDeath();
    // Un snapshot resté en file d'attente (onglet en arrière-plan, chargement) est périmé :
    // on met à jour l'état, mais on ne rejoue ni ses effets ni ses sons.
    if (this.clock.now(now) - snap.time > 1200) return;
    // retours immédiats (sans attendre le retard d'interpolation) : marqueur de touche, dégâts subis
    for (const e of snap.events) {
      e.time = snap.time;
      if (e.type === EV.HIT) this._hitFeedback(e);
      this.events.push(e);
    }
    if (this.events.length > 1500) this.events.splice(0, this.events.length - 1500);
  }

  _onRespawn(snap) {
    const me = snap.index.get(this.myId);
    if (me) this.yaw = me.yaw;
    this.pitch = 0; this.kickP = this.kickY = this.offP = this.offY = 0;
    this.smoothY = this.pred.move.y;
    this.eyeH = HULL.eye;
    if (!this.spawnedOnce) this.firstSpawnAt = this.time;
    this.spawnedOnce = true;
    this.deathRagdoll = null;
    this.killer = null;
    this.wantSlot = this.pred.ws.cur;
    this.app.hud.deathScreen(false);
    this.app.renderer.fx.damage = 0;
    const a = this.actors.get(this.myId);
    if (a) {
      const look = LOOKS[lookFor('soldier', a.team, a.id, this.mode)];
      this.view.setSleeve(look.uniform);
    }
    this.view.setWeapon(-1);
  }

  _onDeath() {
    this.diedAt = this.time;
    this.app.hud.setScope(false);
    this.app.audio.play('death', null, { gain: 0.5 });
  }

  /** Retour instantané d'un événement HIT qui me concerne. */
  _hitFeedback(e) {
    const { hud, audio, renderer, settings } = this.app;
    if (e.attacker === this.myId && e.victim !== this.myId) {
      const kill = (e.flags & HF.KILL) !== 0;
      hud.hitmarker(kill);
      audio.play('hitmarker', null, { gain: 0.5, pitch: (e.flags & HF.HEAD) ? 1.25 : 1 });
      if (kill) audio.play((e.flags & HF.HEAD) ? 'headshot' : 'kill', null, { gain: 0.5 });
    }
    if (e.victim === this.myId) {
      const att = this.actors.get(e.attacker);
      if (att && att.shown) hud.damageFrom(att.x, att.z, e.dmg);
      else hud.damageFrom(this.pred.move.x - e.dx * 5, this.pred.move.z - e.dz * 5, e.dmg);
      renderer.fx.damage = Math.min(0.85, renderer.fx.damage + 0.14 + e.dmg / 110);
      this.shake = Math.min(1, this.shake + 0.12 + e.dmg / 160);
      audio.play('pain', null, { gain: 0.45 });
      audio.play((e.flags & HF.ARMOR) ? 'hitMetal1' : 'hitFlesh', null, { gain: 0.5 });
      if (settings.get('gore') > 0 && e.dmg > 14) hud.bloodSplat(e.dmg > 45 ? 3 : 1);
      if (e.flags & HF.KILL) { this.killer = e.attacker === NO_ACTOR || e.attacker === this.myId ? null : e.attacker; this.killWeapon = e.weapon; }
    }
    if (e.flags & HF.KILL) {
      const v = this.actors.get(e.victim);
      if (v && (!v.enemy || v.def.boss)) {
        const k = e.attacker === NO_ACTOR || e.attacker === e.victim ? null : this.actors.get(e.attacker);
        hud.killfeed(k ? k.name : '', k ? this.teamClass(k.id) : '', v.name, this.teamClass(v.id), e.weapon, (e.flags & HF.HEAD) !== 0, e.attacker === this.myId || e.victim === this.myId);
      }
    }
  }

  // ===========================================================================================
  // Boucle principale
  // ===========================================================================================
  frameStep(now) {
    if (!this.ready || this.disposed) return;
    const dt = clamp((now - this.last) / 1000, 0.0005, 0.1);
    this.last = now;
    this.time += dt;
    this.frame++;
    const { input, hud, menus, renderer } = this.app;
    const playing = (input.locked || input.virtualOnly) && !menus.visible && !hud.chatOpen && this.state.phase !== 'end';

    this._handleActions(playing);
    this._look(dt, playing);
    this._predict(dt, playing);
    const rt = this.clock.renderTime(now);
    this._interpolate(rt, dt);
    this._processEvents(rt);
    this._updateObjects(dt, rt);
    this._updateCamera(dt);
    this._updateHud(dt, playing);

    // rendu
    this.sky.material.uniforms.uTime.value = this.time;
    this.camera.getWorldDirection(_v);
    this.lighting.update(this.camera.position, _v);
    const fx = renderer.fx;
    fx.damage = Math.max(0, fx.damage - dt * 1.1);
    fx.desat = this.alive ? (this.hp < 30 ? (30 - this.hp) / 30 * 0.65 : 0) : 0.75;
    fx.aberration = Math.min(1.4, this.shake * 1.2 + fx.damage * 0.3);
    fx.flash = Math.max(0, fx.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    renderer.render(this.scene, this.camera, this.alive ? this.view.scene : null, this.view.camera, dt);

    // images par seconde mesurées sur le temps réel (dt, lui, est plafonné)
    this.fpsN++;
    if (now - this.fpsAcc >= 500) { this.fps = Math.round(this.fpsN * 1000 / (now - this.fpsAcc)); this.fpsAcc = now; this.fpsN = 0; }
  }

  _handleActions(playing) {
    const { input, hud, menus, net } = this.app;
    const pressed = input.takePressed();
    const wheel = input.takeWheel();
    if (hud.chatOpen) return;
    for (const act of pressed) {
      if (act === 'chat' && (input.locked || input.virtualOnly) && !menus.visible) { hud.openChat(); input.reset(); return; }
      if (!playing) continue;
      if (act === 'slot1') this._selectSlot(SLOT.PRIMARY);
      else if (act === 'slot2') this._selectSlot(SLOT.SECONDARY);
      else if (act === 'slot3') this._selectSlot(SLOT.MELEE);
      else if (act === 'slot4') this._selectSlot(SLOT.SPECIAL);
      else if (act === 'last') this._selectSlot(this.lastSlot);
      else if (act === 'shop' && this.mode === 'coop') { this._syncMenuGame(); menus.show('shop'); input.unlock(); }
      else if (act === 'loadout' && this.mode !== 'coop') { this._syncMenuGame(); menus.show('loadout'); input.unlock(); }
    }
    if (playing && wheel) {
      // molette : arme suivante / précédente parmi celles possédées
      const ws = this.pred.ws;
      let s = this.wantSlot;
      for (let i = 0; i < NUM_SLOTS; i++) { s = (s + (wheel > 0 ? 1 : NUM_SLOTS - 1)) % NUM_SLOTS; if (ws.slots[s].id >= 0) break; }
      this._selectSlot(s);
    }
    // réapparition / changement de joueur observé
    if (!this.alive && playing && input.mouse[0] && !this._clickHeld) {
      if (this.mode !== 'coop') { if (this.time - this.diedAt > 3.1 || !this.spawnedOnce) net.send({ t: 'spawn' }); }
      else this.specId = 0;      // force le choix du coéquipier suivant
    }
    this._clickHeld = input.mouse[0];
    const showBoard = input.isDown('scores') && this.state.phase !== 'end';
    if (showBoard || this._boardShown) {
      // le tableau n'est reconstruit que deux fois par seconde tant qu'il est affiché
      if (!showBoard || !this._boardShown || this.time - (this._boardAt || 0) > 0.5) {
        this._boardAt = this.time;
        hud.scoreboard(showBoard, this._boardInfo(), this._boardRows());
      }
      this._boardShown = showBoard;
    }
  }

  _selectSlot(s) {
    const ws = this.pred.ws;
    if (s === this.wantSlot || s < 0 || s >= NUM_SLOTS || ws.slots[s].id < 0) return;
    this.lastSlot = this.wantSlot;
    this.wantSlot = s;
  }

  _look(dt, playing) {
    const { input, settings } = this.app;
    input.takeMouse(_mouse);
    const def = this._def();
    const ads = this.pred.ws.ads;
    if (playing && this.alive) {
      const zoom = def ? 1 + (def.adsZoom - 1) * ads : 1;
      const sens = 0.0021 * settings.get('sensitivity') * (1 + (settings.get('adsSensitivity') - 1) * ads) / zoom;
      this.yaw -= _mouse.x * sens;
      this.pitch -= _mouse.y * sens * (settings.get('invertY') ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.5, 1.5);
      this.dyaw = _mouse.x * sens; this.dpitch = _mouse.y * sens;
    } else { this.dyaw = 0; this.dpitch = 0; }
    // recul : la cible retombe lentement pendant le tir, vite ensuite
    const rec = this.time - this.lastShot < 0.16 ? 2.2 : 8;
    this.kickP *= Math.exp(-dt * rec); this.kickY *= Math.exp(-dt * rec);
    const k = Math.min(1, dt * 26);
    this.offP += (this.kickP - this.offP) * k; this.offY += (this.kickY - this.offY) * k;
  }

  get viewYaw() { return this.yaw + this.offY; }
  get viewPitch() { return clamp(this.pitch + this.offP, -1.54, 1.54); }
  _def() { const id = this.pred.ws.slots[this.pred.ws.cur].id; return id >= 0 ? WEAPONS[id] : null; }

  _predict(dt, playing) {
    const { input, net } = this.app;
    this.acc += dt;
    let steps = 0;
    this.cmdBatch.length = 0;
    const first = net.seq + 1;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      if (++steps > 6) { this.acc = 0; break; }      // image très longue : on ne rattrape pas tout
      let buttons = playing && this.alive ? input.buttons() : 0;
      buttons |= this.wantSlot << SLOT_SHIFT;
      const yawQ = quantYaw(this.viewYaw), pitchQ = quantPitch(this.viewPitch);
      const yaw = dequantYaw(yawQ), pitch = dequantPitch(pitchQ);
      const seq = ++net.seq;
      const yBefore = this.pred.move.y, groundBefore = this.pred.move.onGround;
      const land = this.pred.step(seq, buttons, yaw);
      this.cmdBatch.push({ buttons, yawQ, pitchQ });
      if (this.pred.alive) this._afterStep(seq, yaw, pitch, land, yBefore, groundBefore);
    }
    if (this.cmdBatch.length) net.sendBinary(encodeInput(first, this.clock.renderTime(performance.now()), this.cmdBatch));
    this.pred.decayError(dt);
  }

  /** Conséquences locales d'un pas de simulation : sons de pas, événements d'arme prédits. */
  _afterStep(seq, yaw, pitch, land, yBefore, groundBefore) {
    const { audio } = this.app;
    const m = this.pred.move;
    // marches montées ou descendues : la caméra lisse le saut de hauteur
    if (groundBefore && m.onGround && Math.abs(m.y - yBefore) > 0.02) { this.smoothY += yBefore - m.y; this.pred.prev.y = m.y; }
    if (land > 5) { this.view.landed(land); audio.play('land', null, { gain: Math.min(0.9, land / 14), cat: 'step' }); this.shake = Math.min(1, this.shake + Math.max(0, land - 9) * 0.04); }
    if (m.onGround) {
      const sp = Math.hypot(m.vx, m.vz);
      this.stepDist += sp * SIM_DT;
      const stride = sp > 6 ? 2.5 : 2.0;
      if (this.stepDist > stride && sp > 1.5) { this.stepDist = 0; if (!m.crouching) audio.step(this._surfaceAt(m.x, m.y, m.z), null, true, sp > 6); }
    }
    for (const e of this.pred.evs) this._weaponEvent(e, seq, yaw, pitch);
  }

  _surfaceAt(x, y, z) {
    if (this.world.raycast(x, y + 0.3, z, 0, -1, 0, 1, _hit)) return MAT_SURF[this.world.mat[_hit.box]];
    return SURF.CONCRETE;
  }

  _weaponEvent(e, seq, yaw, pitch) {
    const { audio } = this.app;
    const ws = this.pred.ws, m = this.pred.move;
    switch (e.type) {
      case WEV.FIRE: {
        const def = WEAPONS[e.weapon];
        this.view.fire(def);
        audio.shot(def.id, null, true);
        const ads = ws.ads;
        this.kickP += def.recoil[0] * (1 - ads * 0.3) * (m.crouching ? 0.8 : 1);
        this.kickY += def.recoil[1] * (Math.random() * 2 - 1) * (1 - ads * 0.3);
        this.lastShot = this.time;
        this.shake = Math.min(1, this.shake + def.recoil[0] * 1.2);
        if (def.projectile) break;
        const ox = m.x, oy = m.y + eyeHeight(m.crouching), oz = m.z;
        this.camera.updateMatrixWorld();
        this.view.muzzleWorld(this.camera, _v2);
        if (def.scope && ads > 0.9) _v2.set(ox, oy - 0.08, oz);
        for (let i = 0; i < def.pellets; i++) {
          shotDir(yaw, pitch, e.spread, seq, i, _dir);
          let best = def.range, kind = HITK.NONE, face = 0, surf = 0, head = false;
          if (this.world.raycast(ox, oy, oz, _dir[0], _dir[1], _dir[2], best, _hit)) { best = _hit.t; kind = HITK.WORLD; face = _hit.face; surf = MAT_SURF[this.world.mat[_hit.box]]; }
          for (const a of this.actors.values()) {
            if (!a.shown || a.id === this.myId || !this.isHostile(a)) continue;
            const h = rayVsActor(ox, oy, oz, _dir[0], _dir[1], _dir[2], a.x, a.y, a.z, (a.flags & AF.CROUCH) !== 0, a.def.scale, best);
            if (h && h.t < best) { best = h.t; kind = HITK.FLESH; head = h.zone === 3; }
          }
          const ex = ox + _dir[0] * best, ey = oy + _dir[1] * best, ez = oz + _dir[2] * best;
          if (i < 4 || i % 2 === 0) this.effects.tracer(_v2.x, _v2.y, _v2.z, ex, ey, ez, def.id === W.SNIPER || def.id === W.LMG);
          if (kind === HITK.WORLD) {
            this.effects.impact(ex, ey, ez, face, surf);
            if (i < 2) audio.impact(surf, { x: ex, y: ey, z: ez });
          } else if (kind === HITK.FLESH) {
            // sang prédit localement : la confirmation (marqueur de touche) viendra du serveur
            this.effects.bloodHit(ex, ey, ez, _dir[0], _dir[1], _dir[2], head ? 1.6 : 1, head);
            if (i < 2) audio.play(head ? 'hitHead' : 'hitFlesh', { x: ex, y: ey, z: ez }, { cat: 'hit' });
          }
        }
        // douille éjectée à droite de l'arme
        if (def.id !== W.SHOTGUN && def.id !== W.SNIPER) this._ejectShell(def);
        else this.shellAt = this.time + (def.id === W.SHOTGUN ? 0.32 : 0.6);
        if (def.id === W.SHOTGUN) this.pumpAt = this.time + 0.2;
        if (def.id === W.SNIPER) this.pumpAt = this.time + 0.35;
        break;
      }
      case WEV.DRY: audio.play('dry', null, { gain: 0.7 }); break;
      case WEV.RELOAD: {
        const def = WEAPONS[e.weapon];
        audio.play(def.shellReload ? 'shell' : 'magout', null, { gain: 0.7 });
        if (!def.shellReload) this.reloadSnd = this.time + def.reload * 0.62;
        break;
      }
      case WEV.SHELL: audio.play('shell', null, { gain: 0.7 }); break;
      case WEV.RELOADED: {
        const def = WEAPONS[e.weapon];
        audio.play(def.shellReload ? 'pump' : 'bolt', null, { gain: 0.7 });
        this.reloadSnd = 0;
        break;
      }
      case WEV.SWITCH: audio.play('draw', null, { gain: 0.7 }); this.reloadSnd = 0; break;
      case WEV.MELEE: audio.play('swing', null, { gain: 0.7 }); break;
      case WEV.GRENADE: audio.play('pin', null, { gain: 0.6 }); audio.play('throw', null, { gain: 0.6, delay: 0.1 }); this.view.throwGrenade(); break;
      default:
    }
  }

  _ejectShell(def) {
    const sn = Math.sin(this.viewYaw), cs = Math.cos(this.viewYaw);
    const m = this.pred.move;
    const rx = cs, rz = -sn, fx = -sn, fz = -cs;
    const x = this.camera.position.x + rx * 0.16 + fx * 0.32, y = this.camera.position.y - 0.1, z = this.camera.position.z + rz * 0.16 + fz * 0.32;
    this.effects.shell(x, y, z, rx * (1.6 + Math.random()) + m.vx, 1.6 + Math.random() * 1.2, rz * (1.6 + Math.random()) + m.vz, def.id === W.SHOTGUN || def.id === W.SNIPER || def.id === W.LMG);
  }

  // ===========================================================================================
  // Acteurs distants
  // ===========================================================================================
  _interpolate(rt, dt) {
    const pair = this.buffer.sample(rt, _pair);
    for (const a of this.actors.values()) a.present = false;
    if (pair) {
      const { a: A, b: B } = pair;
      const f = Math.min(1.3, pair.f);
      for (const sb of B.actors) {
        const act = this.actors.get(sb.id);
        if (!act) continue;
        const sa = A.index.get(sb.id);
        act.present = true;
        let x = sb.x, y = sb.y, z = sb.z, yaw = sb.yaw, pitch = sb.pitch;
        if (sa && sa !== sb) {
          const jump = Math.hypot(sb.x - sa.x, sb.y - sa.y, sb.z - sa.z);
          if (jump < 6) {
            x = sa.x + (sb.x - sa.x) * f; y = sa.y + (sb.y - sa.y) * f; z = sa.z + (sb.z - sa.z) * f;
            yaw = lerpAngle(sa.yaw, sb.yaw, Math.min(1, f)); pitch = sa.pitch + (sb.pitch - sa.pitch) * Math.min(1, f);
            const span = (B.time - A.time) / 1000;
            if (span > 0) { act.vx = (sb.x - sa.x) / span; act.vz = (sb.z - sa.z) / span; }
          } else { act.vx = 0; act.vz = 0; }
        }
        act.x = x; act.y = y; act.z = z; act.yaw = yaw; act.pitch = pitch;
        act.flags = sb.flags; act.weapon = sb.weapon; act.hp = sb.hp;
      }
    }
    const { audio } = this.app;
    let laser = 0;
    for (const act of this.actors.values()) {
      const mine = act.id === this.myId;
      if (!act.present || mine) {
        if (act.shown) { act.shown = false; if (act.soldier) act.soldier.setVisible(false); }
        continue;
      }
      if (!act.soldier) {
        act.soldier = new Soldier(lookFor(act.def.look, act.team, act.id, this.mode), act.def.scale);
        this.scene.add(act.soldier.root);
      }
      const s = act.soldier;
      if (!act.shown) { act.shown = true; s.setVisible(true); }
      s.setWeapon(act.weapon);
      s.update(dt, {
        x: act.x, y: act.y, z: act.z, yaw: act.yaw, pitch: act.pitch, vx: act.vx, vz: act.vz,
        crouch: (act.flags & AF.CROUCH) !== 0, ground: (act.flags & AF.GROUND) !== 0, sprint: (act.flags & AF.SPRINT) !== 0,
        reload: (act.flags & AF.RELOAD) !== 0, ads: (act.flags & AF.ADS) !== 0,
      });
      s.root.updateMatrixWorld(true);
      if (s.stepFlag) {
        const d2 = (act.x - this.camera.position.x) ** 2 + (act.z - this.camera.position.z) ** 2;
        if (d2 < 30 * 30) audio.step(this._surfaceAt(act.x, act.y, act.z), act, false, (act.flags & AF.SPRINT) !== 0);
      }
      // laser de visée des tireurs d'élite ennemis : l'avertissement avant le tir
      if (act.kind === KIND.MARKSMAN && (act.flags & AF.ADS) && laser < this.lasers.length) {
        const L = this.lasers[laser++];
        s.muzzleWorld(_v);
        aimDir(act.yaw, act.pitch, _dir);
        let t = 140;
        if (this.world.raycast(_v.x, _v.y, _v.z, _dir[0], _dir[1], _dir[2], t, _hit)) t = _hit.t;
        const p = L.geometry.attributes.position;
        p.setXYZ(0, _v.x, _v.y, _v.z);
        p.setXYZ(1, _v.x + _dir[0] * t, _v.y + _dir[1] * t, _v.z + _dir[2] * t);
        p.needsUpdate = true;
        L.visible = true;
      }
    }
    for (let i = laser; i < this.lasers.length; i++) this.lasers[i].visible = false;

    // ombre du joueur local
    if (this.alive && this.pred.alive) {
      const m = this.pred.move;
      this.selfShadow.setVisible(true);
      this.selfShadow.setWeapon(this.pred.ws.slots[this.pred.ws.cur].id);
      this.selfShadow.update(dt, { x: m.x, y: m.y, z: m.z, yaw: this.viewYaw, pitch: this.viewPitch, vx: m.vx, vz: m.vz, crouch: m.crouching, ground: m.onGround, sprint: false, reload: this.pred.ws.reloadT > 0 });
    } else this.selfShadow.setVisible(false);
  }

  // ===========================================================================================
  // Événements du serveur (rejoués à l'instant affiché, pour coller aux positions interpolées)
  // ===========================================================================================
  _processEvents(rt) {
    const ev = this.events;
    let n = 0;
    while (n < ev.length && ev[n].time <= rt) n++;
    if (!n) return;
    const batch = ev.splice(0, n);
    for (const e of batch) {
      if (rt - e.time > 1000) continue;        // trop ancien pour être montré
      if (e.type === EV.SHOT) this._evShot(e);
      else if (e.type === EV.HIT) this._evHit(e);
      else if (e.type === EV.EXPLODE) this._evExplode(e);
      else if (e.type === EV.MELEE) { const a = this.actors.get(e.actor); if (a && a.soldier && a.id !== this.myId) { a.soldier.melee = 1; this.app.audio.play('swing', a, { gain: 0.8 }); } }
      else if (e.type === EV.THROW) { const a = this.actors.get(e.actor); if (a && a.soldier && a.id !== this.myId) { a.soldier.throw = 1; this.app.audio.play('throw', a, { gain: 0.8 }); } }
    }
  }

  _evShot(e) {
    if (e.shooter === this.myId) return;            // déjà joué par la prédiction
    const { audio } = this.app;
    const a = this.actors.get(e.shooter);
    if (!a) return;
    const def = WEAPONS[e.weapon] || WEAPONS[W.AR];
    let mx, my, mz;
    if (a.soldier && a.shown) { a.soldier.kick = 1; a.soldier.muzzleWorld(_v); mx = _v.x; my = _v.y; mz = _v.z; }
    else { mx = a.x; my = a.y + 1.4; mz = a.z; }
    a.firedAt = this.time;
    aimDir(a.yaw, a.pitch, _dir);
    this.effects.muzzle(mx, my, mz, _dir[0], _dir[1], _dir[2], def.id === W.SHOTGUN || def.id === W.SNIPER ? 1.4 : 1);
    audio.shot(def.id, { x: mx, y: my, z: mz }, false);
    const cam = this.camera.position;
    let whizz = false;
    for (let i = 0; i < e.pts.length; i++) {
      const p = e.pts[i];
      if (i < 5) this.effects.tracer(mx, my, mz, p.x, p.y, p.z, def.id === W.SNIPER || def.id === W.LMG || def.id === W.MINIGUN);
      if (p.kind === HITK.WORLD) {
        this.effects.impact(p.x, p.y, p.z, p.face, p.surf);
        if (i < 2) audio.impact(p.surf, p);
      } else if (p.kind === HITK.FLESH || p.kind === HITK.HEAD) {
        const dx = p.x - mx, dy = p.y - my, dz = p.z - mz, l = Math.hypot(dx, dy, dz) || 1;
        this.effects.bloodHit(p.x, p.y, p.z, dx / l, dy / l, dz / l, p.kind === HITK.HEAD ? 1.6 : 1, p.kind === HITK.HEAD);
        if (i < 2) audio.play(p.kind === HITK.HEAD ? 'hitHead' : 'hitFlesh', p, { cat: 'hit' });
      }
      // balle qui passe près de la tête : sifflement
      if (!whizz && this.alive && this.isHostile(a)) {
        const sx = p.x - mx, sy = p.y - my, sz = p.z - mz, sl2 = sx * sx + sy * sy + sz * sz;
        if (sl2 > 4) {
          const t = clamp(((cam.x - mx) * sx + (cam.y - my) * sy + (cam.z - mz) * sz) / sl2, 0, 1);
          const d = Math.hypot(mx + sx * t - cam.x, my + sy * t - cam.y, mz + sz * t - cam.z);
          if (d < 1.4 && t > 0.05 && t < 0.98) { whizz = true; audio.play('whizz', null, { gain: 0.55 }); }
        }
      }
    }
  }

  _evHit(e) {
    const { audio, settings } = this.app;
    const v = this.actors.get(e.victim);
    if (!v) return;
    const mine = e.victim === this.myId;
    const scale = v.def.scale;
    let px = v.x, py = v.y, pz = v.z;
    if (mine) { px = this.pred.move.x; py = this.pred.move.y; pz = this.pred.move.z; }
    const cy = py + chestHeight(false, scale);
    if (v.soldier && !mine) v.soldier.flinch = 1;
    if ((e.flags & HF.NOSHOT) && !mine) {
      this.effects.bloodHit(px, cy, pz, e.dx, e.dy, e.dz, Math.min(2.5, 0.8 + e.dmg / 50), false);
      audio.play('hitFlesh', { x: px, y: cy, z: pz }, { cat: 'hit' });
    }
    if (!(e.flags & HF.KILL)) return;

    // --- mort : ragdoll, sang, démembrement selon le niveau de violence
    const gore = settings.get('gore');
    let sever = 0;
    const explosive = (e.flags & HF.GIB) !== 0;
    if (gore === 2) {
      if (explosive) sever = SEVER.HEAD | SEVER.ARM_L | SEVER.ARM_R | (Math.random() < 0.7 ? SEVER.LEG_L : 0) | (Math.random() < 0.7 ? SEVER.LEG_R : 0);
      else if (e.flags & HF.BEHEAD) sever = SEVER.HEAD;
      else if (e.weapon === W.SHOTGUN && Math.random() < 0.5) sever = Math.random() < 0.5 ? SEVER.ARM_L : SEVER.ARM_R;
    } else if (gore === 1) {
      if (explosive && Math.random() < 0.6) sever = [SEVER.ARM_L, SEVER.ARM_R, SEVER.LEG_L, SEVER.LEG_R][Math.floor(Math.random() * 4)];
    }
    const force = explosive ? 9 : e.weapon === W.SHOTGUN ? 6.5 : e.weapon === W.SNIPER ? 7.5 : e.weapon === W.KNIFE ? 2.5 : e.weapon === W.FALL ? 0.5 : 3.6;
    const imp = { x: e.dx * force, y: e.dy * force + (explosive ? 3.5 : 0.6), z: e.dz * force };
    let soldier = v.soldier;
    let vel = { x: v.vx, y: 0, z: v.vz };
    if (mine) {
      // mon propre corps : on fabrique un modèle visible à partir de l'état prédit
      const a = this.actors.get(this.myId);
      soldier = new Soldier(lookFor('soldier', a ? a.team : 0, this.myId, this.mode), 1);
      soldier.setWeapon(this.pred.ws.slots[this.pred.ws.cur].id);
      const m = this.pred.move;
      soldier.update(0.016, { x: m.x, y: m.y, z: m.z, yaw: this.viewYaw, pitch: this.viewPitch, vx: m.vx, vz: m.vz, crouch: m.crouching, ground: true });
      vel = { x: m.vx, y: m.vy, z: m.vz };
    }
    if (!soldier) return;
    const rag = this._ragdoll();
    rag.start(soldier, vel, imp, sever, (e.flags & HF.HEAD) !== 0);
    rag.poolAt = gore > 0 ? this.time + 1.4 : Infinity;
    if (mine) { this.deathRagdoll = rag; soldier.dispose(); }
    else if (v.soldier) { v.soldier.setVisible(false); v.shown = false; }
    const pos = { x: px, y: cy, z: pz };
    if (gore > 0) {
      this.effects.bloodHit(px, cy + ((e.flags & HF.HEAD) ? 0.45 * scale : 0), pz, e.dx, e.dy, e.dz, 2.4, (e.flags & HF.HEAD) !== 0);
      if (sever & SEVER.HEAD) this.effects.spawnGibs(px, py + 1.6 * scale, pz, e.dx * 3, 3, e.dz * 3, 6, 0.7);
      if (explosive) this.effects.spawnGibs(px, cy, pz, e.dx * 5, 4, e.dz * 5, 16, 1);
      if (sever) audio.play('gib', pos, { cat: 'voice', gain: 1.1 });
    }
    audio.play('thud', pos, { cat: 'hit', gain: 0.9, delay: 0.35 });
    if (!mine && !v.enemy) audio.play('death', pos, { cat: 'voice', gain: 0.8 });
    else if (v.enemy && Math.random() < 0.5) audio.play('death', pos, { cat: 'voice', gain: 0.7, pitch: v.def.boss ? 0.6 : 0.9 + Math.random() * 0.25 });
  }

  _ragdoll() {
    let r = this.ragdolls.find((x) => !x.alive);
    if (!r) {
      const max = this.app.quality === 'low' ? 6 : 14;
      if (this.ragdolls.length < max) { r = new Ragdoll(); this.scene.add(r.root); this.ragdolls.push(r); }
      else { r = this.ragdolls.reduce((a, b) => (a.age > b.age ? a : b)); }      // on recycle le plus ancien
    }
    return r;
  }

  _evExplode(e) {
    const { audio, renderer } = this.app;
    this.effects.explosion(e.x, e.y, e.z, e.kind);
    audio.play('explosion', e, { cat: 'boom', gain: 1.5 });
    const d = Math.hypot(e.x - this.camera.position.x, e.y - this.camera.position.y, e.z - this.camera.position.z);
    this.shake = Math.min(1.4, this.shake + Math.max(0, 1.3 - d / 22));
    if (d < 9) renderer.fx.flash = Math.max(renderer.fx.flash, 0.5 * (1 - d / 9));
  }

  // ===========================================================================================
  // Objets, projectiles, ragdolls
  // ===========================================================================================
  _updateObjects(dt, rt) {
    const t = this.time;
    for (const p of this.pickups.values()) {
      if (!p.on) continue;
      const u = p.mesh.userData;
      u.body.rotation.y = t * 1.6 + u.phase;
      u.body.position.y = 0.62 + Math.sin(t * 2.2 + u.phase) * 0.07;
      const s = 1 + Math.sin(t * 3 + u.phase) * 0.08;
      u.ring.scale.set(s, 1, s);
    }
    // projectiles : position interpolée entre deux snapshots
    const pair = this.buffer.sample(rt, _pair);
    for (const p of this.projectiles.values()) p.seen = false;
    if (pair) {
      const f = Math.min(1.2, pair.f);
      for (const pb of pair.b.projectiles) {
        let p = this.projectiles.get(pb.id);
        if (!p) {
          p = { id: pb.id, type: pb.type, mesh: pb.type === 1 ? makeRocketMesh() : makeGrenadeMesh(), x: pb.x, y: pb.y, z: pb.z, spin: Math.random() * 6 };
          this.scene.add(p.mesh);
          this.projectiles.set(pb.id, p);
        }
        p.seen = true;
        let pa = null;
        for (const q of pair.a.projectiles) if (q.id === pb.id) { pa = q; break; }
        const ox = p.x, oy = p.y, oz = p.z;
        if (pa) { p.x = pa.x + (pb.x - pa.x) * f; p.y = pa.y + (pb.y - pa.y) * f; p.z = pa.z + (pb.z - pa.z) * f; }
        else { p.x = pb.x; p.y = pb.y; p.z = pb.z; }
        p.mesh.position.set(p.x, p.y, p.z);
        if (p.type === 1) {
          _v.set(p.x - ox, p.y - oy, p.z - oz);
          if (_v.lengthSq() > 1e-6) { p.mesh.lookAt(p.x + _v.x, p.y + _v.y, p.z + _v.z); p.mesh.rotateY(Math.PI); }
          this.effects.rocketTrail(p.x, p.y, p.z);
        } else {
          const moved = Math.hypot(p.x - ox, p.y - oy, p.z - oz);
          p.spin += moved * 6;
          p.mesh.rotation.set(p.spin, p.spin * 0.7, 0);
        }
      }
    }
    for (const p of this.projectiles.values()) if (!p.seen) { this.scene.remove(p.mesh); this.projectiles.delete(p.id); }

    for (const r of this.ragdolls) {
      if (!r.alive) continue;
      r.step(dt, this.world);
      if (r.poolAt && this.time >= r.poolAt) { r.poolAt = 0; r.center(_v); this.effects.addPool(_v.x, _v.y, _v.z); }
      // moignons qui saignent par à-coups
      for (const s of r.stumps) {
        if (r.age > s.until) continue;
        s.next -= dt;
        if (s.next <= 0) {
          s.next = 0.09 + Math.random() * 0.12;
          r.point(s.point, _v); r.torsoUp(_v2);
          this.effects.spurt(_v.x, _v.y, _v.z, _v2.x + (Math.random() - 0.5) * 0.6, Math.abs(_v2.y) + 0.3, _v2.z + (Math.random() - 0.5) * 0.6);
        }
      }
    }
    this.effects.setGore(this.app.settings.get('gore'));
    this.effects.update(dt);

    // sons différés (mécanique des armes)
    const { audio } = this.app;
    if (this.reloadSnd && this.time >= this.reloadSnd) { this.reloadSnd = 0; if (this.pred.ws.reloadT > 0) audio.play('magin', null, { gain: 0.7 }); }
    if (this.pumpAt && this.time >= this.pumpAt) { this.pumpAt = 0; audio.play(this._def() && this._def().id === W.SNIPER ? 'bolt' : 'pump', null, { gain: 0.7 }); }
    if (this.shellAt && this.time >= this.shellAt) { this.shellAt = 0; const d = this._def(); if (d) this._ejectShell(d); }
    if (this.alive && this.hp < 30) { this.heartT -= dt; if (this.heartT <= 0) { this.heartT = 0.95; audio.play('heart', null, { gain: 0.7 }); } }
  }

  // ===========================================================================================
  // Caméra
  // ===========================================================================================
  _updateCamera(dt) {
    const { settings, renderer } = this.app;
    const cam = this.camera;
    const baseFov = settings.get('fov');
    cam.aspect = renderer.aspect;
    if (this.alive && this.pred.alive) {
      const m = this.pred.move, p = this.pred.prev;
      const alpha = clamp(this.acc / SIM_DT, 0, 1);
      const x = p.x + (m.x - p.x) * alpha + this.pred.errX;
      const y = p.y + (m.y - p.y) * alpha + this.pred.errY;
      const z = p.z + (m.z - p.z) * alpha + this.pred.errZ;
      this.smoothY *= Math.exp(-dt * 14);
      this.eyeH += (eyeHeight(m.crouching) - this.eyeH) * Math.min(1, dt * 13);
      const sh = this.shake * this.shake;
      const t = this.time * 38;
      cam.position.set(x + Math.sin(t * 1.3) * sh * 0.05, y + this.eyeH + this.smoothY + Math.sin(t * 1.7 + 1) * sh * 0.05, z + Math.cos(t) * sh * 0.05);
      cam.rotation.set(this.viewPitch + Math.sin(t * 0.9) * sh * 0.03, this.viewYaw + Math.cos(t * 1.1) * sh * 0.03, Math.sin(t * 0.7) * sh * 0.035);
      const def = this._def();
      const zoom = def ? 1 + (def.adsZoom - 1) * this._ease(this.pred.ws.ads) : 1;
      cam.fov = 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) / zoom) * 180 / Math.PI;
    } else {
      // caméra de mort (autour de son propre corps) ou d'observation d'un coéquipier
      cam.fov = baseFov;
      let tx, ty, tz, yaw;
      const spec = this._spectateTarget();
      if (spec) { tx = spec.x; ty = spec.y + 1.5; tz = spec.z; yaw = spec.yaw; }
      else if (this.deathRagdoll && this.deathRagdoll.alive) { this.deathRagdoll.center(_v); tx = _v.x; ty = _v.y + 0.5; tz = _v.z; yaw = this.yaw + this.time * 0.12; }
      else if (this.spawnedOnce) { tx = this.pred.move.x; ty = this.pred.move.y + 1; tz = this.pred.move.z; yaw = this.yaw + this.time * 0.12; }
      else {
        // avant la première apparition : survol lent de la carte
        const a = this.time * 0.06;
        cam.position.set(Math.sin(a) * 30, 14, Math.cos(a) * 30);
        cam.lookAt(0, 2, 0);
        cam.updateProjectionMatrix();
        return;
      }
      const dist = spec ? 3.2 : 3.6, up = spec ? 0.7 : 1.5;
      let dx = Math.sin(yaw) * dist, dz = Math.cos(yaw) * dist, dy = up;
      const l = Math.hypot(dx, dy, dz);
      let k = 1;
      if (this.world.raycast(tx, ty, tz, dx / l, dy / l, dz / l, l + 0.3, _hit)) k = Math.max(0.15, (_hit.t - 0.3) / l);
      cam.position.set(tx + dx * k, ty + dy * k, tz + dz * k);
      cam.lookAt(tx, ty, tz);
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // arme en vue subjective
    if (this.alive && this.pred.alive) {
      const ws = this.pred.ws, m = this.pred.move;
      const def = this._def();
      this.view.setWeapon(ws.slots[ws.cur].id);
      if (this.frame % 5 === 0) {
        const d = this.lighting.dir;
        this.shade = this.world.raycast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z, 120, _hit) ? 0 : 1;
      }
      const b = this.app.input.buttons();
      const sprinting = (b & BTN.SPRINT) && (b & BTN.FWD) && !(b & (BTN.FIRE | BTN.ADS | BTN.CROUCH)) && m.onGround && Math.hypot(m.vx, m.vz) > 5.5;
      this.view.update(dt, {
        ws, def, speed: Math.hypot(m.vx, m.vz), onGround: m.onGround, sprinting: !!sprinting, crouching: m.crouching,
        dyaw: this.dyaw || 0, dpitch: this.dpitch || 0, shade: this.shade, camQuat: cam.quaternion, sunDir: this.lighting.dir, aspect: cam.aspect,
      });
    }
    this.app.audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.alive ? this.viewYaw : Math.atan2(-(cam.getWorldDirection(_v3).x), -_v3.z));
  }
  _ease(t) { return t * t * (3 - 2 * t); }

  _spectateTarget() {
    if (this.mode !== 'coop' && this.state.phase !== 'end') return null;
    if (this.alive) return null;
    if (this.deathRagdoll && this.time - this.diedAt < 3.5) return null;
    let t = this.actors.get(this.specId);
    if (!t || !t.shown || t.enemy) {
      t = null;
      for (const a of this.actors.values()) if (a.shown && !a.enemy && a.id !== this.myId) { t = a; break; }
      this.specId = t ? t.id : 0;
    }
    return t;
  }

  // ===========================================================================================
  // ATH
  // ===========================================================================================
  _boardInfo() {
    const r = this.init.room;
    return { title: r.name, sub: `${MODES[r.mode].name} · ${r.mapName} · code ${r.id}`, mode: r.mode, ts: this.state.ts };
  }
  _boardRows() {
    const rows = [];
    for (const a of this.actors.values()) {
      if (a.enemy) continue;
      const s = this.scores.get(a.id) || { kills: 0, deaths: 0, score: 0, ping: 0, money: 0, alive: false, assists: 0 };
      rows.push({ id: a.id, name: a.name, team: this.mode === 'ffa' ? (a.id === this.myId ? 1 : 0) : a.team, bot: a.bot, me: a.id === this.myId, ...s });
    }
    return rows;
  }

  _syncMenuGame() {
    const r = this.init.room;
    this.app.menus.game = { mode: this.mode, roomId: r.id, roomName: r.name, money: this.money, shop: this.init.shop, ws: this.pred.ws, spawned: this.spawnedOnce };
  }

  _updateHud(dt, playing) {
    const { hud, net } = this.app;
    const st = this.state, now = this.clock.now(performance.now());
    const ws = this.pred.ws, m = this.pred.move;
    hud.setVitals(this.alive ? this.hp : 0, this.alive ? this.armor : 0, 100);
    hud.setMoney(this.mode === 'coop' ? this.money : null);
    if (this.alive) {
      hud.setWeapon(ws);
      const def = this._def();
      const scoped = !!def && !!def.scope && ws.ads > 0.9;
      hud.setScope(scoped);
      const spread = def && !def.melee ? currentSpread(def, ws, m) : 0.004;
      hud.setCrosshair(spread, this.camera.fov * Math.PI / 180, !scoped && ws.ads < 0.6);
    } else { hud.setScope(false); hud.setCrosshair(0.01, 1, false); }

    // --- bandeau supérieur
    const left = st.end ? fmtTime(st.end - now) : '—';
    if (this.mode === 'coop') {
      const cells = [{ label: 'Vague', value: String(st.wave || 0), cls: 'hot' }];
      if (st.phase === 'wave') cells.push({ label: 'Hostiles', value: String(st.left || 0) });
      else if (st.phase === 'inter') cells.push({ label: 'Prochaine vague', value: left });
      else if (st.phase === 'over') cells.push({ label: 'Nouvelle partie', value: left });
      else cells.push({ label: 'En attente', value: '…' });
      let boss = null;
      for (const a of this.actors.values()) if (a.shown && a.def.boss) boss = a;
      if (boss) cells.push({ label: boss.name, value: `${Math.round(boss.hp * 100)} %`, cls: 'bravo' });
      if (st.best) cells.push({ label: 'Record', value: String(st.best) });
      hud.setTop(cells);
    } else if (this.mode === 'tdm') {
      hud.setTop([{ label: 'Alpha', value: String(st.ts ? st.ts[0] : 0), cls: 'alpha' }, { label: `Limite ${st.limit || ''}`, value: left }, { label: 'Bravo', value: String(st.ts ? st.ts[1] : 0), cls: 'bravo' }]);
    } else {
      const mine = this.scores.get(this.myId);
      let best = 0;
      for (const [id, s] of this.scores) if (id !== this.myId && s.kills > best) best = s.kills;
      hud.setTop([{ label: 'Vous', value: String(mine ? mine.kills : 0), cls: 'hot' }, { label: `Limite ${st.limit || ''}`, value: left }, { label: 'Meilleur', value: String(best) }]);
    }

    // --- fin de manche
    if (st.phase === 'end' && !this.endShown) {
      this.endShown = true;
      let big = 'Fin de manche', color = '';
      const me = this.actors.get(this.myId);
      if (st.win) {
        if (st.win.team !== undefined) {
          if (st.win.team === 0) big = 'Égalité';
          else { const won = me && me.team === st.win.team; big = won ? 'Victoire' : 'Défaite'; color = won ? '#49e08a' : '#ff4433'; }
        } else if (st.win.id === this.myId) { big = 'Victoire'; color = '#49e08a'; } else big = `${st.win.name} l'emporte`;
      }
      hud.endScreen(true, big, color, this._boardInfo(), this._boardRows());
      this.app.audio.play(color === '#ff4433' ? 'defeat' : 'stinger', null, { gain: 0.6 });
    } else if (st.phase !== 'end' && this.endShown) { this.endShown = false; hud.endScreen(false); }

    // --- écran de mort
    if (!this.alive && this.spawnedOnce && st.phase !== 'end' && st.phase !== 'over') {
      const who = this.killer ? this.nameOf(this.killer) : '';
      const kw = this.killWeapon;
      const how = WEAPONS[kw] ? WEAPONS[kw].name : (DAMAGE_NAMES[kw] || '');
      let resp;
      if (this.mode === 'coop') resp = 'Retour au combat à la prochaine vague — <kbd>clic</kbd> pour changer de coéquipier observé';
      else {
        const wait = 3.1 - (this.time - this.diedAt);
        resp = wait > 0 ? `Réapparition possible dans ${wait.toFixed(1)} s` : '<kbd>Clic</kbd> pour réapparaître';
      }
      hud.deathScreen(true, who, this.killer ? this.teamClass(this.killer) : '', how, resp);
    } else hud.deathScreen(false);

    // --- invite
    // alerte unique si l'affichage rame : la qualité se règle dans les options
    if (!this.fpsWarned && this.time > 8 && this.fps < 27 && this.app.quality !== 'low' && document.visibilityState === 'visible') {
      this.fpsWarned = true;
      this.app.toast('Affichage peu fluide : baissez la qualité graphique (Échap → Options).');
    }
    if (!this.spawnedOnce && st.phase !== 'end') hud.prompt('Déploiement en cours…');
    else if (this.alive && this.mode !== 'coop' && playing && this.time - this.firstSpawnAt < 7) hud.prompt(`Arsenal : <kbd>${keyLabel('loadout')}</kbd> — scores : <kbd>Tab</kbd>`);
    else if (!playing && !this.app.menus.visible && !hud.chatOpen && st.phase !== 'end') hud.prompt('<kbd>Clic</kbd> pour reprendre le contrôle');
    else if (this.alive && this.mode === 'coop' && st.phase === 'inter') hud.prompt(`Boutique ouverte : <kbd>${keyLabel('shop')}</kbd>`);
    else hud.prompt('');

    // --- radar
    if (this.frame % 2 === 0) {
      const dots = [];
      const px = this.alive ? m.x : this.camera.position.x, pz = this.alive ? m.z : this.camera.position.z;
      for (const p of this.pickups.values()) if (p.on) dots.push({ x: p.x, z: p.z, color: 'rgba(255, 212, 64, 0.8)', r: 2 });
      for (const a of this.actors.values()) {
        if (!a.shown || a.id === this.myId) continue;
        if (this.isHostile(a)) {
          // en PvP un ennemi n'apparaît que s'il vient de tirer ; en coop les hostiles sont toujours repérés
          if (a.enemy || this.time - a.firedAt < 1.6) dots.push({ x: a.x, z: a.z, color: a.def.boss ? '#ff9a2a' : '#ff3b2b', r: a.def.boss ? 5 : 3.2 });
        } else dots.push({ x: a.x, z: a.z, color: '#4aa8ff', r: 3.2 });
      }
      hud.drawMap(px, pz, this.alive ? this.viewYaw : 0, dots);
    }
    hud.update(dt, this.alive ? m.x : this.camera.position.x, this.alive ? m.z : this.camera.position.z, this.viewYaw);
    hud.setNet(this.fps, Math.round(net.rtt), '');
  }

  /** Envoi d'un message de discussion. */
  sendChat(text) { if (text.trim()) this.app.net.send({ t: 'chat', m: text.trim().slice(0, 140) }); }
}
