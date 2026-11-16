// Protocole réseau.
//
// Deux familles de messages circulent sur la même WebSocket :
//   * trames BINAIRES : flux à haute fréquence (snapshots serveur→client, commandes client→serveur)
//   * trames TEXTE (JSON, champ `t`) : salon, scores, discussion, boutique... à basse fréquence
//
// SNAPSHOT (serveur → client)
//   u8 type, u32 tempsServeur(ms), u32 ackSeq, bloc "moi", acteurs, projectiles, événements
// INPUT (client → serveur)
//   u8 type, u32 premierSeq, u32 tempsAffiché(ms), u8 n, n × (u16 boutons, u16 lacet, i16 tangage)

import { TAU } from './mathx.js';

export const MSG = { SNAPSHOT: 1, INPUT: 2 };

/** Événements transitoires embarqués dans un snapshot. */
export const EV = { SHOT: 1, HIT: 2, EXPLODE: 3, MELEE: 4, THROW: 5 };

/** Drapeaux d'un événement HIT. */
export const HF = { HEAD: 1, KILL: 2, GIB: 4, ARMOR: 8, NOSHOT: 16, DOWN: 32, BEHEAD: 64 };

/** Drapeaux du bloc « moi » d'un snapshot. */
export const OF = { ALIVE: 1, GROUND: 2, CROUCH: 4, PROTECTED: 8, DOWNED: 16 };

export const POS_SCALE = 100;        // positions quantifiées au centimètre
export const NO_ACTOR = 0xffff;

export function quantYaw(yaw) {
  let a = yaw % TAU;
  if (a < 0) a += TAU;
  return Math.round(a * (65536 / TAU)) & 0xffff;
}
export function dequantYaw(q) { return q * (TAU / 65536); }
export function quantPitch(p) {
  const v = Math.round(p * (32767 / (Math.PI / 2)));
  return v < -32767 ? -32767 : v > 32767 ? 32767 : v;
}
export function dequantPitch(q) { return q * ((Math.PI / 2) / 32767); }
export function quantPos(v) {
  const q = Math.round(v * POS_SCALE);
  return q < -32767 ? -32767 : q > 32767 ? 32767 : q;
}

export class ByteWriter {
  constructor(size = 4096) {
    this.buf = new ArrayBuffer(size);
    this.dv = new DataView(this.buf);
    this.u8a = new Uint8Array(this.buf);
    this.pos = 0;
  }
  reset() { this.pos = 0; return this; }
  _need(n) {
    if (this.pos + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(this.u8a.subarray(0, this.pos));
    this.buf = nb; this.dv = new DataView(nb); this.u8a = new Uint8Array(nb);
  }
  u8(v) { this._need(1); this.dv.setUint8(this.pos, v); this.pos += 1; return this; }
  i8(v) { this._need(1); this.dv.setInt8(this.pos, v); this.pos += 1; return this; }
  u16(v) { this._need(2); this.dv.setUint16(this.pos, v, true); this.pos += 2; return this; }
  i16(v) { this._need(2); this.dv.setInt16(this.pos, v, true); this.pos += 2; return this; }
  u32(v) { this._need(4); this.dv.setUint32(this.pos, v >>> 0, true); this.pos += 4; return this; }
  f32(v) { this._need(4); this.dv.setFloat32(this.pos, v, true); this.pos += 4; return this; }
  pos3(x, y, z) { return this.i16(quantPos(x)).i16(quantPos(y)).i16(quantPos(z)); }
  bytes(src, len) { this._need(len); this.u8a.set(src.subarray(0, len), this.pos); this.pos += len; return this; }
  /** Vue (sans copie) sur les octets écrits. */
  view() { return this.u8a.subarray(0, this.pos); }
}

export class ByteReader {
  /** @param {ArrayBuffer|Uint8Array} data */
  constructor(data) {
    if (data instanceof ArrayBuffer) this.dv = new DataView(data);
    else this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = 0;
    this.len = this.dv.byteLength;
  }
  get left() { return this.len - this.pos; }
  u8() { const v = this.dv.getUint8(this.pos); this.pos += 1; return v; }
  i8() { const v = this.dv.getInt8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  p16() { return this.i16() / POS_SCALE; }
}
