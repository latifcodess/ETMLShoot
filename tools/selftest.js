// Banc de test automatique du cœur du jeu (sans navigateur).
//   node tools/selftest.js            → tout
//   node tools/selftest.js physics    → un seul groupe (physics | maps | pvp | coop | net)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { getMap, createWorld, MAP_LIST } from '../public/shared/maps/index.js';
import { createMoveState, createMoveInput, stepMove, eyeHeight } from '../public/shared/physics.js';
import { SIM_DT, BTN, SLOT_SHIFT, TICK_MS, HULL } from '../public/shared/constants.js';
import { W, SLOT, WEAPONS } from '../public/shared/weapons.js';
import { chestHeight } from '../public/shared/anatomy.js';
import { EV, HF } from '../public/shared/protocol.js';
import { decodeSnapshot, encodeInput, quantYaw, quantPitch, dequantYaw, Predictor, ServerClock, SnapshotBuffer } from '../public/js/netcode.js';
import { Room } from '../server/room.js';
import { histSample } from '../server/combat.js';
import { validateMap } from './mapview.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(cond, label, detail = '') {
  if (cond) console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

// ---------------------------------------------------------------------------------------------
function testPhysics() {
  console.log('\n[physique]');
  const world = createWorld(getMap('depot'));
  const s = createMoveState();
  const inp = createMoveInput();
  const run = (secs, cb) => { for (let i = 0; i < secs * 60; i++) { stepMove(s, inp, SIM_DT, world); if (cb) cb(i); } };

  // chute et pose au sol
  s.x = 0; s.y = 1.5; s.z = 4.5;
  run(1);
  check(s.onGround && Math.abs(s.y) < 1e-6, 'atterrissage au sol', `y=${s.y.toFixed(4)}`);

  // marche contre un mur : pas de traversée
  s.x = 2.7;
  inp.mf = 1; inp.yaw = Math.PI;      // vers +Z (mur sud de l'entrepôt, face intérieure à z = 7,6)
  run(4);
  check(Math.abs(s.z - (7.6 - HULL.halfW - 0.001)) < 1e-6, 'arrêt contre un mur', `z=${s.z.toFixed(4)}`);

  // saut
  inp.mf = 0; s.x = 0; s.z = 4.5; s.vx = s.vz = 0;
  run(0.2);
  let peak = 0;
  inp.jump = true;
  stepMove(s, inp, SIM_DT, world);
  inp.jump = false;
  run(1.2, () => { if (s.y > peak) peak = s.y; });
  check(peak > 0.9 && peak < 1.1 && s.onGround, 'hauteur de saut', `${peak.toFixed(3)} m`);

  // montée de l'escalier ouest de l'entrepôt jusqu'à la mezzanine (3,25 m)
  s.x = -7.5; s.y = 0; s.z = 1.2; s.vx = s.vy = s.vz = 0;
  inp.mf = 1; inp.yaw = 0;            // vers -Z
  let air = 0, total = 0;
  run(3.2, () => { total++; if (!s.onGround) air++; });
  check(Math.abs(s.y - 3.25) < 1e-6 && s.z < -4.6, "montée d'escalier", `y=${s.y.toFixed(3)} z=${s.z.toFixed(2)} (${air}/${total} pas en l'air)`);
  check(air < total * 0.05, "montée sans décollage");

  // descente : le personnage doit rester collé aux marches
  inp.yaw = Math.PI; air = 0; total = 0;
  s.z = -4.9;
  run(2.6, () => { total++; if (!s.onGround) air++; });
  check(Math.abs(s.y) < 1e-6 && s.z > 0, "descente d'escalier", `y=${s.y.toFixed(3)} (${air}/${total} pas en l'air)`);
  check(air < total * 0.05, 'descente collée au sol');

  // accroupissement puis retour debout
  inp.mf = 0; inp.crouch = true; s.x = 0; s.y = 0; s.z = 4.5; s.vx = s.vz = 0;
  run(0.2);
  check(s.crouching, 'accroupissement');
  inp.crouch = false;
  run(0.2);
  check(!s.crouching, 'se relever à découvert');

  // robustesse : marche aléatoire, jamais de NaN ni de sortie de carte
  let ok = true;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const id of MAP_LIST.map((m) => m.id)) {
    const map = getMap(id), w = createWorld(map);
    for (const sp of map.spawns.ffa) {
      s.x = sp.x; s.y = sp.y + 0.01; s.z = sp.z; s.vx = s.vy = s.vz = 0; s.onGround = false; s.crouching = false;
      for (let i = 0; i < 900; i++) {
        if (i % 40 === 0) { inp.mf = rnd() < 0.8 ? 1 : -1; inp.ms = Math.round(rnd() * 2 - 1); inp.yaw = rnd() * 6.28; inp.jump = rnd() < 0.3; inp.crouch = rnd() < 0.15; inp.sprint = rnd() < 0.5; }
        stepMove(s, inp, SIM_DT, w);
        if (!Number.isFinite(s.x + s.y + s.z) || s.y < -0.01 || s.x < map.bounds.minX - 0.5 || s.x > map.bounds.maxX + 0.5 || s.z < map.bounds.minZ - 0.5 || s.z > map.bounds.maxZ + 0.5) ok = false;
      }
    }
  }
  check(ok, 'marche aléatoire sur toutes les cartes (ni NaN, ni chute sous le sol, ni sortie)');
}

// ---------------------------------------------------------------------------------------------
function testMaps() {
  console.log('\n[cartes et navigation]');
  for (const m of MAP_LIST) {
    const r = validateMap(m.id, { quiet: true });
    check(r.problems.length === 0 && r.pathFail === 0, `carte « ${m.name} »`, `${r.nav.reachable.length} nœuds accessibles${r.problems.length ? ' ; ' + r.problems.join(' | ') : ''}`);
  }
}

// ---------------------------------------------------------------------------------------------
class FakeClient {
  constructor(name) {
    this.name = name; this.room = null; this.actor = null; this.rtt = 20; this.lastChat = 0;
    this.json = []; this.snaps = 0; this.last = null; this.bytes = 0; this.decodeErrors = 0; this.seq = 0;
    this.events = { shots: 0, hits: 0, kills: 0, explosions: 0 };
  }
  send(o) { this.json.push(o); }
  sendRaw(s) { this.json.push(JSON.parse(s)); }
  sendBinary(u8) {
    this.snaps++; this.bytes += u8.length;
    try {
      const snap = decodeSnapshot(u8);
      this.last = snap;
      for (const e of snap.events) {
        if (e.type === EV.SHOT) this.events.shots++;
        else if (e.type === EV.HIT) { this.events.hits++; if (e.flags & HF.KILL) this.events.kills++; }
        else if (e.type === EV.EXPLODE) this.events.explosions++;
      }
    } catch (err) { this.decodeErrors++; if (this.decodeErrors === 1) console.log('    erreur de décodage :', err.message); }
  }
  /** Envoie deux commandes (un tick) au salon. */
  input(room, buttons, yaw, pitch, rt) {
    const cmds = [];
    for (let i = 0; i < 2; i++) cmds.push({ buttons, yawQ: quantYaw(yaw), pitchQ: quantPitch(pitch) });
    room.onBinary(this, encodeInput(this.seq + 1, rt, cmds));
    this.seq += 2;
  }
}

function simulateRoom(room, ticks, perTick) {
  const t0 = performance.now();
  let worst = 0;
  for (let i = 0; i < ticks; i++) {
    const a = performance.now();
    if (perTick) perTick(i);
    room.tickOnce();
    const d = performance.now() - a;
    if (d > worst) worst = d;
  }
  return { avg: (performance.now() - t0) / ticks, worst };
}

function testPvp() {
  console.log('\n[PvP en accéléré]');
  for (const [mode, map] of [['ffa', 'depot'], ['tdm', 'outpost']]) {
    const room = new Room('T' + mode, { name: 'test', mode, map, bots: 10, difficulty: 1, maxPlayers: 12, scoreLimit: 1000, timeLimit: 60 });
    const c = new FakeClient('Testeur');
    room.addClient(c);
    room.onJson(c, { t: 'ready', w: W.AR });
    const start = new Map();
    let nan = false, stuckTicks = 0, samples = 0;
    const perf = simulateRoom(room, 30 * 150, (i) => {
      c.input(room, BTN.FWD | (SLOT.PRIMARY << SLOT_SHIFT), (i / 90) % 6.28, 0, room.time);
      if (i === 60) for (const a of room.actorList) start.set(a.id, [a.move.x, a.move.z]);
      if (i % 30 === 0) {
        for (const a of room.actorList) {
          if (!Number.isFinite(a.move.x + a.move.y + a.move.z + a.yaw + a.pitch)) nan = true;
          if (a.isBot && a.alive) { samples++; if (a.brain && a.brain.stuck > 1.5) stuckTicks++; }
        }
      }
    });
    const bots = room.actorList.filter((a) => a.isBot);
    const kills = bots.reduce((s, a) => s + a.kills, 0) + c.actor.kills;
    const deaths = room.actorList.reduce((s, a) => s + a.deaths, 0);
    check(bots.length === 9, `${mode} : effectif complété par des bots`, `${bots.length} bots + 1 joueur`);
    check(!nan, `${mode} : aucun NaN`);
    check(kills >= 8, `${mode} : les bots se battent`, `${kills} éliminations, ${deaths} morts en 150 s simulées`);
    check(stuckTicks < samples * 0.03, `${mode} : bots non bloqués`, `${stuckTicks}/${samples} relevés en difficulté`);
    check(c.decodeErrors === 0 && c.snaps > 4000, `${mode} : snapshots décodables`, `${c.snaps} snapshots, ${(c.bytes / c.snaps).toFixed(0)} octets en moyenne`);
    check(c.events.shots > 100 && c.events.hits > 20, `${mode} : événements de tir reçus`, `${c.events.shots} tirs, ${c.events.hits} touches, ${c.events.explosions} explosions`);
    check(perf.avg < 4, `${mode} : coût de simulation`, `${perf.avg.toFixed(2)} ms/tick en moyenne, pire ${perf.worst.toFixed(1)} ms`);
    if (mode === 'tdm') {
      const st = room.mode.state();
      check(st.ts[0] + st.ts[1] > 0, 'tdm : score par équipes', `ALPHA ${st.ts[0]} – BRAVO ${st.ts[1]}`);
    }
    room.removeClient(c);
  }

  // fin de manche et relance
  const room = new Room('TEND', { name: 'fin', mode: 'ffa', map: 'depot', bots: 8, difficulty: 2, maxPlayers: 12, scoreLimit: 3, timeLimit: 60 });
  const c = new FakeClient('Testeur');
  room.addClient(c);
  room.onJson(c, { t: 'ready', w: W.SMG });
  let ended = false, restarted = false;
  simulateRoom(room, 30 * 240, () => {
    c.input(room, 0, 0, 0, room.time);
    if (room.mode.phase === 'end') ended = true;
    else if (ended) restarted = true;
  });
  check(ended && restarted, 'ffa : fin de manche puis nouvelle manche');
}

function testCoop() {
  console.log('\n[Survie coop en accéléré]');
  const room = new Room('TCOOP', { name: 'coop', mode: 'coop', map: 'outpost', bots: 0, difficulty: 1, maxPlayers: 4 });
  const c = new FakeClient('Tireur');
  room.addClient(c);
  room.onJson(c, { t: 'ready', w: W.AR });
  const a = c.actor;
  check(a.alive && a.ws.slots[SLOT.SECONDARY].id === W.PISTOL, 'apparition avec le pistolet');
  const _s = { x: 0, y: 0, z: 0, crouch: false };
  let bought = [], maxEnemies = 0, kinds = new Set(), buyErr = null;
  const LAG = 100;
  const perf = simulateRoom(room, 30 * 420, (i) => {
    a.maxHp = 1e9; a.hp = 1e9;                       // invincible : on teste la boucle de jeu, pas l'adresse
    if (room.mode.wave >= 6) return c.input(room, 0, 0, 0, room.time);
    // achats dès que possible
    if (i % 30 === 0) {
      for (const k of ['lmg', 'armor']) {
        if (bought.includes(k)) continue;
        const err = room.mode.buy(a, k);
        if (!err) bought.push(k); else buyErr = err;
      }
    }
    // « aimbot » avec 100 ms de latence simulée : vise la position passée, le serveur doit la retrouver
    let best = null, bd = 1e9;
    const ex = a.move.x, ey = a.move.y + eyeHeight(a.move.crouching), ez = a.move.z;
    let n = 0;
    for (const t of room.actorList) {
      if (!t.isEnemy || !t.alive) continue;
      n++; kinds.add(t.kind);
      histSample(t, room.time - LAG, _s);
      const cy = _s.y + chestHeight(_s.crouch, t.scale);
      const d = Math.hypot(_s.x - ex, cy - ey, _s.z - ez);
      if (d < bd && !room.world.segmentBlocked(ex, ey, ez, _s.x, cy, _s.z)) { bd = d; best = { x: _s.x, y: cy, z: _s.z }; }
    }
    if (n > maxEnemies) maxEnemies = n;
    const slot = a.ws.slots[SLOT.PRIMARY].id >= 0 ? SLOT.PRIMARY : SLOT.SECONDARY;
    let buttons = slot << SLOT_SHIFT, yaw = a.yaw, pitch = 0;
    if (best) {
      const dx = best.x - ex, dy = best.y - ey, dz = best.z - ez;
      yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz));
      // semi-automatique : on alterne appui/relâchement
      if (WEAPONS[a.ws.slots[a.ws.cur].id].auto || i % 4 < 2) buttons |= BTN.FIRE;
    } else {
      // personne en vue : rester en ravitaillement
      if (i % 600 === 0) room.mode.buy(a, 'ammo');
    }
    c.input(room, buttons, yaw, pitch, room.time - LAG);
  });
  const st = room.mode.state();
  check(st.wave >= 4, 'les vagues s\'enchaînent', `vague ${st.wave} atteinte en 7 min simulées, ${a.kills} éliminations`);
  check(maxEnemies >= 5, 'les ennemis apparaissent et convergent', `jusqu'à ${maxEnemies} simultanés, ${kinds.size} types différents`);
  check(bought.includes('lmg'), 'boutique : achat d\'arme', bought.join(', ') + (buyErr ? ` (dernier refus : ${buyErr})` : ''));
  check(a.money >= 0 && a.kills > 15, 'primes versées', `${Math.round(a.money)} $ en caisse`);
  check(c.events.hits > 30, 'compensation de latence : tirs sur cibles mobiles enregistrés', `${c.events.hits} touches pour ${c.events.shots} tirs observés`);
  check(c.decodeErrors === 0, 'snapshots décodables');
  check(perf.avg < 5, 'coût de simulation', `${perf.avg.toFixed(2)} ms/tick en moyenne, pire ${perf.worst.toFixed(1)} ms`);

  // défaite : sans invincibilité ni riposte, l'escouade tombe et la partie repart de zéro
  const room2 = new Room('TOVER', { name: 'coop2', mode: 'coop', map: 'depot', bots: 0, difficulty: 1, maxPlayers: 4 });
  const c2 = new FakeClient('Victime');
  room2.addClient(c2);
  room2.onJson(c2, { t: 'ready', w: W.AR });
  let over = false, reset = false;
  simulateRoom(room2, 30 * 400, () => {
    c2.input(room2, 0, 0, 0, room2.time);
    if (room2.mode.phase === 'over') over = true;
    else if (over && room2.mode.wave <= 1) reset = true;
  });
  check(over, 'défaite détectée quand toute l\'escouade est tombée', `${c2.actor.deaths} mort(s)`);
  check(reset, 'la partie repart à la vague 1');
}

// ---------------------------------------------------------------------------------------------
async function testNetwork() {
  console.log('\n[réseau réel]');
  const port = 18000 + Math.floor(Math.random() * 2000);
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DEFAULT_ROOMS: 'ffa:depot' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('le serveur ne démarre pas : ' + log)), 8000);
      const iv = setInterval(() => { if (log.includes('écoute')) { clearTimeout(t); clearInterval(iv); res(); } }, 50);
    });
    const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
    check(status.rooms.length === 1, 'API d\'état', `${status.name}, ${status.rooms.length} salon`);
    const trav = await fetch(`http://127.0.0.1:${port}/..%2f..%2fpackage.json`);
    const trav2 = await fetch(`http://127.0.0.1:${port}/vendor/three/package.json`);
    check(trav.status === 404 && trav2.status === 404, 'fichiers hors périmètre refusés', `${trav.status} / ${trav2.status}`);
    const three = await fetch(`http://127.0.0.1:${port}/vendor/three/build/three.module.js`);
    const shared = await fetch(`http://127.0.0.1:${port}/shared/constants.js`);
    check(three.status === 200 && shared.status === 200, 'modules servis (three, code partagé)');

    const world = createWorld(getMap('depot'));
    const pred = new Predictor(world);
    const clock = new ServerClock();
    const buffer = new SnapshotBuffer();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.binaryType = 'arraybuffer';
    const stats = { snaps: 0, firstSnapAt: 0, lastSnapAt: 0, init: null, hello: null, maxPending: 0, others: 0, json: {} };
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const snap = decodeSnapshot(data);
        stats.snaps++;
        const now = performance.now();
        if (!stats.firstSnapAt) stats.firstSnapAt = now;
        stats.lastSnapAt = now;
        clock.onSnapshot(snap.time, now);
        buffer.push(snap);
        pred.reconcile(snap);
        stats.others = Math.max(stats.others, snap.actors.length);
        return;
      }
      const msg = JSON.parse(data.toString());
      stats.json[msg.t] = (stats.json[msg.t] || 0) + 1;
      if (msg.t === 'hello') { stats.hello = msg; ws.send(JSON.stringify({ t: 'quick', mode: 'ffa' })); }
      else if (msg.t === 'init') { stats.init = msg; ws.send(JSON.stringify({ t: 'ready', w: W.AR })); }
    });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.send(JSON.stringify({ t: 'hello', name: '<b>Net\u0007Test</b>' }));

    // boucle client à 60 Hz pendant 7 s : déplacements variés, sauts, accroupissements
    let seq = 0, acc = 0, last = performance.now();
    const t0 = last;
    let correctionsAfterWarmup = 0, warm = false;
    await new Promise((res) => {
      const iv = setInterval(() => {
        const now = performance.now();
        acc += (now - last) / 1000; last = now;
        const el = (now - t0) / 1000;
        if (el > 1.5 && !warm) { warm = true; pred.corrections = 0; }
        const cmds = [];
        const first = seq + 1;
        while (acc >= SIM_DT && cmds.length < 8) {
          acc -= SIM_DT;
          seq++;
          let b = SLOT.PRIMARY << SLOT_SHIFT;
          const phase = Math.floor(el * 1.3) % 6;
          if (phase !== 5) b |= BTN.FWD;
          if (phase === 1) b |= BTN.LEFT;
          if (phase === 3) b |= BTN.RIGHT | BTN.SPRINT;
          if (phase === 2 && seq % 40 < 3) b |= BTN.JUMP;
          if (phase === 4) b |= BTN.CROUCH;
          const yawQ = quantYaw(el * 0.9), pitchQ = quantPitch(0);
          pred.step(seq, b, dequantYaw(yawQ));
          cmds.push({ buttons: b, yawQ, pitchQ });
        }
        if (cmds.length && ws.readyState === 1) ws.send(encodeInput(first, clock.renderTime(now), cmds));
        stats.maxPending = Math.max(stats.maxPending, pred.count);
        if (el > 7) { clearInterval(iv); correctionsAfterWarmup = pred.corrections; res(); }
      }, 8);
    });
    const rate = (stats.snaps - 1) / ((stats.lastSnapAt - stats.firstSnapAt) / 1000);
    check(stats.hello && stats.hello.name === 'bNetTest/b', 'nom assaini côté serveur', JSON.stringify(stats.hello && stats.hello.name));
    check(stats.init && stats.init.room.mode === 'ffa', 'entrée dans un salon', stats.init ? `${stats.init.room.name}, ${stats.init.actors.length} acteurs annoncés` : '');
    check(rate > 27 && rate < 33, 'cadence des snapshots', `${rate.toFixed(1)} /s`);
    check(pred.alive, 'le joueur est en vie côté client');
    check(correctionsAfterWarmup <= 3, 'prédiction fidèle au serveur', `${correctionsAfterWarmup} correction(s) en 5,5 s de déplacements, ${stats.maxPending} commandes en attente au plus`);
    check(stats.others >= 2, 'autres acteurs visibles dans les snapshots', `${stats.others} acteurs`);
    check((stats.json.sc || 0) > 0 && (stats.json.st || 0) > 0, 'scores et état de partie reçus');
    ws.close();
  } finally {
    proc.kill('SIGTERM');
  }
}

// ---------------------------------------------------------------------------------------------
const only = process.argv[2];
const groups = { physics: testPhysics, maps: testMaps, pvp: testPvp, coop: testCoop, net: testNetwork };
const t0 = performance.now();
for (const [name, fn] of Object.entries(groups)) {
  if (only && only !== name) continue;
  try { await fn(); } catch (err) { failures++; console.log(`  ✗ exception dans « ${name} » :`, err); }
}
console.log(`\n${failures ? `ÉCHEC : ${failures} vérification(s) en défaut` : 'Tout est vert'} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
