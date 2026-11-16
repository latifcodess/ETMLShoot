// ETMLShoot — serveur de jeu.
// Sert le client (fichiers statiques) et héberge les parties sur WebSocket (/ws).
//
// Variables d'environnement :
//   PORT (8080)            port d'écoute
//   HOST (0.0.0.0)         interface d'écoute
//   MAX_ROOMS (12)         nombre maximal de salons simultanés
//   MAX_CLIENTS (64)       nombre maximal de connexions
//   DEFAULT_ROOMS          salons permanents, ex. "ffa:depot,coop:outpost,tdm:depot" ("none" pour aucun)
//   DEFAULT_BOTS (6)       effectif visé (joueurs + bots) dans les salons PvP permanents
//   SERVER_NAME            nom affiché dans le menu

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TICK_MS, MODES } from '../public/shared/constants.js';
import { MAP_LIST, isValidMap } from '../public/shared/maps/index.js';
import { Room, sanitizeName } from './room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '12', 10);
const MAX_CLIENTS = parseInt(process.env.MAX_CLIENTS || '64', 10);
const DEFAULT_BOTS = parseInt(process.env.DEFAULT_BOTS || '6', 10);
const SERVER_NAME = (process.env.SERVER_NAME || 'Serveur ETMLShoot').slice(0, 40);
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const DEV = process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------------------------
// Fichiers statiques
// ---------------------------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const MOUNTS = [
  { prefix: '/vendor/three/', dir: path.join(ROOT, 'node_modules', 'three'), allow: /^(build|examples\/jsm)\//, immutable: true },
  { prefix: '/', dir: path.join(ROOT, 'public') },
];
const fileCache = new Map();

function loadFile(full) {
  let st;
  try { st = fs.statSync(full); } catch { return null; }
  if (!st.isFile()) return null;
  let ent = fileCache.get(full);
  if (ent && ent.mtime === st.mtimeMs) return ent;
  const buf = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const compressible = /^(text\/|application\/json|image\/svg)/.test(type);
  ent = {
    buf, type, mtime: st.mtimeMs,
    gz: compressible && buf.length > 1024 ? zlib.gzipSync(buf, { level: 6 }) : null,
    etag: '"' + crypto.createHash('sha1').update(buf).digest('base64').slice(0, 20) + '"',
  };
  fileCache.set(full, ent);
  return ent;
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname.includes('\0')) { res.writeHead(400).end(); return; }
  if (pathname === '/') pathname = '/index.html';
  for (const m of MOUNTS) {
    if (!pathname.startsWith(m.prefix)) continue;
    const rel = pathname.slice(m.prefix.length);
    if (m.allow && !m.allow.test(rel)) break;
    const full = path.resolve(m.dir, rel);
    if (full !== m.dir && !full.startsWith(m.dir + path.sep)) break;      // pas de sortie du dossier
    const ent = loadFile(full);
    if (!ent) break;
    const headers = {
      'Content-Type': ent.type,
      'ETag': ent.etag,
      'Cache-Control': m.immutable ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers['if-none-match'] === ent.etag) { res.writeHead(304, headers).end(); return; }
    let body = ent.buf;
    if (ent.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = ent.gz;
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 — introuvable');
}

// ---------------------------------------------------------------------------------------------
// Salons
// ---------------------------------------------------------------------------------------------

const rooms = new Map();
const clients = new Set();

function newRoomId() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let id = '';
    for (let i = 0; i < 4; i++) id += abc[crypto.randomInt(abc.length)];
    if (!rooms.has(id)) return id;
  }
}

function normalizeConfig(raw, permanent) {
  const mode = Object.prototype.hasOwnProperty.call(MODES, raw.mode) ? raw.mode : 'ffa';
  const map = isValidMap(raw.map) ? raw.map : (mode === 'coop' ? 'outpost' : 'depot');
  const num = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const maxPlayers = num(raw.maxPlayers, mode === 'coop' ? 6 : 12, 1, 16);
  return {
    name: String(raw.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 28) || `${MODES[mode].name}`,
    mode, map, maxPlayers,
    bots: mode === 'coop' ? 0 : num(raw.bots, DEFAULT_BOTS, 0, 14),
    difficulty: num(raw.difficulty, 1, 0, 2),
    scoreLimit: num(raw.scoreLimit, mode === 'tdm' ? 50 : 25, 5, 200),
    timeLimit: num(raw.timeLimit, 10, 2, 60),
    private: !!raw.private,
    rotate: !!raw.rotate,
    permanent: !!permanent,
  };
}

function createRoom(raw, permanent = false) {
  const id = newRoomId();
  const room = new Room(id, normalizeConfig(raw, permanent));
  rooms.set(id, room);
  return room;
}

function roomList() {
  const list = [];
  for (const r of rooms.values()) if (!r.cfg.private) list.push(r.info());
  list.sort((a, b) => b.players - a.players);
  return list;
}

function setupDefaultRooms() {
  const spec = process.env.DEFAULT_ROOMS === undefined ? 'ffa:depot,coop:outpost,tdm:outpost' : process.env.DEFAULT_ROOMS;
  if (!spec || spec === 'none') return;
  for (const part of spec.split(',')) {
    const [mode, map] = part.trim().split(':');
    if (!Object.prototype.hasOwnProperty.call(MODES, mode)) continue;
    const n = [...rooms.values()].filter((r) => r.cfg.mode === mode).length + 1;
    createRoom({ mode, map, name: `${MODES[mode].name} #${n}`, bots: DEFAULT_BOTS, rotate: true }, true);
  }
}

// ---------------------------------------------------------------------------------------------
// Connexions
// ---------------------------------------------------------------------------------------------

class Client {
  constructor(ws) {
    this.ws = ws;
    this.name = 'Recrue';
    this.room = null;
    this.actor = null;
    this.rtt = 0;
    this.lastChat = 0;
    this.msgWindow = 0;
    this.msgCount = 0;
    this.binCount = 0;
    this.alive = true;
  }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  sendRaw(str) {
    if (this.ws.readyState !== 1) return;
    if (this.ws.bufferedAmount > 4 * 1024 * 1024) { this.ws.terminate(); return; }   // client noyé
    this.ws.send(str);
  }
  sendBinary(u8) {
    // un client trop lent saute des snapshots plutôt que d'accumuler du retard
    if (this.ws.readyState === 1 && this.ws.bufferedAmount < 192 * 1024) this.ws.send(u8, { binary: true });
  }
}

function joinRoom(c, room) {
  if (c.room) c.room.removeClient(c);
  if (room.clients.size >= room.cfg.maxPlayers) { c.send({ t: 'err', m: 'Ce salon est complet.' }); return; }
  room.addClient(c);
}

function handleJson(c, msg) {
  if (!msg || typeof msg.t !== 'string') return;
  switch (msg.t) {
    case 'hello':
      c.name = sanitizeName(msg.name);
      c.send({
        t: 'hello', v: VERSION, server: SERVER_NAME, name: c.name, rooms: roomList(),
        maps: MAP_LIST, modes: Object.entries(MODES).map(([id, m]) => ({ id, name: m.name, desc: m.desc })),
        online: clients.size,
      });
      break;
    case 'rooms':
      c.send({ t: 'rooms', rooms: roomList(), online: clients.size });
      break;
    case 'name':
      if (!c.room) c.name = sanitizeName(msg.name);
      break;
    case 'join': {
      const room = rooms.get(String(msg.id || '').toUpperCase());
      if (!room) { c.send({ t: 'err', m: 'Salon introuvable (code invalide ou partie terminée).' }); break; }
      if (msg.name) c.name = sanitizeName(msg.name);
      joinRoom(c, room);
      break;
    }
    case 'quick': {
      if (msg.name) c.name = sanitizeName(msg.name);
      const mode = Object.prototype.hasOwnProperty.call(MODES, msg.mode) ? msg.mode : null;
      let best = null;
      for (const r of rooms.values()) {
        if (r.cfg.private || r.clients.size >= r.cfg.maxPlayers) continue;
        if (mode && r.cfg.mode !== mode) continue;
        if (!best || r.clients.size > best.clients.size) best = r;
      }
      if (!best) {
        if (rooms.size >= MAX_ROOMS) { c.send({ t: 'err', m: 'Aucun salon disponible pour le moment.' }); break; }
        best = createRoom({ mode: mode || 'ffa' });
      }
      joinRoom(c, best);
      break;
    }
    case 'create': {
      if (rooms.size >= MAX_ROOMS) { c.send({ t: 'err', m: 'Le serveur a atteint son nombre maximal de salons.' }); break; }
      if (msg.name) c.name = sanitizeName(msg.name);
      const room = createRoom(msg.cfg || {});
      joinRoom(c, room);
      break;
    }
    case 'leave':
      if (c.room) c.room.removeClient(c);
      c.send({ t: 'left', rooms: roomList() });
      break;
    case 'pi':
      if (typeof msg.rtt === 'number' && msg.rtt >= 0 && msg.rtt < 5000) c.rtt = msg.rtt;
      c.send({ t: 'po', c: msg.c });
      break;
    default:
      if (c.room) c.room.onJson(c, msg);
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
  if (req.url === '/api/status') {
    const body = JSON.stringify({ name: SERVER_NAME, version: VERSION, uptime: Math.round(process.uptime()), online: clients.size, rooms: roomList() });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(body);
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024, perMessageDeflate: false });

wss.on('connection', (ws) => {
  if (clients.size >= MAX_CLIENTS) { ws.close(1013, 'Serveur complet'); return; }
  const c = new Client(ws);
  clients.add(c);
  ws.on('message', (data, isBinary) => {
    // limitation de débit : 150 trames binaires et 25 messages JSON par seconde
    const now = Date.now();
    if (now - c.msgWindow > 1000) { c.msgWindow = now; c.msgCount = 0; c.binCount = 0; }
    if (isBinary) {
      if (++c.binCount > 150) return;
      if (c.room) c.room.onBinary(c, data);
      return;
    }
    if (++c.msgCount > 25) return;
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    try { handleJson(c, msg); } catch (err) { console.error('[msg]', err); }
  });
  ws.on('pong', () => { c.alive = true; });
  ws.on('close', () => {
    clients.delete(c);
    if (c.room) { try { c.room.removeClient(c); } catch (err) { console.error('[close]', err); } }
  });
  ws.on('error', () => {});
});

// Détection des connexions mortes
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch { /* socket déjà fermée */ }
  }
}, 15000).unref();

// ---------------------------------------------------------------------------------------------
// Boucle de simulation globale (30 Hz, à dérive corrigée)
// ---------------------------------------------------------------------------------------------

let nextTick = performance.now();
let slowTicks = 0;

function loop() {
  const now = performance.now();
  let steps = 0;
  while (now >= nextTick && steps < 3) {
    const t0 = performance.now();
    for (const room of rooms.values()) {
      if (!room.clients.size) continue;            // un salon vide dort
      try { room.tickOnce(); } catch (err) {
        console.error(`[salon ${room.id}] erreur de simulation :`, err);
        for (const c of [...room.clients]) { c.send({ t: 'err', m: 'Erreur interne du salon : la partie a été fermée.', fatal: 1 }); room.removeClient(c); c.send({ t: 'left', rooms: roomList() }); }
        rooms.delete(room.id);
        if (room.cfg.permanent) createRoom(room.cfg, true);
      }
    }
    if (performance.now() - t0 > TICK_MS) slowTicks++;
    nextTick += TICK_MS;
    steps++;
  }
  if (now - nextTick > 250) nextTick = now;        // trop de retard : on resynchronise
  setTimeout(loop, Math.max(0, nextTick - performance.now()));
}

// Ménage : suppression des salons temporaires restés vides
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.cfg.permanent || room.clients.size) continue;
    if (room.emptySince && now - room.emptySince > 45000) rooms.delete(room.id);
  }
  if (slowTicks > 0) { console.warn(`[perf] ${slowTicks} tick(s) lent(s) sur la dernière minute`); slowTicks = 0; }
}, 60000).unref();

setupDefaultRooms();
server.listen(PORT, HOST, () => {
  console.log(`ETMLShoot v${VERSION} — ${SERVER_NAME}`);
  console.log(`  écoute sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (${DEV ? 'développement' : 'production'})`);
  console.log(`  ${rooms.size} salon(s) permanent(s), ${MAX_ROOMS} salons max, ${MAX_CLIENTS} connexions max`);
  loop();
});

function shutdown() {
  console.log('Arrêt du serveur…');
  for (const c of clients) { try { c.ws.close(1001, 'Arrêt du serveur'); } catch { /* ignore */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
