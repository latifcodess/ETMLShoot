// Décalcomanies (sang, impacts de balle, brûlures) : des quadrilatères plaqués sur les faces des boîtes
// du monde, découpés aux bords de la face touchée. Tampon circulaire : les plus anciennes sont recyclées.

import * as THREE from 'three';

export class Decals {
  /**
   * @param max   capacité
   * @param map   atlas (cols × rows)
   * @param opts  {roughness, metalness, lit}
   */
  constructor(max, map, cols, rows, opts = {}) {
    this.max = max;
    this.cols = cols; this.rows = rows;
    this.next = 0;
    this.pos = new Float32Array(max * 12);
    this.uv = new Float32Array(max * 8);
    this.col = new Float32Array(max * 16);
    this.nrm = new Float32Array(max * 12);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const b = i * 4, k = i * 6;
      idx[k] = b; idx[k + 1] = b + 1; idx[k + 2] = b + 2; idx[k + 3] = b; idx[k + 4] = b + 2; idx[k + 5] = b + 3;
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.BufferAttribute(this.uv, 2); this.aUv.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4); this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3); this.aNrm.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('uv', this.aUv);
    g.setAttribute('color', this.aCol); g.setAttribute('normal', this.aNrm);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.material = new THREE.MeshStandardMaterial({
      map, transparent: true, depthWrite: false, vertexColors: true,
      roughness: opts.roughness === undefined ? 0.9 : opts.roughness, metalness: opts.metalness || 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 5;
    this.dirty = false;
  }

  /**
   * Pose (ou remplace, si `slot` est fourni) une décalcomanie.
   * @param world  monde de collision (pour découper sur la face)
   * @param box    indice de la boîte touchée ; face : code de face (0..5)
   * @param x,y,z  point d'impact
   * @param size   côté du carré (m)
   * @param cell   cellule de l'atlas ; variant : 0..7 (rotations par quarts de tour / miroir)
   * @returns indice de la décalcomanie, ou -1 si rien n'a été posé
   */
  add(world, box, face, x, y, z, size, cell, variant, r, g, b, a, slot = -1) {
    const axis = face >> 1, sign = (face & 1) ? -1 : 1;
    const ua = axis === 0 ? 2 : 0, va = axis === 1 ? 2 : 1;
    const o = box * 6;
    const bb = world.b;
    const P = [x, y, z];
    const half = size / 2;
    let u0 = P[ua] - half, u1 = P[ua] + half, v0 = P[va] - half, v1 = P[va] + half;
    // découpe au rectangle de la face
    const fu0 = bb[o + ua], fu1 = bb[o + ua + 3], fv0 = bb[o + va], fv1 = bb[o + va + 3];
    const cu0 = Math.max(u0, fu0), cu1 = Math.min(u1, fu1), cv0 = Math.max(v0, fv0), cv1 = Math.min(v1, fv1);
    if (cu1 - cu0 < size * 0.12 || cv1 - cv0 < size * 0.12) return -1;
    const i = slot >= 0 ? slot : this.next;
    if (slot < 0) this.next = (this.next + 1) % this.max;
    const coord = (sign > 0 ? bb[o + axis + 3] : bb[o + axis]) + sign * 0.004;
    const p = this.pos, k = i * 12;
    const us = [cu0, cu1, cu1, cu0], vs = [cv0, cv0, cv1, cv1];
    const cw = 1 / this.cols, ch = 1 / this.rows;
    const cx = (cell % this.cols) * cw, cy = 1 - (Math.floor(cell / this.cols) + 1) * ch;
    for (let c = 0; c < 4; c++) {
      const q = k + c * 3;
      p[q + axis] = coord; p[q + ua] = us[c]; p[q + va] = vs[c];
      this.nrm[q] = 0; this.nrm[q + 1] = 0; this.nrm[q + 2] = 0; this.nrm[q + axis] = sign;
      // coordonnées dans le carré non découpé, puis variante d'orientation
      let su = (us[c] - u0) / size, sv = (vs[c] - v0) / size;
      if (variant & 1) su = 1 - su;
      if (variant & 2) sv = 1 - sv;
      if (variant & 4) { const t = su; su = sv; sv = t; }
      this.uv[i * 8 + c * 2] = cx + su * cw;
      this.uv[i * 8 + c * 2 + 1] = cy + sv * ch;
      const cc = i * 16 + c * 4;
      this.col[cc] = r; this.col[cc + 1] = g; this.col[cc + 2] = b; this.col[cc + 3] = a;
    }
    // l'ordre des sommets doit rester face à la normale (cf. worldmesh : U×V = -X, -Y, +Z)
    const flip = axis === 2 ? sign < 0 : sign > 0;
    if (flip) {
      for (const arr of [[p, 3, k], [this.uv, 2, i * 8], [this.col, 4, i * 16]]) {
        const [d, n, base] = arr;
        for (let e = 0; e < n; e++) { const t = d[base + n + e]; d[base + n + e] = d[base + 3 * n + e]; d[base + 3 * n + e] = t; }
      }
    }
    this.dirty = true;
    return i;
  }

  /** Change l'opacité d'une décalcomanie existante. */
  setAlpha(i, a) {
    for (let c = 0; c < 4; c++) this.col[i * 16 + c * 4 + 3] = a;
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.aPos.needsUpdate = true; this.aUv.needsUpdate = true; this.aCol.needsUpdate = true; this.aNrm.needsUpdate = true;
  }

  clear() {
    this.pos.fill(0); this.col.fill(0);
    this.next = 0;
    this.dirty = true;
  }
}
