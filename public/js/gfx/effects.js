// Effets visuels : impacts, sang, traceurs, flashs, explosions, morceaux de chair, mares de sang.
// Le niveau de « gore » (0 = sans sang, 1 = normal, 2 = extrême) module la quantité et la persistance.

import * as THREE from 'three';
import { Particles } from './particles.js';
import { Decals } from './decals.js';
import { sharedAtlas } from './textures.js';
import { SURF, FACE_NORMALS } from '../../shared/constants.js';
import { makeHit } from '../../shared/world.js';

const C = { SOFT: 0, SMOKE: 1, SPARK: 2, FLASH: 3, BLOOD: 4, BLOOD2: 5, CHIP: 6, RING: 7, FIRE: 8, SHELL: 9, STREAK: 10, MEAT: 11 };
const rnd = (a, b) => a + Math.random() * (b - a);
const _hit = makeHit();
const _dummy = new THREE.Object3D();

export class Effects {
  constructor(scene, world, env, quality, gore) {
    this.scene = scene;
    this.world = world;
    this.gore = gore;
    this.quality = quality;
    const atlas = sharedAtlas('particles');
    const scale = quality === 'low' ? 0.5 : 1;
    this.alpha = new Particles(Math.round(3600 * scale), false, atlas);
    this.add = new Particles(Math.round(1800 * scale), true, atlas);
    this.blood = new Decals(Math.round(720 * scale), sharedAtlas('blood'), 4, 2, { roughness: 0.25 });
    this.marks = new Decals(Math.round(360 * scale), sharedAtlas('impacts'), 2, 2, { roughness: 0.95 });
    const fog = new THREE.Color().setHex(env.fogColor, THREE.SRGBColorSpace);
    this.alpha.setFog(fog, env.fogDensity);
    this.add.setFog(fog, env.fogDensity);
    // teinte ambiante appliquée aux particules non lumineuses (fumée, poussière, sang)
    const sun = new THREE.Color().setHex(env.sunColor, THREE.SRGBColorSpace);
    const sky = new THREE.Color().setHex(env.hemiSky, THREE.SRGBColorSpace);
    this.amb = sun.multiplyScalar(0.45).add(sky.multiplyScalar(0.55));
    scene.add(this.blood.mesh, this.marks.mesh, this.alpha.mesh, this.add.mesh);

    // gouttes de sang qui touchent le sol → petites taches
    this.alpha.onLand = (x, y, z, tag, size) => {
      if (tag !== 1 || Math.random() > 0.6) return;
      if (this.world.raycast(x, y + 0.3, z, 0, -1, 0, 0.6, _hit)) {
        this.blood.add(this.world, _hit.box, _hit.face, x, y, z, size * rnd(3, 7), Math.floor(Math.random() * 6), Math.floor(Math.random() * 8), 1, 1, 1, rnd(0.75, 0.95));
      }
    };

    // lumières dynamiques (flashs, explosions) : nombre fixe pour ne jamais recompiler les matériaux
    this.lights = [];
    const nLights = quality === 'low' ? 0 : quality === 'medium' ? 2 : 4;
    for (let i = 0; i < nLights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 1.6);
      l.userData = { t: 0, dur: 0, peak: 0 };
      scene.add(l);
      this.lights.push(l);
    }

    // morceaux de chair (instanciés)
    this.maxGibs = quality === 'low' ? 24 : 56;
    const geo = new THREE.DodecahedronGeometry(0.09, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * rnd(0.7, 1.4), pos.getY(i) * rnd(0.5, 1.1), pos.getZ(i) * rnd(0.7, 1.5));
    geo.computeVertexNormals();
    this.gibMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.3, metalness: 0.05 }), this.maxGibs);
    this.gibMesh.castShadow = true;
    this.gibMesh.frustumCulled = false;
    this.gibMesh.count = 0;
    scene.add(this.gibMesh);
    this.gibs = [];
    this.pools = [];
    this.time = 0;
  }

  setGore(g) { this.gore = g; }

  // -------------------------------------------------------------------------------------------
  flashLight(x, y, z, hex, intensity, dur) {
    if (!this.lights.length) return;
    let best = this.lights[0];
    for (const l of this.lights) if (l.userData.t >= l.userData.dur) { best = l; break; } else if (l.userData.dur - l.userData.t < best.userData.dur - best.userData.t) best = l;
    best.position.set(x, y, z);
    best.color.setHex(hex, THREE.SRGBColorSpace);
    best.userData.t = 0; best.userData.dur = dur; best.userData.peak = intensity;
    best.intensity = intensity;
  }

  /** Flash de bouche vu de l'extérieur. */
  muzzle(x, y, z, dx, dy, dz, power = 1) {
    this.add.spawn({ x: x + dx * 0.12, y: y + dy * 0.12, z: z + dz * 0.12, life: 0.055, size: 0.42 * power, size1: 0.6 * power, r: 3.2, g: 2.2, b: 1.0, a: 1, cell: C.FLASH });
    this.add.spawn({ x: x + dx * 0.3, y: y + dy * 0.3, z: z + dz * 0.3, life: 0.04, size: 0.22 * power, r: 3, g: 2.4, b: 1.4, a: 1, cell: C.SOFT });
    if (Math.random() < 0.6) {
      this.alpha.spawn({
        x: x + dx * 0.25, y: y + dy * 0.25, z: z + dz * 0.25, vx: dx * 1.5 + rnd(-0.3, 0.3), vy: dy * 1.5 + 0.4, vz: dz * 1.5 + rnd(-0.3, 0.3),
        life: rnd(0.4, 0.8), size: 0.12, size1: 0.5, r: 0.6 * this.amb.r, g: 0.6 * this.amb.g, b: 0.6 * this.amb.b, a: 0.22, cell: C.SMOKE, drag: 2.5, rotVel: rnd(-1, 1),
      });
    }
    this.flashLight(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3, 0xffc070, 26 * power, 0.07);
  }

  /** Traceur lumineux du point A au point B. */
  tracer(x0, y0, z0, x1, y1, z1, heavy) {
    let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 2.5) return;
    dx /= dist; dy /= dist; dz /= dist;
    const speed = 300;
    const len = Math.min(heavy ? 9 : 6, dist * 0.6);
    const life = (dist - len) / speed;
    if (life <= 0.004) return;
    this.add.spawn({
      x: x0 + dx * len * 0.5, y: y0 + dy * len * 0.5, z: z0 + dz * len * 0.5, vx: dx * speed, vy: dy * speed, vz: dz * speed,
      life, size: heavy ? 0.06 : 0.04, r: 3.6, g: 2.6, b: 1.2, a: 0.9, cell: C.STREAK, stretch: len, fade: 0.01,
    });
  }

  /** Impact d'une balle sur le décor. */
  impact(x, y, z, face, surf, scale = 1) {
    const n = FACE_NORMALS[face] || FACE_NORMALS[2];
    const nx = n[0], ny = n[1], nz = n[2];
    const px = x + nx * 0.03, py = y + ny * 0.03, pz = z + nz * 0.03;
    const A = this.amb;
    const puff = (count, r, g, b, a, sp, life, s0, s1) => {
      for (let i = 0; i < count; i++) {
        this.alpha.spawn({
          x: px, y: py, z: pz, vx: nx * rnd(0.5, sp) + rnd(-0.6, 0.6), vy: ny * rnd(0.5, sp) + rnd(-0.2, 0.9), vz: nz * rnd(0.5, sp) + rnd(-0.6, 0.6),
          life: rnd(life * 0.6, life), size: s0 * scale, size1: s1 * scale * rnd(0.7, 1.2), r: r * A.r, g: g * A.g, b: b * A.b, a,
          cell: C.SMOKE, drag: 2.2, rotVel: rnd(-1.5, 1.5), grav: -0.3,
        });
      }
    };
    const chips = (count, r, g, b, sp) => {
      for (let i = 0; i < count; i++) {
        this.alpha.spawn({
          x: px, y: py, z: pz, vx: nx * rnd(1, sp) + rnd(-1.6, 1.6), vy: ny * rnd(1, sp) + rnd(-0.5, 2.5), vz: nz * rnd(1, sp) + rnd(-1.6, 1.6),
          life: rnd(0.35, 0.8), size: rnd(0.02, 0.05) * scale, r: r * A.r, g: g * A.g, b: b * A.b, a: 1, cell: C.CHIP, grav: 13, rotVel: rnd(-12, 12), fade: 0.3,
        });
      }
    };
    const sparks = (count, sp) => {
      for (let i = 0; i < count; i++) {
        this.add.spawn({
          x: px, y: py, z: pz, vx: nx * rnd(2, sp) + rnd(-3.2, 3.2), vy: ny * rnd(2, sp) + rnd(-1.5, 4), vz: nz * rnd(2, sp) + rnd(-3.2, 3.2),
          life: rnd(0.12, 0.42), size: rnd(0.012, 0.022), r: 3.5, g: rnd(1.6, 2.6), b: 0.6, a: 1, cell: C.SPARK, stretch: rnd(0.12, 0.35), grav: 9, drag: 1.2,
        });
      }
    };
    let mark = -1, markSize = 0.2;
    if (surf === SURF.METAL) {
      sparks(9, 8); puff(1, 0.5, 0.5, 0.5, 0.25, 1.4, 0.4, 0.06, 0.3);
      this.add.spawn({ x: px, y: py, z: pz, life: 0.05, size: 0.3 * scale, r: 3, g: 2.4, b: 1.2, a: 1, cell: C.FLASH });
      mark = 1; markSize = rnd(0.09, 0.13);
    } else if (surf === SURF.WOOD) {
      chips(7, 0.75, 0.56, 0.34, 4); puff(2, 0.7, 0.58, 0.42, 0.35, 1.6, 0.5, 0.07, 0.4);
      mark = 2; markSize = rnd(0.13, 0.2);
    } else if (surf === SURF.SAND) {
      puff(7, 0.92, 0.8, 0.6, 0.5, 2.6, 1.1, 0.1, 0.9); chips(3, 0.8, 0.7, 0.5, 3.5);
    } else if (surf === SURF.SOFT) {
      puff(2, 0.5, 0.5, 0.45, 0.3, 1.2, 0.4, 0.06, 0.3);
    } else {
      puff(5, 0.7, 0.68, 0.64, 0.5, 2.4, 0.9, 0.08, 0.6); chips(5, 0.6, 0.58, 0.55, 5);
      if (Math.random() < 0.3) sparks(2, 5);
      mark = 0; markSize = rnd(0.16, 0.26);
    }
    if (mark >= 0 && this.world.raycast(x + nx * 0.08, y + ny * 0.08, z + nz * 0.08, -nx, -ny, -nz, 0.2, _hit)) {
      this.marks.add(this.world, _hit.box, _hit.face, x, y, z, markSize * scale, mark, Math.floor(Math.random() * 8), 1, 1, 1, 0.95);
    }
  }

  /**
   * Blessure : brume, gouttes, éclaboussures sur les surfaces voisines.
   * (dx,dy,dz) = direction du projectile ; power ≈ 1 pour une balle, 2-3 pour un coup fatal.
   */
  bloodHit(x, y, z, dx, dy, dz, power = 1, head = false) {
    const A = this.amb;
    if (this.gore === 0) {
      // sans sang : simple bouffée de poussière de tissu
      for (let i = 0; i < 3; i++) this.alpha.spawn({ x, y, z, vx: rnd(-0.8, 0.8), vy: rnd(0, 1), vz: rnd(-0.8, 0.8), life: 0.4, size: 0.08, size1: 0.35, r: 0.6 * A.r, g: 0.6 * A.g, b: 0.58 * A.b, a: 0.4, cell: C.SMOKE, drag: 2 });
      return;
    }
    const ex = this.gore === 2 ? 1.8 : 1;
    const floor = this.world.groundBelow(x, y, z);
    const br = 0.5 * (0.5 + 0.5 * A.r), bg = 0.012, bb = 0.012;
    // brume
    for (let i = 0; i < Math.ceil(2 * power * ex); i++) {
      this.alpha.spawn({
        x, y, z, vx: dx * rnd(0.5, 2.5) + rnd(-0.7, 0.7), vy: dy * rnd(0.5, 2) + rnd(-0.2, 0.8), vz: dz * rnd(0.5, 2.5) + rnd(-0.7, 0.7),
        life: rnd(0.25, 0.5), size: 0.1, size1: rnd(0.4, 0.75) * (head ? 1.3 : 1), r: br * 1.1, g: bg, b: bb, a: 0.55, cell: C.SMOKE, drag: 3, rotVel: rnd(-2, 2),
      });
    }
    // gouttes projetées dans l'axe du tir (sortie) et un peu en retour
    const drops = Math.ceil(7 * power * ex);
    for (let i = 0; i < drops; i++) {
      const back = Math.random() < 0.25 ? -0.5 : 1;
      const sp = rnd(1.5, 7) * (head ? 1.2 : 1);
      this.alpha.spawn({
        x, y, z, vx: dx * sp * back + rnd(-1.8, 1.8), vy: dy * sp * back + rnd(0.2, 3.4), vz: dz * sp * back + rnd(-1.8, 1.8),
        life: rnd(0.7, 1.5), size: rnd(0.025, 0.07), r: br, g: bg, b: bb, a: 1, cell: Math.random() < 0.5 ? C.BLOOD : C.BLOOD2,
        grav: 13, drag: 0.4, rotVel: rnd(-4, 4), floor: floor > -1e8 ? floor + 0.01 : -1e9, tag: 1, fade: 0.2,
      });
    }
    // éclaboussures sur les murs et le sol derrière la victime
    const rays = Math.ceil((this.gore === 2 ? 3 : 2) * Math.min(2, power));
    for (let i = 0; i < rays; i++) {
      let rx = dx + rnd(-0.45, 0.45), ry = dy + rnd(-0.5, 0.15), rz = dz + rnd(-0.45, 0.45);
      const l = Math.hypot(rx, ry, rz) || 1;
      rx /= l; ry /= l; rz /= l;
      if (this.world.raycast(x, y, z, rx, ry, rz, 3.8, _hit)) {
        const d = _hit.t;
        const vertical = _hit.face !== 2 && _hit.face !== 3;
        const size = rnd(0.35, 0.8) * Math.min(1.8, 0.7 + power * 0.4) * (1.15 - d / 5);
        const cell = vertical && Math.random() < 0.45 ? 6 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * 6);
        // les coulures (cellules 6-7) gardent leur orientation verticale
        const variant = cell >= 6 ? (Math.random() < 0.5 ? 1 : 0) : Math.floor(Math.random() * 8);
        this.blood.add(this.world, _hit.box, _hit.face, x + rx * d, y + ry * d, z + rz * d, size, cell, variant, 1, 1, 1, rnd(0.8, 1));
      }
    }
    if (floor > -1e8 && y - floor < 2.2 && Math.random() < 0.5 * power) {
      if (this.world.raycast(x + rnd(-0.4, 0.4), y, z + rnd(-0.4, 0.4), 0, -1, 0, 2.4, _hit)) {
        this.blood.add(this.world, _hit.box, _hit.face, x + dx * 0.3, floor, z + dz * 0.3, rnd(0.3, 0.6), Math.floor(Math.random() * 6), Math.floor(Math.random() * 8), 1, 1, 1, 0.9);
      }
    }
  }

  /** Jet de sang d'un moignon (appelé périodiquement pour un ragdoll démembré). */
  spurt(x, y, z, dx, dy, dz) {
    if (this.gore < 1) return;
    const A = this.amb;
    const floor = this.world.groundBelow(x, y + 0.2, z);
    for (let i = 0; i < 4; i++) {
      const sp = rnd(1.5, 4.5);
      this.alpha.spawn({
        x, y, z, vx: dx * sp + rnd(-0.6, 0.6), vy: dy * sp + rnd(0.2, 1.5), vz: dz * sp + rnd(-0.6, 0.6),
        life: rnd(0.6, 1.1), size: rnd(0.03, 0.065), r: 0.5 * (0.5 + 0.5 * A.r), g: 0.012, b: 0.012, a: 1,
        cell: C.BLOOD2, grav: 13, rotVel: rnd(-4, 4), floor: floor > -1e8 ? floor + 0.01 : -1e9, tag: 1, fade: 0.2,
      });
    }
  }

  /** Mare de sang qui s'étend lentement sous un corps. */
  addPool(x, y, z) {
    if (this.gore < 1 || this.pools.length > 28) return;
    if (!this.world.raycast(x, y + 0.4, z, 0, -1, 0, 1.6, _hit)) return;
    if (_hit.face !== 2) return;
    const py = y + 0.4 - _hit.t;
    const pool = { box: _hit.box, x, y: py, z, t: 0, dur: rnd(7, 11), size: rnd(1.0, 1.7) * (this.gore === 2 ? 1.25 : 1), cell: Math.floor(Math.random() * 6), variant: Math.floor(Math.random() * 8), slot: -1 };
    pool.slot = this.blood.add(this.world, pool.box, 2, x, py, z, 0.25, pool.cell, pool.variant, 1, 1, 1, 0.95);
    if (pool.slot >= 0) this.pools.push(pool);
  }

  /** Morceaux de chair projetés (mort par explosion, tête éclatée). */
  spawnGibs(x, y, z, vx, vy, vz, count, power = 1) {
    if (this.gore < 1) return;
    const n = Math.round(count * (this.gore === 2 ? 1 : 0.4));
    const A = this.amb;
    for (let i = 0; i < n; i++) {
      if (this.gibs.length >= this.maxGibs) this.gibs.shift();
      this.gibs.push({
        x: x + rnd(-0.2, 0.2), y: y + rnd(-0.3, 0.3), z: z + rnd(-0.2, 0.2),
        vx: vx * 0.5 + rnd(-5, 5) * power, vy: vy * 0.5 + rnd(2, 8) * power, vz: vz * 0.5 + rnd(-5, 5) * power,
        ax: rnd(-1, 1), ay: rnd(-1, 1), az: rnd(-1, 1), rot: 0, spin: rnd(4, 16), s: rnd(0.6, 1.5), life: rnd(9, 15), bounces: 0, trail: 0,
      });
    }
    // lambeaux en particules + grosse gerbe
    for (let i = 0; i < n * 2; i++) {
      this.alpha.spawn({
        x, y, z, vx: vx * 0.3 + rnd(-6, 6) * power, vy: vy * 0.3 + rnd(1, 8) * power, vz: vz * 0.3 + rnd(-6, 6) * power,
        life: rnd(0.8, 1.6), size: rnd(0.04, 0.11), r: 0.42 * (0.5 + 0.5 * A.r), g: 0.01, b: 0.01, a: 1, cell: Math.random() < 0.5 ? C.MEAT : C.BLOOD,
        grav: 14, rotVel: rnd(-8, 8), floor: this.world.groundBelow(x, y, z) + 0.01, tag: 1, fade: 0.2,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.alpha.spawn({ x, y, z, vx: rnd(-2, 2), vy: rnd(0, 2.5), vz: rnd(-2, 2), life: rnd(0.4, 0.8), size: 0.3, size1: rnd(1.0, 1.7), r: 0.45, g: 0.01, b: 0.01, a: 0.6, cell: C.SMOKE, drag: 2.5 });
    }
  }

  /** Douille éjectée. */
  shell(x, y, z, vx, vy, vz, big) {
    this.alpha.spawn({
      x, y, z, vx, vy, vz, life: 1.1, size: big ? 0.05 : 0.032, r: 0.85 * this.amb.r + 0.1, g: 0.62 * this.amb.g + 0.08, b: 0.22, a: 1, cell: C.SHELL,
      grav: 11, rotVel: rnd(-25, 25), floor: this.world.groundBelow(x, y, z) + 0.01, fade: 0.05,
    });
  }

  /** Traînée d'une roquette (à appeler à chaque image). */
  rocketTrail(x, y, z) {
    this.add.spawn({ x, y, z, life: 0.12, size: 0.5, size1: 0.2, r: 3.5, g: 2.0, b: 0.7, a: 1, cell: C.FIRE });
    this.alpha.spawn({ x, y, z, vx: rnd(-0.4, 0.4), vy: rnd(0, 0.6), vz: rnd(-0.4, 0.4), life: rnd(0.8, 1.6), size: 0.2, size1: rnd(0.8, 1.3), r: 0.62 * this.amb.r, g: 0.62 * this.amb.g, b: 0.62 * this.amb.b, a: 0.4, cell: C.SMOKE, drag: 1.5, rotVel: rnd(-1, 1) });
  }

  /** kind : 0 grenade, 1 roquette, 2 baril */
  explosion(x, y, z, kind) {
    const S = kind === 2 ? 1.3 : kind === 1 ? 1.1 : 1;
    const A = this.amb;
    this.flashLight(x, y + 0.5, z, 0xffa040, 380 * S, 0.35);
    this.add.spawn({ x, y: y + 0.3, z, life: 0.1, size: 4.5 * S, size1: 7 * S, r: 4, g: 3, b: 1.6, a: 1, cell: C.FLASH });
    this.add.spawn({ x, y: y + 0.2, z, life: 0.3, size: 1, size1: 10 * S, r: 1.6, g: 1.2, b: 0.8, a: 0.55, cell: C.RING, fade: 1.5 });
    const fire = kind === 2 ? 22 : 15;
    for (let i = 0; i < fire; i++) {
      const a = Math.random() * 6.283, e = rnd(0, 1.3), sp = rnd(2, 8) * S;
      this.add.spawn({
        x, y: y + 0.2, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1, vz: Math.sin(a) * Math.cos(e) * sp,
        life: rnd(0.3, 0.65) * (kind === 2 ? 1.5 : 1), size: rnd(0.6, 1.1) * S, size1: rnd(2.0, 3.2) * S, r: 3.4, g: rnd(1.3, 1.9), b: 0.45, a: 0.9, cell: C.FIRE, drag: 2.6, rotVel: rnd(-2, 2), fade: 1.6,
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * 6.283, sp = rnd(0.5, 4) * S;
      const g = rnd(0.12, 0.3);
      this.alpha.spawn({
        x: x + rnd(-0.5, 0.5), y: y + rnd(0.2, 1), z: z + rnd(-0.5, 0.5), vx: Math.cos(a) * sp, vy: rnd(1, 4.5), vz: Math.sin(a) * sp,
        life: rnd(1.8, 3.8), size: rnd(0.8, 1.4) * S, size1: rnd(3, 5) * S, r: g * (0.6 + A.r * 0.4), g: g * (0.6 + A.g * 0.4), b: g * (0.6 + A.b * 0.4), a: 0.7, cell: C.SMOKE, drag: 1.1, rotVel: rnd(-0.8, 0.8), grav: -0.6, fade: 1.3,
      });
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * 6.283, e = rnd(0.1, 1.4), sp = rnd(8, 24) * S;
      this.add.spawn({
        x, y: y + 0.2, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp,
        life: rnd(0.4, 1.1), size: rnd(0.02, 0.035), r: 3.6, g: rnd(1.6, 2.4), b: 0.5, a: 1, cell: C.SPARK, stretch: rnd(0.3, 0.8), grav: 12, drag: 0.8,
      });
    }
    const floor = this.world.groundBelow(x, y + 0.3, z);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.283, sp = rnd(4, 13) * S;
      this.alpha.spawn({
        x, y: y + 0.2, z, vx: Math.cos(a) * sp, vy: rnd(3, 11), vz: Math.sin(a) * sp, life: rnd(0.9, 1.8), size: rnd(0.04, 0.11), r: 0.14, g: 0.13, b: 0.12, a: 1, cell: C.CHIP,
        grav: 16, rotVel: rnd(-14, 14), floor: floor > -1e8 ? floor : -1e9, fade: 0.2,
      });
    }
    // couronne de poussière au ras du sol
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.283 + rnd(-0.2, 0.2), sp = rnd(5, 9) * S;
      this.alpha.spawn({
        x, y: Math.max(y, floor + 0.2), z, vx: Math.cos(a) * sp, vy: rnd(0.2, 1), vz: Math.sin(a) * sp, life: rnd(0.9, 1.6), size: 0.5, size1: rnd(1.8, 2.8) * S,
        r: 0.72 * A.r, g: 0.66 * A.g, b: 0.56 * A.b, a: 0.4, cell: C.SMOKE, drag: 3.2, rotVel: rnd(-1, 1),
      });
    }
    if (this.world.raycast(x, y + 0.4, z, 0, -1, 0, 2.8, _hit)) {
      this.marks.add(this.world, _hit.box, _hit.face, x, y + 0.4 - _hit.t, z, 4.6 * S, 3, Math.floor(Math.random() * 8), 1, 1, 1, 0.92);
    }
  }

  // -------------------------------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    for (const l of this.lights) {
      const u = l.userData;
      if (u.t < u.dur) {
        u.t += dt;
        const k = Math.max(0, 1 - u.t / u.dur);
        l.intensity = u.peak * k * k;
      } else if (l.intensity !== 0) l.intensity = 0;
    }
    // mares de sang
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const size = 0.25 + (p.size - 0.25) * (1 - Math.pow(1 - k, 2.2));
      this.blood.add(this.world, p.box, 2, p.x, p.y, p.z, size, p.cell, p.variant, 1, 1, 1, 0.95, p.slot);
      if (k >= 1) this.pools.splice(i, 1);
    }
    // morceaux de chair
    const A = this.amb;
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      this.gibs[i].life -= dt;
      if (this.gibs[i].life <= 0) this.gibs.splice(i, 1);
    }
    for (let i = 0; i < this.gibs.length; i++) {
      const g = this.gibs[i];
      if (g.bounces < 6) {
        g.vy -= 18 * dt;
        g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
        g.rot += g.spin * dt;
        const floor = this.world.groundBelow(g.x, g.y + 0.5, g.z);
        if (floor > -1e8 && g.y < floor + 0.06) {
          g.y = floor + 0.06;
          if (Math.abs(g.vy) > 1.2 && this.world.raycast(g.x, g.y + 0.3, g.z, 0, -1, 0, 0.6, _hit)) {
            this.blood.add(this.world, _hit.box, _hit.face, g.x, floor, g.z, rnd(0.25, 0.6) * g.s, Math.floor(Math.random() * 6), Math.floor(Math.random() * 8), 1, 1, 1, 0.9);
          }
          g.vy = -g.vy * 0.3; g.vx *= 0.55; g.vz *= 0.55; g.spin *= 0.5;
          g.bounces++;
          if (Math.abs(g.vy) < 0.8) { g.bounces = 6; g.vy = 0; }
        }
        // collision sommaire avec les murs : on teste le point d'arrivée
        g.trail -= dt;
        if (g.trail <= 0 && Math.hypot(g.vx, g.vy, g.vz) > 2.5) {
          g.trail = 0.045;
          this.alpha.spawn({ x: g.x, y: g.y, z: g.z, vx: rnd(-0.3, 0.3), vy: rnd(-0.2, 0.4), vz: rnd(-0.3, 0.3), life: rnd(0.35, 0.7), size: rnd(0.03, 0.07), r: 0.45 * (0.5 + 0.5 * A.r), g: 0.01, b: 0.01, a: 0.9, cell: C.BLOOD2, grav: 6, floor: floor > -1e8 ? floor + 0.01 : -1e9, tag: 1 });
        }
      }
      _dummy.position.set(g.x, g.y, g.z);
      _dummy.rotation.set(g.ax * g.rot, g.ay * g.rot, g.az * g.rot);
      _dummy.scale.setScalar(g.s * Math.min(1, g.life / 1.5));
      _dummy.updateMatrix();
      this.gibMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.gibMesh.count = this.gibs.length;
    if (this.gibs.length) this.gibMesh.instanceMatrix.needsUpdate = true;

    this.alpha.update(dt);
    this.add.update(dt);
    this.blood.flush();
    this.marks.flush();
  }

  dispose() {
    for (const o of [this.blood.mesh, this.marks.mesh, this.alpha.mesh, this.add.mesh, this.gibMesh, ...this.lights]) this.scene.remove(o);
    // les textures d'atlas sont partagées : on ne libère que les géométries et les matériaux
    for (const m of [this.blood.mesh, this.marks.mesh, this.alpha.mesh, this.add.mesh, this.gibMesh]) { m.geometry.dispose(); m.material.dispose(); }
  }
}
