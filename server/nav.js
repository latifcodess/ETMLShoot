// Navigation de l'IA : graphe généré automatiquement à partir des boîtes de la carte.
//
// La carte est échantillonnée sur une grille de 0,5 m. Dans chaque colonne, chaque sommet de boîte
// où le gabarit d'un personnage tient debout devient un nœud : le graphe gère donc naturellement
// les étages, les escaliers, les toits. Les arêtes relient les nœuds voisins franchissables à pied
// (dénivelé <= une marche) ; des arêtes à sens unique modélisent les sauts vers le bas.

import { BF } from '../public/shared/constants.js';

const CS = 0.5;          // taille de cellule
const NAV_HW = 0.4;      // demi-largeur du gabarit de navigation (un peu plus large que le vrai)
const NAV_H = 1.8;
const STEP = 0.6;        // dénivelé franchissable à pied
const MAX_DROP = 4.5;    // chute acceptée sans dégâts

class Heap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k = new Float32Array(this.k.length * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v;
    const top = V[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return top;
  }
}

export class Nav {
  constructor(world, map) {
    this.world = world;
    const b = map.bounds;
    this.x0 = b.minX; this.z0 = b.minZ;
    this.nx = Math.ceil((b.maxX - b.minX) / CS);
    this.nz = Math.ceil((b.maxZ - b.minZ) / CS);
    this._build(map);
  }

  _build(map) {
    const w = this.world, nx = this.nx, nz = this.nz;
    const colStart = new Int32Array(nx * nz + 1);
    const xs = [], ys = [], zs = [];
    const cand = [];
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const cx = this.x0 + (ix + 0.5) * CS, cz = this.z0 + (iz + 0.5) * CS;
        colStart[iz * nx + ix] = xs.length;
        cand.length = 0;
        const n = w.query(cx - NAV_HW, cz - NAV_HW, cx + NAV_HW, cz + NAV_HW);
        for (let k = 0; k < n; k++) {
          const bi = w.q[k], o = bi * 6;
          if (w.flags[bi] & BF.NONAV) continue;
          if (w.b[o] >= cx + NAV_HW || w.b[o + 3] <= cx - NAV_HW || w.b[o + 2] >= cz + NAV_HW || w.b[o + 5] <= cz - NAV_HW) continue;
          const top = w.b[o + 4];
          if (top < -0.5 || top > 40) continue;
          cand.push(top);
        }
        cand.sort((p, q) => p - q);
        let last = -Infinity;
        for (let k = 0; k < cand.length; k++) {
          const y = cand[k];
          if (y - last < 0.02) continue;
          if (!w.hullFree(cx, y, cz, NAV_HW, NAV_H)) continue;
          last = y;
          xs.push(cx); ys.push(y); zs.push(cz);
        }
      }
    }
    colStart[nx * nz] = xs.length;
    const N = xs.length;
    this.count = N;
    this.colStart = colStart;
    this.px = Float32Array.from(xs); this.py = Float32Array.from(ys); this.pz = Float32Array.from(zs);

    // --- Arêtes
    const from = [], to = [], cost = [];
    const nodeInCol = (ix, iz, y, tol) => {
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return -1;
      const c = iz * nx + ix;
      for (let k = colStart[c]; k < colStart[c + 1]; k++) if (Math.abs(this.py[k] - y) <= tol) return k;
      return -1;
    };
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const c = iz * nx + ix;
        for (let a = colStart[c]; a < colStart[c + 1]; a++) {
          const ax = this.px[a], ay = this.py[a], az = this.pz[a];
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dz === 0) continue;
              const jx = ix + dx, jz = iz + dz;
              if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
              const c2 = jz * nx + jx;
              const diag = dx !== 0 && dz !== 0;
              let walked = false;
              for (let bN = colStart[c2]; bN < colStart[c2 + 1]; bN++) {
                const dy = this.py[bN] - ay;
                if (Math.abs(dy) > STEP) continue;
                const top = Math.max(ay, this.py[bN]);
                if (!w.hullFree((ax + this.px[bN]) / 2, top, (az + this.pz[bN]) / 2, NAV_HW, NAV_H)) continue;
                if (diag && (nodeInCol(ix + dx, iz, ay, STEP) < 0 || nodeInCol(ix, iz + dz, ay, STEP) < 0)) continue;
                from.push(a); to.push(bN);
                cost.push((diag ? 0.7071 : 0.5) + Math.abs(dy) * 0.6);
                walked = true;
              }
              if (walked || diag) continue;
              // saut vers le bas : le plus haut nœud en contrebas de la colonne voisine
              let best = -1;
              for (let bN = colStart[c2]; bN < colStart[c2 + 1]; bN++) {
                const dy = this.py[bN] - ay;
                if (dy < -STEP && dy >= -MAX_DROP && (best < 0 || this.py[bN] > this.py[best])) best = bN;
              }
              if (best < 0) continue;
              const bx = this.px[best], by = this.py[best], bz = this.pz[best];
              if (!w.hullFree((ax + bx) / 2, ay, (az + bz) / 2, NAV_HW, NAV_H)) continue;
              if (!w.boxFree(bx - NAV_HW, by + 0.02, bz - NAV_HW, bx + NAV_HW, ay + NAV_H - 0.02, bz + NAV_HW)) continue;
              from.push(a); to.push(best);
              cost.push(0.5 + 0.8 + (ay - by) * 0.35);
            }
          }
        }
      }
    }
    const E = from.length;
    // CSR direct (les arêtes sont déjà triées par nœud d'origine)
    this.eStart = new Int32Array(N + 1);
    this.eTo = Int32Array.from(to);
    this.eCost = Float32Array.from(cost);
    for (let e = 0; e < E; e++) this.eStart[from[e] + 1]++;
    for (let i = 0; i < N; i++) this.eStart[i + 1] += this.eStart[i];
    // CSR inverse
    this.rStart = new Int32Array(N + 1);
    for (let e = 0; e < E; e++) this.rStart[to[e] + 1]++;
    for (let i = 0; i < N; i++) this.rStart[i + 1] += this.rStart[i];
    this.rTo = new Int32Array(E);
    this.rCost = new Float32Array(E);
    const fill = this.rStart.slice(0, N);
    for (let e = 0; e < E; e++) {
      const k = fill[to[e]]++;
      this.rTo[k] = from[e]; this.rCost[k] = cost[e];
    }

    // --- Accessibilité depuis les points d'apparition
    this.reach = new Uint8Array(N);
    const stack = [];
    const seed = (p) => {
      const n = this._rawNodeAt(p.x, p.y, p.z);
      if (n >= 0 && !this.reach[n]) { this.reach[n] = 1; stack.push(n); }
    };
    for (const key of Object.keys(map.spawns)) for (const p of map.spawns[key]) seed(p);
    while (stack.length) {
      const a = stack.pop();
      for (let e = this.eStart[a]; e < this.eStart[a + 1]; e++) {
        const t = this.eTo[e];
        if (!this.reach[t]) { this.reach[t] = 1; stack.push(t); }
      }
    }
    const list = [];
    for (let i = 0; i < N; i++) if (this.reach[i]) list.push(i);
    this.reachable = Int32Array.from(list);

    // structures de recherche
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.mark = new Int32Array(N);
    this.closed = new Int32Array(N);
    this.markId = 0;
    this.heap = new Heap(4096);
  }

  _rawNodeAt(x, y, z) {
    const ix = Math.floor((x - this.x0) / CS), iz = Math.floor((z - this.z0) / CS);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    const c = iz * this.nx + ix;
    let best = -1, bd = Infinity;
    for (let k = this.colStart[c]; k < this.colStart[c + 1]; k++) {
      const d = Math.abs(this.py[k] - y);
      if (d < bd) { bd = d; best = k; }
    }
    return bd <= 1.2 ? best : -1;
  }

  /** Nœud accessible le plus proche de la position (ou -1). */
  nodeAt(x, y, z) {
    const ix = Math.floor((x - this.x0) / CS), iz = Math.floor((z - this.z0) / CS);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 5; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
          const c = jz * this.nx + jx;
          for (let k = this.colStart[c]; k < this.colStart[c + 1]; k++) {
            if (!this.reach[k]) continue;
            const ddx = this.px[k] - x, ddy = (this.py[k] - y) * 2.2, ddz = this.pz[k] - z;
            const d = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d < bd) { bd = d; best = k; }
          }
        }
      }
      if (best >= 0 && r >= 1 && bd < (r * CS) * (r * CS)) break;
    }
    return best;
  }

  randomNode(rng = Math.random) {
    return this.reachable[Math.floor(rng() * this.reachable.length)];
  }

  /** Vrai s'il existe une arête a → b. */
  hasEdge(a, b) {
    for (let e = this.eStart[a]; e < this.eStart[a + 1]; e++) if (this.eTo[e] === b) return true;
    return false;
  }

  /** Ligne droite praticable entre deux nœuds (pour lisser les chemins). */
  lineWalkable(a, b) {
    const ax = this.px[a], az = this.pz[a], bx = this.px[b], bz = this.pz[b];
    if (Math.abs(this.py[a] - this.py[b]) > 1.2) return false;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(len / 0.25);
    let cur = a;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const ix = Math.floor((x - this.x0) / CS), iz = Math.floor((z - this.z0) / CS);
      const c = iz * this.nx + ix;
      let nxt = -1;
      for (let k = this.colStart[c]; k < this.colStart[c + 1]; k++) {
        if (Math.abs(this.py[k] - this.py[cur]) <= 0.3) { nxt = k; break; }
      }
      if (nxt < 0) return false;
      if (nxt !== cur) {
        if (!this.hasEdge(cur, nxt) || !this.hasEdge(nxt, cur)) return false;
        cur = nxt;
      }
    }
    return cur === b;
  }

  /**
   * A*. Renvoie la liste (lissée) des nœuds de `from` à `to`, ou null.
   */
  findPath(from, to, maxExpand = 60000) {
    if (from < 0 || to < 0) return null;
    if (from === to) return [to];
    const id = ++this.markId;
    const g = this.g, parent = this.parent, mark = this.mark, heap = this.heap;
    const tx = this.px[to], ty = this.py[to], tz = this.pz[to];
    heap.clear();
    g[from] = 0; parent[from] = -1; mark[from] = id;
    heap.push(0, from);
    let expanded = 0, found = false;
    const closed = this.closed;
    while (heap.n > 0) {
      const a = heap.pop();
      if (a === to) { found = true; break; }
      if (closed[a] === id) continue;       // entrée périmée du tas
      closed[a] = id;
      if (++expanded > maxExpand) break;
      const ga = g[a];
      for (let e = this.eStart[a]; e < this.eStart[a + 1]; e++) {
        const b = this.eTo[e];
        if (closed[b] === id) continue;
        const ng = ga + this.eCost[e];
        if (mark[b] === id && g[b] <= ng) continue;
        mark[b] = id; g[b] = ng; parent[b] = a;
        const h = Math.hypot(this.px[b] - tx, (this.py[b] - ty) * 1.5, this.pz[b] - tz);
        heap.push(ng + h, b);
      }
    }
    if (!found) return null;
    const raw = [];
    for (let n = to; n >= 0; n = parent[n]) raw.push(n);
    raw.reverse();
    // lissage : on saute les nœuds intermédiaires quand la ligne droite est praticable
    const out = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = Math.min(raw.length - 1, i + 14);
      while (j > i + 1 && !this.lineWalkable(raw[i], raw[j])) j--;
      out.push(raw[j]);
      i = j;
    }
    return out;
  }

  /**
   * Champ de distance vers un nœud cible (Dijkstra sur le graphe inverse).
   * Permet à toute une horde de converger vers une cible pour le prix d'un seul parcours.
   */
  distanceField(target, out) {
    const N = this.count;
    const dist = out && out.length === N ? out : new Float32Array(N);
    dist.fill(Infinity);
    if (target < 0) return dist;
    const heap = this.heap;
    heap.clear();
    dist[target] = 0;
    heap.push(0, target);
    while (heap.n > 0) {
      const key = heap.k[0];
      const a = heap.pop();
      if (key > dist[a] + 1e-4) continue;
      for (let e = this.rStart[a]; e < this.rStart[a + 1]; e++) {
        const b = this.rTo[e];
        const nd = dist[a] + this.rCost[e];
        if (nd < dist[b]) { dist[b] = nd; heap.push(nd, b); }
      }
    }
    return dist;
  }

  /** Meilleur voisin pour descendre le champ de distance depuis `node` (ou -1 si arrivé / bloqué). */
  descend(field, node) {
    const here = field[node];
    let best = -1, bd = Infinity;
    for (let e = this.eStart[node]; e < this.eStart[node + 1]; e++) {
      const b = this.eTo[e];
      if (!(field[b] < here - 1e-6)) continue;
      const d = field[b] + this.eCost[e];
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
}

export const NAV_CELL = CS;
