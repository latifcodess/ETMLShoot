// Monde statique : un ensemble de boîtes alignées sur les axes, indexées par une grille XZ.
// Sert aux collisions des joueurs, aux tirs (lancer de rayon) et à l'IA.
// Code strictement déterministe : il tourne à l'identique sur le serveur et le client.

import { BF } from './constants.js';

const EPS = 0.001;       // écart laissé entre le gabarit et une surface
const SHRINK = 0.0005;   // rétrécissement du gabarit pour ignorer les contacts rasants
const BACKTOL = 0.02;    // tolérance de pénétration (permet de se dégager)

export class World {
  /**
   * @param {Array<{min:number[],max:number[],mat:number,flags:number}>} boxes
   * @param {{minX:number,minZ:number,maxX:number,maxZ:number}} bounds
   */
  constructor(boxes, bounds, cellSize = 4) {
    this.count = boxes.length;
    this.b = new Float64Array(this.count * 6);
    this.mat = new Uint8Array(this.count);
    this.flags = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const bx = boxes[i];
      this.b[i * 6] = bx.min[0]; this.b[i * 6 + 1] = bx.min[1]; this.b[i * 6 + 2] = bx.min[2];
      this.b[i * 6 + 3] = bx.max[0]; this.b[i * 6 + 4] = bx.max[1]; this.b[i * 6 + 5] = bx.max[2];
      this.mat[i] = bx.mat | 0;
      this.flags[i] = bx.flags | 0;
    }
    this.bounds = bounds;
    this.cs = cellSize;
    this.gx0 = bounds.minX - cellSize;
    this.gz0 = bounds.minZ - cellSize;
    this.nx = Math.ceil((bounds.maxX + cellSize - this.gx0) / cellSize);
    this.nz = Math.ceil((bounds.maxZ + cellSize - this.gz0) / cellSize);
    this.gx1 = this.gx0 + this.nx * cellSize;
    this.gz1 = this.gz0 + this.nz * cellSize;

    // Construction de la grille (les boîtes décoratives n'y figurent pas)
    const lists = new Array(this.nx * this.nz);
    for (let i = 0; i < lists.length; i++) lists[i] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.flags[i] & BF.NOCOLLIDE) continue;
      const o = i * 6;
      const ix0 = this._cx(this.b[o]), ix1 = this._cx(this.b[o + 3]);
      const iz0 = this._cz(this.b[o + 2]), iz1 = this._cz(this.b[o + 5]);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) lists[iz * this.nx + ix].push(i);
      }
    }
    this.cells = lists.map((l) => Int32Array.from(l));
    this.stamp = new Int32Array(this.count);
    this.stampId = 0;
    this.q = new Int32Array(Math.max(64, this.count));   // résultat de la dernière requête
    this.qn = 0;
  }

  _cx(x) { const i = Math.floor((x - this.gx0) / this.cs); return i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i; }
  _cz(z) { const i = Math.floor((z - this.gz0) / this.cs); return i < 0 ? 0 : i >= this.nz ? this.nz - 1 : i; }

  /** Remplit this.q avec les boîtes dont la cellule recouvre le rectangle XZ. Renvoie leur nombre. */
  query(minX, minZ, maxX, maxZ) {
    const ix0 = this._cx(minX), ix1 = this._cx(maxX);
    const iz0 = this._cz(minZ), iz1 = this._cz(maxZ);
    const q = this.q;
    let n = 0;
    if (ix0 === ix1 && iz0 === iz1) {
      const c = this.cells[iz0 * this.nx + ix0];
      for (let k = 0; k < c.length; k++) q[n++] = c[k];
      this.qn = n;
      return n;
    }
    const id = ++this.stampId;
    const stamp = this.stamp;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = this.cells[iz * this.nx + ix];
        for (let k = 0; k < c.length; k++) {
          const bi = c[k];
          if (stamp[bi] !== id) { stamp[bi] = id; q[n++] = bi; }
        }
      }
    }
    this.qn = n;
    return n;
  }

  /** Vrai si le gabarit (pieds en x,y,z ; demi-largeur hw ; hauteur h) ne touche aucune boîte solide. */
  hullFree(x, y, z, hw, h) {
    const x0 = x - hw + SHRINK, x1 = x + hw - SHRINK;
    const y0 = y + SHRINK, y1 = y + h - SHRINK;
    const z0 = z - hw + SHRINK, z1 = z + hw - SHRINK;
    const n = this.query(x0, z0, x1, z1);
    const b = this.b, q = this.q;
    for (let k = 0; k < n; k++) {
      const o = q[k] * 6;
      if (b[o] < x1 && b[o + 3] > x0 && b[o + 1] < y1 && b[o + 4] > y0 && b[o + 2] < z1 && b[o + 5] > z0) return false;
    }
    return true;
  }

  /** Vrai si la boîte quelconque [min,max] ne touche aucune boîte solide. */
  boxFree(x0, y0, z0, x1, y1, z1) {
    const n = this.query(x0, z0, x1, z1);
    const b = this.b, q = this.q;
    for (let k = 0; k < n; k++) {
      const o = q[k] * 6;
      if (b[o] < x1 && b[o + 3] > x0 && b[o + 1] < y1 && b[o + 4] > y0 && b[o + 2] < z1 && b[o + 5] > z0) return false;
    }
    return true;
  }

  /**
   * Balayage horizontal du gabarit le long d'un axe (0 = X, 2 = Z) sur la distance signée d.
   * Écrit res.pos (nouvelle coordonnée du centre), res.blocked et res.top (sommet de l'obstacle).
   */
  sweepAxis(axis, x, y, z, hw, h, d, res) {
    const o1 = axis === 0 ? 2 : 0;           // l'autre axe horizontal
    const c = axis === 0 ? x : z;            // coordonnée sur l'axe de déplacement
    const oc = axis === 0 ? z : x;           // coordonnée sur l'autre axe
    const y0 = y + SHRINK, y1 = y + h - SHRINK;
    const p0 = oc - hw + SHRINK, p1 = oc + hw - SHRINK;
    const b = this.b, q = this.q;
    let blocked = false, top = -Infinity;
    if (d > 0) {
      const lead = c + hw;
      let limit = lead + d;
      const n = axis === 0 ? this.query(lead - BACKTOL, p0, lead + d, p1) : this.query(p0, lead - BACKTOL, p1, lead + d);
      for (let k = 0; k < n; k++) {
        const o = q[k] * 6;
        if (b[o + 1] >= y1 || b[o + 4] <= y0 || b[o + o1] >= p1 || b[o + o1 + 3] <= p0) continue;
        const face = b[o + axis];
        if (face < lead - BACKTOL) continue;
        const near = face - EPS;
        if (near < limit - 1e-9) { limit = near; top = b[o + 4]; blocked = true; }
        else if (blocked && near <= limit + 1e-9 && b[o + 4] > top) top = b[o + 4];
      }
      res.pos = limit - hw;
    } else {
      const lead = c - hw;
      let limit = lead + d;
      const n = axis === 0 ? this.query(lead + d, p0, lead + BACKTOL, p1) : this.query(p0, lead + d, p1, lead + BACKTOL);
      for (let k = 0; k < n; k++) {
        const o = q[k] * 6;
        if (b[o + 1] >= y1 || b[o + 4] <= y0 || b[o + o1] >= p1 || b[o + o1 + 3] <= p0) continue;
        const face = b[o + axis + 3];
        if (face > lead + BACKTOL) continue;
        const near = face + EPS;
        if (near > limit + 1e-9) { limit = near; top = b[o + 4]; blocked = true; }
        else if (blocked && near >= limit - 1e-9 && b[o + 4] > top) top = b[o + 4];
      }
      res.pos = limit + hw;
    }
    res.blocked = blocked;
    res.top = top;
    return res;
  }

  /** Plus haut sol sous l'empreinte, entre y - dist et y. Renvoie -Infinity si aucun. */
  sweepDown(x, y, z, hw, dist) {
    const x0 = x - hw + SHRINK, x1 = x + hw - SHRINK;
    const z0 = z - hw + SHRINK, z1 = z + hw - SHRINK;
    const n = this.query(x0, z0, x1, z1);
    const b = this.b, q = this.q;
    const lo = y - dist - 1e-9, hi = y + 1e-6;
    let best = -Infinity;
    for (let k = 0; k < n; k++) {
      const o = q[k] * 6;
      if (b[o] >= x1 || b[o + 3] <= x0 || b[o + 2] >= z1 || b[o + 5] <= z0) continue;
      const top = b[o + 4];
      if (top <= hi && top >= lo && top > best) best = top;
    }
    return best;
  }

  /** Plus bas plafond au-dessus de l'empreinte, entre yTop et yTop + dist. Renvoie Infinity si aucun. */
  sweepUp(x, yTop, z, hw, dist) {
    const x0 = x - hw + SHRINK, x1 = x + hw - SHRINK;
    const z0 = z - hw + SHRINK, z1 = z + hw - SHRINK;
    const n = this.query(x0, z0, x1, z1);
    const b = this.b, q = this.q;
    const lo = yTop - 1e-6, hi = yTop + dist + 1e-9;
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      const o = q[k] * 6;
      if (b[o] >= x1 || b[o + 3] <= x0 || b[o + 2] >= z1 || b[o + 5] <= z0) continue;
      const bot = b[o + 1];
      if (bot >= lo && bot <= hi && bot < best) best = bot;
    }
    return best;
  }

  /** Hauteur du sol (sommet de boîte le plus haut) sous le point, ou -Infinity. */
  groundBelow(x, y, z) {
    const n = this.query(x, z, x, z);
    const b = this.b, q = this.q;
    let best = -Infinity;
    for (let k = 0; k < n; k++) {
      const o = q[k] * 6;
      if (x < b[o] || x > b[o + 3] || z < b[o + 2] || z > b[o + 5]) continue;
      const top = b[o + 4];
      if (top <= y + 1e-6 && top > best) best = top;
    }
    return best;
  }

  /**
   * Lancer de rayon contre les boîtes (direction normalisée).
   * @returns {boolean} vrai si touché ; hit.t, hit.box, hit.face sont alors renseignés.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit, skipMask = BF.NOBULLET) {
    let t0 = 0, t1 = maxT;
    // Découpe du rayon par l'emprise de la grille
    if (Math.abs(dx) < 1e-12) { if (ox < this.gx0 || ox > this.gx1) return false; }
    else {
      let ta = (this.gx0 - ox) / dx, tb = (this.gx1 - ox) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    if (Math.abs(dz) < 1e-12) { if (oz < this.gz0 || oz > this.gz1) return false; }
    else {
      let ta = (this.gz0 - oz) / dz, tb = (this.gz1 - oz) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    const cs = this.cs, nx = this.nx, nz = this.nz;
    const px = ox + dx * t0, pz = oz + dz * t0;
    let ix = this._cx(px), iz = this._cz(pz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) < 1e-12 ? Infinity : Math.abs(cs / dx);
    const tDeltaZ = Math.abs(dz) < 1e-12 ? Infinity : Math.abs(cs / dz);
    let tMaxX = Math.abs(dx) < 1e-12 ? Infinity : ((this.gx0 + (ix + (dx > 0 ? 1 : 0)) * cs) - ox) / dx;
    let tMaxZ = Math.abs(dz) < 1e-12 ? Infinity : ((this.gz0 + (iz + (dz > 0 ? 1 : 0)) * cs) - oz) / dz;

    const b = this.b, flags = this.flags, stamp = this.stamp;
    const id = ++this.stampId;
    let best = t1, bestBox = -1, bestFace = 0;
    const idx = dx !== 0 ? 1 / dx : 0, idy = dy !== 0 ? 1 / dy : 0, idz = dz !== 0 ? 1 / dz : 0;

    for (;;) {
      const c = this.cells[iz * nx + ix];
      for (let k = 0; k < c.length; k++) {
        const bi = c[k];
        if (stamp[bi] === id) continue;
        stamp[bi] = id;
        if (flags[bi] & skipMask) continue;
        const o = bi * 6;
        let tmin = -Infinity, tmax = Infinity, face = 0;
        // X
        if (dx === 0) { if (ox <= b[o] || ox >= b[o + 3]) continue; }
        else {
          let ta = (b[o] - ox) * idx, tb = (b[o + 3] - ox) * idx, f = 1;
          if (ta > tb) { const s = ta; ta = tb; tb = s; f = 0; }
          if (ta > tmin) { tmin = ta; face = f; }
          if (tb < tmax) tmax = tb;
          if (tmin > tmax) continue;
        }
        // Y
        if (dy === 0) { if (oy <= b[o + 1] || oy >= b[o + 4]) continue; }
        else {
          let ta = (b[o + 1] - oy) * idy, tb = (b[o + 4] - oy) * idy, f = 3;
          if (ta > tb) { const s = ta; ta = tb; tb = s; f = 2; }
          if (ta > tmin) { tmin = ta; face = f; }
          if (tb < tmax) tmax = tb;
          if (tmin > tmax) continue;
        }
        // Z
        if (dz === 0) { if (oz <= b[o + 2] || oz >= b[o + 5]) continue; }
        else {
          let ta = (b[o + 2] - oz) * idz, tb = (b[o + 5] - oz) * idz, f = 5;
          if (ta > tb) { const s = ta; ta = tb; tb = s; f = 4; }
          if (ta > tmin) { tmin = ta; face = f; }
          if (tb < tmax) tmax = tb;
          if (tmin > tmax) continue;
        }
        if (tmax < 0 || tmin < 0) continue;   // derrière, ou origine à l'intérieur
        if (tmin < best) { best = tmin; bestBox = bi; bestFace = face; }
      }
      const tExit = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (best <= tExit || tExit > t1) break;
      if (tMaxX < tMaxZ) { ix += stepX; if (ix < 0 || ix >= nx) break; tMaxX += tDeltaX; }
      else { iz += stepZ; if (iz < 0 || iz >= nz) break; tMaxZ += tDeltaZ; }
    }
    if (bestBox < 0) return false;
    hit.t = best; hit.box = bestBox; hit.face = bestFace;
    return true;
  }

  /** Vrai si le segment A→B est obstrué par le monde (test de ligne de vue). */
  segmentBlocked(ax, ay, az, bx, by, bz, skipMask = BF.NOBULLET) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    dx /= len; dy /= len; dz /= len;
    return this.raycast(ax, ay, az, dx, dy, dz, len - 0.01, _los, skipMask);
  }
}

const _los = { t: 0, box: -1, face: 0 };

export function makeHit() { return { t: 0, box: -1, face: 0 }; }
