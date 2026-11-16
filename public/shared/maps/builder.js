// Petit langage de construction de cartes : tout est une boîte alignée sur les axes.
// Le même résultat sert au rendu (client), aux collisions (client + serveur) et à la navigation de l'IA.
//
// Repère : X vers l'est, Y vers le haut, Z vers le sud. Lacet 0 = regard vers -Z (nord).

import { MAT, BF } from '../constants.js';

export const DIR = { PX: 0, NX: 1, PZ: 2, NZ: 3 };

export class MapBuilder {
  constructor(id, name, bounds) {
    this.id = id;
    this.name = name;
    this.bounds = bounds;            // zone jouable {minX,minZ,maxX,maxZ}
    this.boxes = [];
    this.spawns = { ffa: [], alpha: [], bravo: [], coop: [], enemy: [] };
    this.pickups = [];
    this.barrels = [];
    this.lights = [];
    this.env = {};
  }

  /** Boîte brute. opts : {flags, color} */
  box(x0, y0, z0, x1, y1, z1, mat, opts) {
    const b = {
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      mat,
      flags: (opts && opts.flags) | 0,
      color: (opts && opts.color) | 0,
    };
    this.boxes.push(b);
    return b;
  }
  /** Boîte purement décorative (ni collision ni balles). */
  deco(x0, y0, z0, x1, y1, z1, mat, opts) {
    return this.box(x0, y0, z0, x1, y1, z1, mat, { ...opts, flags: ((opts && opts.flags) | 0) | BF.NOCOLLIDE });
  }
  /** Mur invisible : bloque les joueurs, laisse passer les balles. */
  clip(x0, y0, z0, x1, y1, z1) {
    return this.box(x0, y0, z0, x1, y1, z1, MAT.CONCRETE, { flags: BF.INVISIBLE | BF.NOBULLET | BF.NOSHADOW | BF.NONAV });
  }
  /** Bloc posé, centré en (cx, cz), de dimensions w (X) × h × d (Z). */
  block(cx, cz, w, d, h, mat, y = 0, opts) {
    return this.box(cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2, mat, opts);
  }

  /**
   * Mur le long de X, centré sur z. openings : [{a, b, lo, hi}] en coordonnées X absolues,
   * hauteurs relatives à la base du mur (porte : lo = 0).
   */
  wallX(x0, x1, z, h, t, mat, openings, y = 0, opts) {
    this._wall(0, x0, x1, z, h, t, mat, openings, y, opts);
  }
  /** Mur le long de Z, centré sur x. */
  wallZ(z0, z1, x, h, t, mat, openings, y = 0, opts) {
    this._wall(2, z0, z1, x, h, t, mat, openings, y, opts);
  }
  _wall(axis, a0, a1, c, h, t, mat, openings, y, opts) {
    const put = (s0, s1, lo, hi) => {
      if (s1 - s0 < 1e-4 || hi - lo < 1e-4) return;
      if (axis === 0) this.box(s0, y + lo, c - t / 2, s1, y + hi, c + t / 2, mat, opts);
      else this.box(c - t / 2, y + lo, s0, c + t / 2, y + hi, s1, mat, opts);
    };
    const ops = (openings || []).slice().sort((p, q) => p.a - q.a);
    let cur = a0;
    for (const o of ops) {
      const oa = Math.max(a0, o.a), ob = Math.min(a1, o.b);
      put(cur, oa, 0, h);
      const lo = o.lo || 0, hi = o.hi === undefined ? h : Math.min(h, o.hi);
      put(oa, ob, 0, lo);
      put(oa, ob, hi, h);
      cur = ob;
    }
    put(cur, a1, 0, h);
  }

  /**
   * Pièce rectangulaire. walls : {n,s,e,w} = listes d'ouvertures (ou false pour omettre le mur).
   * n = côté -Z, s = côté +Z, w = côté -X, e = côté +X.
   */
  room(x0, z0, x1, z1, y, h, t, mat, walls = {}, opts) {
    if (walls.n !== false) this.wallX(x0, x1, z0 + t / 2, h, t, mat, walls.n, y, opts);
    if (walls.s !== false) this.wallX(x0, x1, z1 - t / 2, h, t, mat, walls.s, y, opts);
    if (walls.w !== false) this.wallZ(z0 + t, z1 - t, x0 + t / 2, h, t, mat, walls.w, y, opts);
    if (walls.e !== false) this.wallZ(z0 + t, z1 - t, x1 - t / 2, h, t, mat, walls.e, y, opts);
  }

  /**
   * Escalier. (x, z) = milieu de l'arête d'entrée en bas ; dir = sens de montée.
   * open = marches flottantes (on peut passer dessous).
   */
  stairs(x, y, z, dir, n, rise, run, width, mat, open = false, opts) {
    const hw = width / 2;
    for (let i = 0; i < n; i++) {
      const top = y + (i + 1) * rise;
      const bot = open ? top - Math.min(rise, 0.14) : y;
      const a = i * run, b = (i + 1) * run;
      if (dir === DIR.PX) this.box(x + a, bot, z - hw, x + b, top, z + hw, mat, opts);
      else if (dir === DIR.NX) this.box(x - b, bot, z - hw, x - a, top, z + hw, mat, opts);
      else if (dir === DIR.PZ) this.box(x - hw, bot, z + a, x + hw, top, z + b, mat, opts);
      else this.box(x - hw, bot, z - b, x + hw, top, z - a, mat, opts);
    }
  }

  /**
   * Conteneur maritime. len = 12 (40 pieds) ou 6 (20 pieds).
   * open : traversable (extrémités ouvertes).
   */
  container(cx, cz, alongX, color, y = 0, open = false, len = 12) {
    const W = 2.44, H = 2.6;
    const hx = alongX ? len / 2 : W / 2, hz = alongX ? W / 2 : len / 2;
    const o = { color };
    if (!open) {
      this.box(cx - hx, y, cz - hz, cx + hx, y + H, cz + hz, MAT.CONTAINER, o);
      return;
    }
    const t = 0.1;
    this.box(cx - hx, y, cz - hz, cx + hx, y + 0.14, cz + hz, MAT.WOOD);               // plancher
    this.box(cx - hx, y + H - t, cz - hz, cx + hx, y + H, cz + hz, MAT.CONTAINER, o);  // toit
    if (alongX) {
      this.box(cx - hx, y + 0.14, cz - hz, cx + hx, y + H - t, cz - hz + t, MAT.CONTAINER, o);
      this.box(cx - hx, y + 0.14, cz + hz - t, cx + hx, y + H - t, cz + hz, MAT.CONTAINER, o);
    } else {
      this.box(cx - hx, y + 0.14, cz - hz, cx - hx + t, y + H - t, cz + hz, MAT.CONTAINER, o);
      this.box(cx + hx - t, y + 0.14, cz - hz, cx + hx, y + H - t, cz + hz, MAT.CONTAINER, o);
    }
  }

  crate(cx, cz, s = 1, y = 0, mat = MAT.WOOD, color = 0) {
    return this.block(cx, cz, s, s, s, mat, y, color ? { color } : undefined);
  }

  /** Mur de sacs de sable entre deux points alignés. */
  sandbags(x0, z0, x1, z1, h = 1.05, t = 0.6, y = 0) {
    if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) this.box(x0, y, z0 - t / 2, x1, y + h, z0 + t / 2, MAT.SANDBAG);
    else this.box(x0 - t / 2, y, z0, x0 + t / 2, y + h, z1, MAT.SANDBAG);
  }

  /** Séparateur en béton type « Jersey ». */
  jersey(cx, cz, alongX, len = 3) {
    if (alongX) {
      this.box(cx - len / 2, 0, cz - 0.3, cx + len / 2, 0.45, cz + 0.3, MAT.CONCRETE);
      this.box(cx - len / 2, 0.45, cz - 0.16, cx + len / 2, 1.0, cz + 0.16, MAT.CONCRETE);
    } else {
      this.box(cx - 0.3, 0, cz - len / 2, cx + 0.3, 0.45, cz + len / 2, MAT.CONCRETE);
      this.box(cx - 0.16, 0.45, cz - len / 2, cx + 0.16, 1.0, cz + len / 2, MAT.CONCRETE);
    }
  }

  /** Gabion (bastion de terre) entre deux points alignés. */
  hesco(x0, z0, x1, z1, h = 2.2, t = 1.4, y = 0) {
    if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) this.box(x0, y, z0 - t / 2, x1, y + h, z0 + t / 2, MAT.HESCO);
    else this.box(x0 - t / 2, y, z0, x0 + t / 2, y + h, z1, MAT.HESCO);
  }

  /** Camion (cabine + plateau bâché). (cx, cz) = centre ; l'avant pointe vers +axe si fwd > 0. */
  truck(cx, cz, alongX, color = 0x4a5238, fwd = 1) {
    const L = (a0, a1, y0, y1, hw, mat, opts) => {
      const p0 = Math.min(a0 * fwd, a1 * fwd), p1 = Math.max(a0 * fwd, a1 * fwd);
      if (alongX) this.box(cx + p0, y0, cz - hw, cx + p1, y1, cz + hw, mat, opts);
      else this.box(cx - hw, y0, cz + p0, cx + hw, y1, cz + p1, mat, opts);
    };
    L(1.6, 3.7, 0.55, 2.55, 1.2, MAT.PAINT, { color });                 // cabine
    L(3.7, 4.0, 0.55, 1.5, 1.15, MAT.DARKMETAL);                        // capot / pare-chocs
    L(1.75, 3.0, 1.55, 2.3, 1.22, MAT.LAMP, { color: 0x1a2630, flags: BF.NOCOLLIDE }); // vitres
    L(-3.8, 1.5, 0.75, 1.1, 1.25, MAT.DARKMETAL);                       // châssis / plateau
    L(-3.8, 1.5, 1.1, 2.9, 1.25, MAT.TARP, { color: 0x56603f });        // bâche
    for (const a of [2.7, -1.2, -2.7]) {                                // roues
      for (const side of [-1, 1]) {
        const w0 = side * 0.82, w1 = side * 1.3;
        const p0 = (a - 0.5) * fwd, p1 = (a + 0.5) * fwd;
        const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
        if (alongX) this.box(cx + lo, 0, cz + Math.min(w0, w1), cx + hi, 1.0, cz + Math.max(w0, w1), MAT.RUBBER);
        else this.box(cx + Math.min(w0, w1), 0, cz + lo, cx + Math.max(w0, w1), 1.0, cz + hi, MAT.RUBBER);
      }
    }
  }

  /** Véhicule léger (4x4 / voiture). */
  car(cx, cz, alongX, color = 0x6b6f72, fwd = 1) {
    const L = (a0, a1, y0, y1, hw, mat, opts) => {
      const p0 = Math.min(a0 * fwd, a1 * fwd), p1 = Math.max(a0 * fwd, a1 * fwd);
      if (alongX) this.box(cx + p0, y0, cz - hw, cx + p1, y1, cz + hw, mat, opts);
      else this.box(cx - hw, y0, cz + p0, cx + hw, y1, cz + p1, mat, opts);
    };
    L(-2.3, 2.3, 0.4, 1.05, 0.95, MAT.PAINT, { color });                // caisse
    L(-1.5, 0.7, 1.05, 1.65, 0.88, MAT.PAINT, { color });               // habitacle
    L(-1.4, 0.6, 1.12, 1.56, 0.9, MAT.LAMP, { color: 0x18222b, flags: BF.NOCOLLIDE });
    for (const a of [1.45, -1.45]) {
      for (const side of [-1, 1]) {
        const w0 = side * 0.72, w1 = side * 1.0;
        const lo = Math.min((a - 0.38) * fwd, (a + 0.38) * fwd), hi = Math.max((a - 0.38) * fwd, (a + 0.38) * fwd);
        if (alongX) this.box(cx + lo, 0, cz + Math.min(w0, w1), cx + hi, 0.76, cz + Math.max(w0, w1), MAT.RUBBER);
        else this.box(cx + Math.min(w0, w1), 0, cz + lo, cx + Math.max(w0, w1), 0.76, cz + hi, MAT.RUBBER);
      }
    }
  }

  /**
   * Mirador : plateforme carrée à la hauteur h, parapet, toit, escalier arrivant du côté `dir`
   * (l'escalier monte dans le sens `dir` et débouche sur la plateforme).
   */
  tower(cx, cz, h, dir, mat = MAT.WOOD) {
    const P = 2.2;                    // demi-côté de la plateforme
    const leg = 0.22;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.box(cx + sx * (P - leg) - leg / 2, 0, cz + sz * (P - leg) - leg / 2,
        cx + sx * (P - leg) + leg / 2, h + 3.0, cz + sz * (P - leg) + leg / 2, MAT.DARKMETAL);
    }
    this.box(cx - P, h - 0.2, cz - P, cx + P, h, cz + P, mat);                     // plancher
    this.box(cx - P - 0.3, h + 3.0, cz - P - 0.3, cx + P + 0.3, h + 3.15, cz + P + 0.3, MAT.ROOF); // toit
    const ph = 1.05, t = 0.25;
    // parapets (ouverture de 1,6 m du côté de l'escalier)
    const gap = 0.9;
    const side = (d) => {
      const open = d === dir;
      if (d === DIR.PX || d === DIR.NX) {
        // l'escalier monte selon ±X : il arrive par le côté opposé au sens de montée
        const x = d === DIR.PX ? cx - P + t / 2 : cx + P - t / 2;
        if (open) {
          this.box(x - t / 2, h, cz - P, x + t / 2, h + ph, cz - gap, MAT.SANDBAG);
          this.box(x - t / 2, h, cz + gap, x + t / 2, h + ph, cz + P, MAT.SANDBAG);
        } else this.box(x - t / 2, h, cz - P, x + t / 2, h + ph, cz + P, MAT.SANDBAG);
      } else {
        const z = d === DIR.PZ ? cz - P + t / 2 : cz + P - t / 2;
        if (open) {
          this.box(cx - P, h, z - t / 2, cx - gap, h + ph, z + t / 2, MAT.SANDBAG);
          this.box(cx + gap, h, z - t / 2, cx + P, h + ph, z + t / 2, MAT.SANDBAG);
        } else this.box(cx - P, h, z - t / 2, cx + P, h + ph, z + t / 2, MAT.SANDBAG);
      }
    };
    for (const d of [DIR.PX, DIR.NX, DIR.PZ, DIR.NZ]) side(d);
    // escalier ouvert
    const rise = 0.25, run = 0.32;
    const n = Math.round(h / rise);
    const len = n * run;
    if (dir === DIR.PX) this.stairs(cx - P - len, 0, cz, DIR.PX, n, h / n, run, 1.5, MAT.DARKMETAL, true);
    else if (dir === DIR.NX) this.stairs(cx + P + len, 0, cz, DIR.NX, n, h / n, run, 1.5, MAT.DARKMETAL, true);
    else if (dir === DIR.PZ) this.stairs(cx, 0, cz - P - len, DIR.PZ, n, h / n, run, 1.5, MAT.DARKMETAL, true);
    else this.stairs(cx, 0, cz + P + len, DIR.NZ, n, h / n, run, 1.5, MAT.DARKMETAL, true);
  }

  /** Lampadaire avec source lumineuse. */
  lamp(x, z, h = 6, color = 0xffd9a0, intensity = 1) {
    this.box(x - 0.09, 0, z - 0.09, x + 0.09, h, z + 0.09, MAT.DARKMETAL, { flags: BF.NOSHADOW });
    this.deco(x - 0.35, h, z - 0.18, x + 0.35, h + 0.14, z + 0.18, MAT.LAMP, { color, flags: BF.EMISSIVE | BF.NOSHADOW });
    this.lights.push({ x, y: h - 0.1, z, color, intensity, range: 16 });
  }

  spawn(type, x, z, y = 0, yaw = 0) { this.spawns[type].push({ x, y, z, yaw }); }
  pickup(type, x, z, y = 0) { this.pickups.push({ type, x, y, z }); }
  barrel(x, z, y = 0) { this.barrels.push({ x, y, z }); }

  build() {
    return {
      id: this.id,
      name: this.name,
      bounds: this.bounds,
      boxes: this.boxes,
      spawns: this.spawns,
      pickups: this.pickups,
      barrels: this.barrels,
      lights: this.lights,
      env: this.env,
    };
  }
}
