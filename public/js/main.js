// Point d'entrée du client : initialisation, menus, connexion au serveur, cycle de vie des parties.

import * as THREE from 'three';
import { GAME_TITLE } from '../shared/constants.js';
import { getMap, createWorld } from '../shared/maps/index.js';
import { Renderer } from './gfx/renderer.js';
import { makeSky, makeLighting } from './gfx/worldmesh.js';
import { Settings } from './settings.js';
import { Input, loadKeyboardLayout } from './input.js';
import { Net } from './net.js';
import { GameAudio } from './audio.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { Game, getWorldMesh } from './game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.has('test');

window.__error = null;
window.addEventListener('error', (e) => { window.__error = String(e.message || e.error); });
window.addEventListener('unhandledrejection', (e) => { window.__error = String((e.reason && e.reason.stack) || e.reason); });

document.title = `${GAME_TITLE} — FPS multijoueur`;

const settings = new Settings();
const canvas = $('view');
const renderer = new Renderer(canvas);
renderer.setQuality(params.get('q') || settings.get('quality'));
const input = new Input(canvas);
const audio = new GameAudio();
audio.setVolume(settings.get('volume'));
const hud = new Hud(settings);
const net = new Net();
let game = null;
let loading = false;
let toastTimer = 0;

const app = {
  renderer, settings, input, net, audio, hud, menus: null,
  /** Qualité effective : le paramètre d'URL ?q= prime sur le réglage enregistré (utile aux tests). */
  get quality() { return params.get('q') || settings.get('quality'); },
  toast(msg, ok = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('ok', ok);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  },
};

function playerName() { return settings.get('name') || ''; }
function beginRequest() { audio.init(); }

const menus = new Menus(settings, {
  sound: (n) => audio.play(n, null, { gain: 0.5 }),
  toast: (msg, ok) => app.toast(msg, ok),
  quick: (mode) => { beginRequest(); net.send({ t: 'quick', mode, name: playerName() }); },
  join: (id) => { beginRequest(); net.send({ t: 'join', id, name: playerName() }); },
  create: (cfg) => { beginRequest(); net.send({ t: 'create', cfg, name: playerName() }); },
  refreshRooms: () => net.send({ t: 'rooms' }),
  resume: () => { menus.hide(); input.lock(); },
  quit: () => net.send({ t: 'leave' }),
  loadout: (w) => {
    net.send({ t: 'loadout', w });
    app.toast('Arme principale enregistrée pour la prochaine réapparition.', true);
    if (game && !game.alive) net.send({ t: 'spawn' });
    menus.hide();
    input.lock();
  },
  buy: (key) => net.send({ t: 'buy', k: key }),
});
app.menus = menus;

// ---------------------------------------------------------------------------------------------
// Arrière-plan du menu : survol d'une carte
// ---------------------------------------------------------------------------------------------
const backdrop = { scene: null, camera: null, lighting: null, sky: null, ready: false, t: 0, mesh: null, building: false };

async function buildBackdrop() {
  if (backdrop.ready || backdrop.building) return;
  backdrop.building = true;
  const map = getMap('depot');
  const world = createWorld(map);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color().setHex(map.env.fogColor, THREE.SRGBColorSpace), map.env.fogDensity);
  const sky = makeSky(map.env);
  scene.add(sky);
  const quality = renderer.quality;
  const mesh = await getWorldMesh(map, world, quality);
  if (game || loading) { backdrop.building = false; return; }     // une partie a démarré entre-temps
  scene.add(mesh);
  backdrop.mesh = mesh;
  backdrop.lighting = makeLighting(scene, map, quality === 'ultra' ? 'high' : quality);
  scene.environment = renderer.makeEnvironment(sky);
  scene.environmentIntensity = 0.45;
  backdrop.scene = scene; backdrop.sky = sky;
  backdrop.camera = new THREE.PerspectiveCamera(60, renderer.aspect, 0.1, 1600);
  backdrop.exposure = map.env.exposure || 1;
  backdrop.ready = true;
  backdrop.building = false;
}
function dropBackdrop() {
  if (backdrop.scene && backdrop.mesh) backdrop.scene.remove(backdrop.mesh);      // le maillage reste en cache
  backdrop.ready = false; backdrop.scene = null; backdrop.mesh = null;
}

const _dir = new THREE.Vector3();
function renderBackdrop(dt) {
  if (!backdrop.ready) { renderer.gl.setRenderTarget(null); renderer.gl.clear(); return; }
  backdrop.t += dt;
  const a = backdrop.t * 0.035 + 0.6, cam = backdrop.camera;
  cam.aspect = renderer.aspect;
  cam.position.set(Math.sin(a) * 27 + 6, 7.5 + Math.sin(backdrop.t * 0.11) * 2.5, Math.cos(a) * 24);
  cam.lookAt(-2, 2.6, 0);
  cam.updateProjectionMatrix();
  cam.getWorldDirection(_dir);
  backdrop.lighting.update(cam.position, _dir);
  backdrop.sky.material.uniforms.uTime.value = backdrop.t;
  renderer.setExposure(backdrop.exposure);
  renderer.fx.damage = 0; renderer.fx.desat = 0.15; renderer.fx.aberration = 0; renderer.fx.flash = 0;
  renderer.render(backdrop.scene, cam, null, null, dt);
}

// ---------------------------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------------------------
function setLoading(show, frac = 0, text = '') {
  $('loading').classList.toggle('hidden', !show);
  if (show) { $('loadbar').style.width = `${Math.round(frac * 100)}%`; $('loadtext').textContent = text; }
}

async function startGame(init) {
  if (game) { game.dispose(); game = null; }
  loading = true;
  dropBackdrop();
  menus.hide();
  hud.show(false);
  setLoading(true, 0.02, `${init.room.mapName} — ${init.room.modeName}`);
  const g = new Game(app, init);
  game = g;
  if (TEST) window.__game = g;
  try {
    await g.load((f, text) => setLoading(true, f, text));
  } catch (err) {
    console.error(err);
    window.__error = String(err && err.stack || err);
    app.toast('Le chargement de la carte a échoué.');
    net.send({ t: 'leave' });
    loading = false;
    setLoading(false);
    return;
  }
  if (game !== g) return;            // remplacée pendant le chargement
  g.events.length = 0;               // on ne rejoue pas ce qui s'est passé pendant le chargement
  loading = false;
  setLoading(false);
  hud.show(true);
  audio.startAmbient();
  g._syncMenuGame();
  input.enabled = true;
  input.lock();
  window.__ready = true;
}

function endGame() {
  if (game) { game.dispose(); game = null; }
  loading = false;
  setLoading(false);
  hud.show(false);
  hud.reset();
  input.enabled = false;
  input.unlock();
  menus.game = null;
  menus.show('main');
  buildBackdrop();
}

net.on('hello', (m) => {
  if (!settings.get('name')) settings.set('name', m.name);
  menus.setInfo({ server: m.server, version: m.v, online: m.online, rooms: m.rooms, maps: m.maps, modes: m.modes });
  // tests automatiques et liens d'invitation : ?auto=ffa|tdm|coop ou ?salon=CODE
  const auto = params.get('auto'), code = params.get('salon'), create = params.get('create');
  if (code) { audio.init(); net.send({ t: 'join', id: code, name: playerName() }); }
  else if (create) {
    // ?create=mode,carte,bots : salon privé créé à la volée
    const [mode, map, bots] = create.split(',');
    net.send({ t: 'create', name: params.get('name') || playerName(), cfg: { mode, map, bots: +(bots || 0), private: true, maxPlayers: 8 } });
  }
  else if (auto) net.send({ t: 'quick', mode: auto, name: params.get('name') || playerName() });
  else if (!game) menus.show('main');
});
net.on('rooms', (m) => menus.setInfo({ rooms: m.rooms, online: m.online }));
net.on('init', (m) => { startGame(m); });
net.on('left', (m) => { menus.setInfo({ rooms: m.rooms }); endGame(); });
net.on('err', (m) => { app.toast(m.m); audio.play('error', null, { gain: 0.5 }); });
for (const t of ['a+', 'a-', 'sc', 'st', 'pks', 'pk', 'pk+', 'pk-', 'brl', 'brls', 'chat', 'sys', 'buy', 'ann']) {
  net.on(t, (m) => { if (game) game.onJson(m); });
}
net.onBinary = (buf) => { if (game) game.onSnapshot(buf); };
net.onClose = () => {
  if (game) { game.dispose(); game = null; }
  hud.show(false);
  setLoading(false);
  input.unlock();
  menus.game = null;
  showConnect('Connexion au serveur perdue.');
};

function showConnect(message) {
  const o = $('overlay');
  menus.hide();
  o.classList.add('show');
  o.textContent = '';
  const s = document.createElement('div');
  s.className = 'screen center';
  const h2 = document.createElement('h2'); h2.textContent = GAME_TITLE;
  const p = document.createElement('p'); p.className = 'hint'; p.textContent = message;
  const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = 'Réessayer';
  b.addEventListener('click', () => { o.textContent = ''; o.classList.remove('show'); connect(); });
  s.append(h2, p, b);
  o.appendChild(s);
}

async function connect() {
  window.__started = true;   // le module est chargé : le diagnostic de démarrage peut se taire
  try {
    await net.connect();
    net.send({ t: 'hello', name: playerName() });
  } catch (err) {
    showConnect(err.message || 'Connexion au serveur impossible.');
  }
}

// ---------------------------------------------------------------------------------------------
// Entrées globales
// ---------------------------------------------------------------------------------------------
input.onLockChange = (locked) => {
  if (!game || !game.ready || loading) return;
  if (!locked && !menus.visible && !TEST) {
    if (hud.chatOpen) hud.closeChat();
    game._syncMenuGame();
    menus.show('pause');
  }
};
canvas.addEventListener('click', () => {
  audio.init();
  if (game && game.ready && !menus.visible && !input.locked) input.lock();
});
$('chatinput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { if (game) game.sendChat($('chatinput').value); hud.closeChat(); input.reset(); }
  else if (e.key === 'Escape') hud.closeChat();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game && menus.visible && menus.screen !== 'pause' && !['INPUT', 'SELECT'].includes(e.target.tagName)) {
    game._syncMenuGame();
    menus.show('pause');
  }
});
settings.onChange((k, v) => {
  if (k === 'volume') audio.setVolume(v);
  else if (k === 'quality') renderer.setQuality(app.quality);
  else if (k === 'crosshair') $('crosshair').style.setProperty('--col', v);
});
window.addEventListener('beforeunload', () => net.close());

// ---------------------------------------------------------------------------------------------
// Boucle d'affichage
// ---------------------------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && game.ready) game.frameStep(now);
  else if (!loading) renderBackdrop(dt);
}

if (TEST) {
  input.virtualOnly = true;        // les tests pilotent le jeu sans verrouillage du pointeur
  window.__app = app;
}
loadKeyboardLayout();
requestAnimationFrame(frame);
buildBackdrop();
connect();
