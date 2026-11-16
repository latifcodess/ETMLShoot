// Personnages : modèle de soldat généré par code (maillage à peau rigide, 11 os),
// animation procédurale (marche, visée par cinématique inverse, accroupi...) et ragdoll physique.

import * as THREE from 'three';
import { BF } from '../../shared/constants.js';
import { buildWeaponLow, WEAPON_HOLD } from './weapons3d.js';

// Indices des os
const B = { HIPS: 0, SPINE: 1, HEAD: 2, ARM_LU: 3, ARM_LL: 4, ARM_RU: 5, ARM_RL: 6, LEG_LU: 7, LEG_LL: 8, LEG_RU: 9, LEG_RL: 10 };
// Position de repos de chaque os dans le repère du modèle (pieds à l'origine, regard vers -Z)
const BIND = [
  [0, 0.95, 0], [0, 1.10, 0], [0, 1.52, 0],
  [-0.22, 1.42, 0], [-0.22, 1.12, 0], [0.22, 1.42, 0], [0.22, 1.12, 0],
  [-0.10, 0.93, 0], [-0.10, 0.50, 0], [0.10, 0.93, 0], [0.10, 0.50, 0],
];
const PARENT = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9];
const UPPER_ARM = 0.30, FOREARM = 0.31, THIGH = 0.43, SHIN = 0.50;

export const LOOKS = {
  alpha: { uniform: 0x3f5f80, vest: 0x1d2835, helmet: 0x30506f, accent: 0x4aa8ff, pack: 0x2a3a4c },
  bravo: { uniform: 0x86503a, vest: 0x2c201a, helmet: 0x743526, accent: 0xff5a36, pack: 0x4a2d22 },
  ffa0: { uniform: 0x566043, vest: 0x23281d, helmet: 0x4a543a, accent: 0xe8b23a, pack: 0x3a4230 },
  ffa1: { uniform: 0x8b7a58, vest: 0x3a3226, helmet: 0x7a6a4a, accent: 0xe8b23a, pack: 0x5a4d38 },
  ffa2: { uniform: 0x5c6168, vest: 0x1f2226, helmet: 0x4a4e55, accent: 0xe8b23a, pack: 0x33373c },
  ffa3: { uniform: 0x2e3238, vest: 0x15171a, helmet: 0x22252a, accent: 0xe8b23a, pack: 0x1c1e22 },
  grunt: { uniform: 0x3b3f45, vest: 0x141619, helmet: 0x24272b, accent: 0xb3261e, pack: 0x1a1c1f, face: 0x17181a },
  rusher: { uniform: 0x5d2f2d, vest: 0x1b1c1e, helmet: 0x8a1f1a, accent: 0xff3a2a, pack: 0, face: 0x17181a, head: 'bandana' },
  heavy: { uniform: 0x2c3037, vest: 0x0e0f11, helmet: 0x1a1c20, accent: 0xff7a1a, pack: 0x141518, face: 0x0c0c0d, head: 'visor', bulk: 1.28, plates: true },
  marksman: { uniform: 0x4c5536, vest: 0x2a2f20, helmet: 0x3f4730, accent: 0x9fd13a, pack: 0x30361f, face: 0x23281a, head: 'hood' },
  grenadier: { uniform: 0x5e4c37, vest: 0x2b2a1e, helmet: 0x4a3d2c, accent: 0xd9c23a, pack: 0x3a3022, face: 0x17181a, bandolier: true, bulk: 1.1 },
  juggernaut: { uniform: 0x1b1d21, vest: 0x09090a, helmet: 0x101113, accent: 0xff2416, pack: 0x0d0d0f, face: 0x050505, head: 'visor', bulk: 1.42, plates: true },
};

const SKIN = 0xc59877, BOOTS = 0x121315, GLOVES = 0x1a1b1d;

// ---------------------------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------------------------

const geoCache = new Map();

function soldierGeometry(lookName) {
  if (geoCache.has(lookName)) return geoCache.get(lookName);
  const L = LOOKS[lookName] || LOOKS.ffa0;
  const bulk = L.bulk || 1;
  const pos = [], nrm = [], col = [], sidx = [], idx = [];
  const c = new THREE.Color();
  const m4 = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), n3 = new THREE.Matrix3();

  const add = (geo, bone, hex, x, y, z, rx = 0, ry = 0, rz = 0, shade = 1) => {
    m4.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s1);
    geo.applyMatrix4(m4);
    n3.getNormalMatrix(m4);
    c.setHex(hex, THREE.SRGBColorSpace).multiplyScalar(shade);
    const p = geo.attributes.position, nn = geo.attributes.normal;
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      col.push(c.r, c.g, c.b);
      sidx.push(bone, 0, 0, 0);
    }
    const ix = geo.index;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    geo.dispose();
  };
  const box = (w, h, d, x, y, z, bone, hex, rx, ry, rz, shade) => add(new THREE.BoxGeometry(w, h, d), bone, hex, x, y, z, rx, ry, rz, shade);
  const cyl = (r0, r1, h, x, y, z, bone, hex, rx, ry, rz, shade) => add(new THREE.CylinderGeometry(r0, r1, h, 10, 1), bone, hex, x, y, z, rx, ry, rz, shade);
  const sph = (r, x, y, z, bone, hex, shade) => add(new THREE.SphereGeometry(r, 12, 9), bone, hex, x, y, z, 0, 0, 0, shade);

  // --- bassin et torse
  box(0.34 * bulk, 0.2, 0.22 * bulk, 0, 0.93, 0, B.HIPS, L.uniform, 0, 0, 0, 0.92);
  box(0.36 * bulk, 0.05, 0.24 * bulk, 0, 1.02, 0, B.HIPS, 0x1a1a1c);                       // ceinturon
  box(0.38 * bulk, 0.44, 0.22 * bulk, 0, 1.27, 0, B.SPINE, L.uniform);
  box(0.43 * bulk, 0.34, 0.275 * bulk, 0, 1.3, 0, B.SPINE, L.vest);                        // gilet tactique
  box(0.3 * bulk, 0.1, 0.05, 0, 1.19, -0.155 * bulk, B.SPINE, L.vest, 0, 0, 0, 1.35);       // porte-chargeurs
  box(0.08, 0.11, 0.05, -0.1 * bulk, 1.19, -0.165 * bulk, B.SPINE, L.vest, 0, 0, 0, 1.6);
  box(0.08, 0.11, 0.05, 0.02, 1.19, -0.165 * bulk, B.SPINE, L.vest, 0, 0, 0, 1.6);
  box(0.08, 0.11, 0.05, 0.13 * bulk, 1.19, -0.165 * bulk, B.SPINE, L.vest, 0, 0, 0, 1.6);
  if (L.pack) box(0.3 * bulk, 0.36, 0.14, 0, 1.28, 0.2 * bulk, B.SPINE, L.pack);            // sac
  if (L.plates) {
    box(0.47 * bulk, 0.2, 0.3 * bulk, 0, 1.36, 0, B.SPINE, L.vest, 0, 0, 0, 1.5);           // plastron
    box(0.16, 0.08, 0.2, -0.27 * bulk, 1.47, 0, B.ARM_LU, L.vest, 0, 0, 0.25, 1.4);         // épaulières
    box(0.16, 0.08, 0.2, 0.27 * bulk, 1.47, 0, B.ARM_RU, L.vest, 0, 0, -0.25, 1.4);
    box(0.24 * bulk, 0.22, 0.05, 0, 0.92, -0.13 * bulk, B.HIPS, L.vest, 0, 0, 0, 1.3);      // protège-bassin
  }
  if (L.bandolier) {
    box(0.07, 0.6, 0.3 * bulk, 0, 1.28, 0, B.SPINE, 0x2a2118, 0, 0, 0.62);
    for (let i = 0; i < 5; i++) cyl(0.022, 0.022, 0.07, -0.14 + i * 0.07, 1.18 + i * 0.05, -0.16 * bulk, B.SPINE, L.accent);
  }
  // brassards de couleur (identification rapide de l'équipe)
  box(0.125 * bulk, 0.06, 0.125 * bulk, -0.25 * bulk, 1.33, 0, B.ARM_LU, L.accent, 0, 0, 0, 1.25);
  box(0.125 * bulk, 0.06, 0.125 * bulk, 0.25 * bulk, 1.33, 0, B.ARM_RU, L.accent, 0, 0, 0, 1.25);

  // --- tête
  cyl(0.05, 0.055, 0.1, 0, 1.53, 0, B.HEAD, L.face || SKIN);
  sph(0.105, 0, 1.64, 0, B.HEAD, L.face || SKIN);
  if (!L.face) box(0.15, 0.035, 0.03, 0, 1.655, -0.095, B.HEAD, 0x0c0d0e);                 // lunettes
  const head = L.head || 'helmet';
  if (head === 'helmet') {
    add(new THREE.SphereGeometry(0.128, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.56), B.HEAD, L.helmet, 0, 1.655, 0.005);
    box(0.2, 0.025, 0.05, 0, 1.69, -0.12, B.HEAD, L.helmet, 0.25, 0, 0, 0.8);               // visière
    box(0.03, 0.05, 0.26, 0, 1.775, 0, B.HEAD, L.accent, 0, 0, 0, 1.1);                    // bande d'équipe
  } else if (head === 'bandana') {
    add(new THREE.SphereGeometry(0.113, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45), B.HEAD, L.helmet, 0, 1.645, 0);
    box(0.05, 0.03, 0.12, 0.03, 1.66, 0.14, B.HEAD, L.helmet, 0.5, 0.2, 0);
  } else if (head === 'hood') {
    add(new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.68), B.HEAD, L.helmet, 0, 1.645, 0.015);
    box(0.24, 0.1, 0.16, 0, 1.52, 0.05, B.HEAD, L.helmet, 0.2, 0, 0);
  } else {
    // casque lourd à visière
    sph(0.14, 0, 1.65, 0, B.HEAD, L.helmet);
    box(0.2, 0.075, 0.06, 0, 1.655, -0.115, B.HEAD, L.accent, 0, 0, 0, 1.6);
    box(0.16, 0.1, 0.1, 0, 1.56, -0.07, B.HEAD, L.helmet, 0, 0, 0, 1.3);
  }

  // --- bras
  for (const sgn of [-1, 1]) {
    const up = sgn < 0 ? B.ARM_LU : B.ARM_RU, lo = sgn < 0 ? B.ARM_LL : B.ARM_RL;
    const x = sgn * 0.22;
    sph(0.075 * bulk, x * (1 + (bulk - 1) * 0.6), 1.42, 0, up, L.uniform);
    box(0.115 * bulk, UPPER_ARM, 0.115 * bulk, x, 1.42 - UPPER_ARM / 2, 0, up, L.uniform);
    box(0.1 * bulk, FOREARM - 0.07, 0.1 * bulk, x, 1.12 - (FOREARM - 0.07) / 2, 0, lo, L.uniform, 0, 0, 0, 0.9);
    box(0.105, 0.04, 0.105, x, 1.12 - 0.02, 0, lo, 0x202124);                               // coudière
    box(0.085, 0.1, 0.1, x, 1.12 - FOREARM + 0.02, 0, lo, GLOVES);                          // gant
  }
  // --- jambes
  for (const sgn of [-1, 1]) {
    const up = sgn < 0 ? B.LEG_LU : B.LEG_RU, lo = sgn < 0 ? B.LEG_LL : B.LEG_RL;
    const x = sgn * 0.10;
    box(0.155 * bulk, THIGH, 0.17 * bulk, x, 0.93 - THIGH / 2, 0, up, L.uniform, 0, 0, 0, 0.88);
    box(0.09, 0.14, 0.06, x + sgn * 0.09 * bulk, 0.76, 0.01, up, L.vest, 0, 0, 0, 1.4);     // poche de cuisse
    box(0.135 * bulk, SHIN - 0.1, 0.15 * bulk, x, 0.5 - (SHIN - 0.1) / 2, 0, lo, L.uniform, 0, 0, 0, 0.8);
    box(0.13, 0.1, 0.06, x, 0.47, -0.085 * bulk, lo, 0x202124);                             // genouillère
    box(0.14, 0.13, 0.17, x, 0.065, 0.0, lo, BOOTS);                                        // botte
    box(0.13, 0.075, 0.12, x, 0.038, -0.13, lo, BOOTS);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sidx, 4));
  const sw = new Float32Array(sidx.length);
  for (let i = 0; i < sw.length; i += 4) sw[i] = 1;
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius = 2.6;
  geoCache.set(lookName, g);
  return g;
}

let _bodyMat = null, _shadowOnly = null;
function bodyMaterial() {
  if (!_bodyMat) _bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 });
  return _bodyMat;
}
/** Matériau invisible mais projetant une ombre (corps du joueur local en vue subjective). */
function shadowOnlyMaterial() {
  if (!_shadowOnly) { _shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }); }
  return _shadowOnly;
}

/** Choisit l'apparence d'un acteur. */
export function lookFor(kindLook, team, id, mode) {
  if (kindLook !== 'soldier') return kindLook;
  if (mode === 'ffa') return 'ffa' + (id % 4);
  return team === 2 ? 'bravo' : 'alpha';
}

// ---------------------------------------------------------------------------------------------
// Modèle animé
// ---------------------------------------------------------------------------------------------

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
const _ex = new THREE.Euler();

export class Soldier {
  constructor(look, scale = 1, localShadow = false) {
    this.look = look;
    this.scale = scale;
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    const geo = soldierGeometry(look);
    this.mesh = new THREE.SkinnedMesh(geo, localShadow ? shadowOnlyMaterial() : bodyMaterial());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = !localShadow;
    this.mesh.frustumCulled = false;
    this.bones = [];
    for (let i = 0; i < BIND.length; i++) {
      const b = new THREE.Bone();
      const p = PARENT[i];
      if (p < 0) b.position.set(BIND[i][0], BIND[i][1], BIND[i][2]);
      else b.position.set(BIND[i][0] - BIND[p][0], BIND[i][1] - BIND[p][1], BIND[i][2] - BIND[p][2]);
      this.bones.push(b);
      if (p >= 0) this.bones[p].add(b);
    }
    this.mesh.add(this.bones[0]);
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    // pivot de visée (porté par la colonne) : l'arme y est attachée, les bras suivent par cinématique inverse
    this.aim = new THREE.Group();
    this.bones[B.SPINE].add(this.aim);
    this.weaponId = -2;
    this.weapon = null;
    this.hold = WEAPON_HOLD.rifle;
    this.localShadow = localShadow;
    // état d'animation
    this.phase = Math.random() * 6;
    this.crouch = 0; this.air = 0; this.sprint = 0; this.reload = 0; this.kick = 0; this.flinch = 0; this.legYaw = 0; this.move = 0;
    this.melee = 0; this.throw = 0; this.reloadT = 0;
    this.stepFlag = 0;        // passe à 1 à chaque pas (pour le son)
    this.visible = true;
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.weapon) { this.aim.remove(this.weapon); this.weapon = null; }
    if (id < 0 || id === 255) return;
    const w = buildWeaponLow(id);
    this.weapon = w.group;
    this.hold = w.hold;
    if (this.localShadow) this.weapon.traverse((o) => { if (o.isMesh) o.material = shadowOnlyMaterial(); });
    this.aim.add(this.weapon);
  }

  /** Position monde de la bouche du canon (pour les tracés et les flashs vus de l'extérieur). */
  muzzleWorld(out) {
    if (this.weapon) return out.set(this.hold.muzzle[0], this.hold.muzzle[1], this.hold.muzzle[2]).applyMatrix4(this.weapon.matrixWorld);
    return out.set(0, 1.4 * this.scale, 0).applyMatrix4(this.root.matrixWorld);
  }

  /**
   * @param s {x,y,z,yaw,pitch,vx,vz,crouch,ground,sprint,reload,ads,firing}
   */
  update(dt, s) {
    const bones = this.bones, sc = this.scale;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;

    // --- vitesse relative au regard
    const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw);
    const fwd = -(s.vx * sn + s.vz * cs), right = s.vx * cs - s.vz * sn;
    const speed = Math.hypot(fwd, right);
    const k = Math.min(1, dt * 10);
    this.move += (Math.min(1, speed / 2.5) - this.move) * k;
    this.crouch += ((s.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    this.air += ((s.ground ? 0 : 1) - this.air) * Math.min(1, dt * 9);
    this.sprint += ((s.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    this.reload += ((s.reload ? 1 : 0) - this.reload) * Math.min(1, dt * 9);
    if (s.reload) this.reloadT += dt; else this.reloadT = 0;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flinch *= Math.exp(-dt * 9);
    this.melee = Math.max(0, this.melee - dt * 2.6);
    this.throw = Math.max(0, this.throw - dt * 2.2);

    // --- orientation des jambes selon la direction de déplacement
    let rel = speed > 0.4 ? Math.atan2(right, fwd) : 0;
    let dirSign = 1;
    if (Math.abs(rel) > 1.75) { rel -= Math.sign(rel) * Math.PI; dirSign = -1; }
    rel = Math.max(-0.95, Math.min(0.95, rel));
    this.legYaw += (rel - this.legYaw) * Math.min(1, dt * 10);
    const cycle = 1.55 + speed * 0.13;
    const prev = this.phase;
    this.phase += (speed / (cycle * sc)) * Math.PI * 2 * dt * dirSign;
    this.stepFlag = 0;
    if (s.ground && speed > 1 && Math.floor(this.phase / Math.PI) !== Math.floor(prev / Math.PI)) this.stepFlag = 1;

    const ph = this.phase, mv = this.move;
    const cr = this.crouch, air = this.air;
    const swing = (0.62 + this.sprint * 0.28) * mv;
    // --- jambes
    const legs = (thigh, shin, p) => {
      const sw = Math.sin(p);
      let t = sw * swing;
      let kn = (0.18 + Math.max(0, -Math.cos(p)) * (0.9 + this.sprint * 0.5)) * mv;
      t = t * (1 - cr * 0.55) + cr * 1.25 + air * 0.35;
      kn = kn * (1 - cr * 0.4) + cr * 2.3 + air * 0.7;
      bones[thigh].rotation.set(t, 0, 0);
      bones[shin].rotation.set(-kn, 0, 0);
      return Math.cos(t) * THIGH + Math.cos(t - kn) * SHIN;       // hauteur de la hanche au-dessus du pied
    };
    const hL = legs(B.LEG_LU, B.LEG_LL, ph);
    const hR = legs(B.LEG_RU, B.LEG_RL, ph + Math.PI);
    // le bassin se pose sur la jambe la plus tendue (pieds au sol), sauf en l'air
    const hipY = Math.max(hL, hR) * (1 - air) + 0.86 * air;
    bones[B.HIPS].position.set(0, hipY + 0.02, 0);
    bones[B.HIPS].rotation.set(0, -this.legYaw, Math.sin(ph) * 0.03 * mv);

    // --- buste : penché par la course, l'accroupi et la visée verticale
    const lean = 0.06 * mv + this.sprint * 0.26 + cr * 0.3 - this.flinch * 0.25;
    const pitch = s.pitch;
    // NB : une rotation.x négative penche le buste vers l'avant (-Z)
    bones[B.SPINE].rotation.set(pitch * 0.32 - lean, this.legYaw, 0, 'YXZ');
    bones[B.HEAD].rotation.set(pitch * 0.45 + lean * 0.6, 0, 0);

    // --- pivot de visée et pose de l'arme
    const hold = this.hold;
    const low = Math.max(this.sprint, this.reload * 0.55);          // arme abaissée (course, rechargement)
    // le pivot compense l'inclinaison du buste : le canon suit exactement le tangage de la visée
    const aimPitch = pitch * 0.68 + lean - low * 0.75 + this.kick * 0.05 - this.melee * 0.5;
    this.aim.position.set(hold.pivot[0], hold.pivot[1] - low * 0.06, hold.pivot[2] + this.kick * 0.035 - this.melee * 0.2);
    this.aim.rotation.set(aimPitch, low * 0.45 * (hold.oneHand ? 0 : 1), 0, 'YXZ');
    if (this.weapon) {
      this.weapon.position.set(hold.grip[0], hold.grip[1], hold.grip[2]);
      this.weapon.visible = this.visible;
    }

    // --- bras : cinématique inverse à deux segments, calculée dans le repère de la colonne
    this.aim.updateMatrix();
    const am = this.aim.matrix;
    // main droite sur la poignée
    _v1.set(hold.grip[0] + hold.right[0], hold.grip[1] + hold.right[1], hold.grip[2] + hold.right[2]).applyMatrix4(am);
    this._ik(B.ARM_RU, B.ARM_RL, 0.22, 0.32, _v1, 0.55, -1, 0.25);
    // main gauche sur le garde-main (ou vers le chargeur pendant le rechargement, ou lancer de grenade)
    _v2.set(hold.grip[0] + hold.left[0], hold.grip[1] + hold.left[1], hold.grip[2] + hold.left[2]);
    if (this.reload > 0.01) {
      const r = Math.sin(this.reloadT * 5.5) * 0.5 + 0.5;
      _v2.x += -0.02 * this.reload; _v2.y += (-0.16 - r * 0.1) * this.reload; _v2.z += (hold.magZ - hold.left[2]) * this.reload;
    }
    _v2.applyMatrix4(am);
    if (this.throw > 0.01) {
      const t = this.throw;
      _v3.set(-0.3, 0.5 + Math.sin(t * Math.PI) * 0.15, 0.25 - (1 - t) * 0.8);
      _v2.lerp(_v3, Math.min(1, t * 2.2));
    }
    if (hold.oneHand && this.throw < 0.01 && this.reload < 0.01) _v2.set(-0.2, 0.02, -0.12);    // bras gauche le long du corps
    this._ik(B.ARM_LU, B.ARM_LL, -0.22, 0.32, _v2, -0.55, -1, 0.15);
  }

  /** IK analytique : place la main en `target` (repère colonne). Le coude part vers le vecteur pôle. */
  _ik(upper, lower, sx, sy, target, poleX, poleY, poleZ) {
    const bu = this.bones[upper], bl = this.bones[lower];
    const S = _v3.set(sx, sy, 0);
    const d = _v4.copy(target).sub(S);
    let len = d.length();
    const max = UPPER_ARM + FOREARM - 0.004;
    if (len > max) { d.multiplyScalar(max / len); len = max; }
    if (len < 0.05) { d.set(0, -0.05, 0); len = 0.05; }
    const a = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - a * a));
    const nx = d.x / len, ny = d.y / len, nz = d.z / len;
    // composante du pôle perpendiculaire à l'axe épaule → main
    const dot = poleX * nx + poleY * ny + poleZ * nz;
    let px = poleX - nx * dot, py = poleY - ny * dot, pz = poleZ - nz * dot;
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    const ex = nx * a + px * h, ey = ny * a + py * h, ez = nz * a + pz * h;      // coude, relatif à l'épaule
    _v1.set(ex, ey, ez).normalize();
    _q1.setFromUnitVectors(DOWN, _v1);
    bu.quaternion.copy(_q1);
    _v1.set(d.x - ex, d.y - ey, d.z - ez).normalize();
    _q2.setFromUnitVectors(DOWN, _v1);
    bl.quaternion.copy(_q1).invert().multiply(_q2);
  }

  setVisible(v) { this.visible = v; this.root.visible = v; }
  dispose() { this.mesh.skeleton.dispose(); }
}

// ---------------------------------------------------------------------------------------------
// Ragdoll (intégration de Verlet + contraintes de distance), démembrement compris
// ---------------------------------------------------------------------------------------------

// Points : 0 tête, 1 cou, 2 bassin, 3/6 épaules G/D, 4/7 coudes, 5/8 mains, 9/12 hanches, 10/13 genoux, 11/14 pieds,
//          15/16 racines des bras, 17/18 racines des jambes, 19 racine de la tête
const RP = [
  [0, 1.66, 0], [0, 1.47, 0], [0, 0.95, 0],
  [-0.22, 1.42, 0], [-0.22, 1.12, 0], [-0.22, 0.81, 0],
  [0.22, 1.42, 0], [0.22, 1.12, 0], [0.22, 0.81, 0],
  [-0.10, 0.93, 0], [-0.10, 0.50, 0], [-0.10, 0.04, 0],
  [0.10, 0.93, 0], [0.10, 0.50, 0], [0.10, 0.04, 0],
  [-0.22, 1.42, 0], [0.22, 1.42, 0], [-0.10, 0.93, 0], [0.10, 0.93, 0], [0, 1.47, 0],
];
// Point → os animé dont on reprend la position au moment de la mort : [os, dx, dy, dz] (décalage local à l'os)
const RSRC = [
  [B.HEAD, 0, 0.14, 0], [B.SPINE, 0, 0.37, 0], [B.HIPS, 0, 0, 0],
  [B.ARM_LU, 0, 0, 0], [B.ARM_LL, 0, 0, 0], [B.ARM_LL, 0, -FOREARM, 0],
  [B.ARM_RU, 0, 0, 0], [B.ARM_RL, 0, 0, 0], [B.ARM_RL, 0, -FOREARM, 0],
  [B.LEG_LU, 0, 0, 0], [B.LEG_LL, 0, 0, 0], [B.LEG_LL, 0, -0.46, 0],
  [B.LEG_RU, 0, 0, 0], [B.LEG_RL, 0, 0, 0], [B.LEG_RL, 0, -0.46, 0],
  [B.ARM_LU, 0, 0, 0], [B.ARM_RU, 0, 0, 0], [B.LEG_LU, 0, 0, 0], [B.LEG_RU, 0, 0, 0], [B.SPINE, 0, 0.37, 0],
];
// Contraintes : [a, b, groupe]. groupe : 0 torse, 1 bras G, 2 bras D, 3 jambe G, 4 jambe D, 5 tête ;
// 11..15 = attaches (longueur nulle) du membre correspondant au torse.
const RC = [
  [1, 2, 0], [1, 3, 0], [1, 6, 0], [3, 6, 0], [2, 3, 0], [2, 6, 0], [2, 9, 0], [2, 12, 0], [9, 12, 0], [3, 9, 0], [6, 12, 0], [1, 9, 0], [1, 12, 0], [3, 12, 0], [6, 9, 0],
  [15, 4, 1], [4, 5, 1], [16, 7, 2], [7, 8, 2], [17, 10, 3], [10, 11, 3], [18, 13, 4], [13, 14, 4], [19, 0, 5],
  [3, 15, 11], [6, 16, 12], [9, 17, 13], [12, 18, 14], [1, 19, 15],
  [0, 3, 15], [0, 6, 15],
];
const NP = RP.length;
const RADIUS = [0.11, 0.1, 0.13, 0.08, 0.06, 0.06, 0.08, 0.06, 0.06, 0.09, 0.07, 0.06, 0.09, 0.07, 0.06, 0.07, 0.07, 0.08, 0.08, 0.07];

export const SEVER = { ARM_L: 1, ARM_R: 2, LEG_L: 4, LEG_R: 8, HEAD: 16 };

const _m = new THREE.Matrix4(), _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _P = new THREE.Vector3();

export class Ragdoll {
  constructor() {
    this.root = new THREE.Group();
    this.mesh = null;
    this.bones = [];
    this.p = new Float32Array(NP * 3);
    this.o = new Float32Array(NP * 3);       // positions précédentes
    this.rest = new Float32Array(RC.length);
    this.active = new Uint8Array(RC.length);
    this.alive = false;
    this.age = 0; this.life = 14; this.sleep = 0; this.asleep = false;
    this.scale = 1;
    this.severed = 0;
    this.stumps = [];         // [{point, until, next}]
    this.look = null;
    this.headSpin = new THREE.Quaternion(); this.headAxis = new THREE.Vector3(1, 0, 0); this.headRate = 0;
    this.sink = 0;
    this.acc = 0;
  }

  _setLook(look) {
    if (this.look === look && this.mesh) return;
    if (this.mesh) { this.root.remove(this.mesh); this.mesh.skeleton.dispose(); }
    this.look = look;
    const mesh = new THREE.SkinnedMesh(soldierGeometry(look), bodyMaterial());
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.bones = [];
    // squelette plat : chaque os est piloté directement, en coordonnées monde, par la physique
    for (let i = 0; i < BIND.length; i++) {
      const b = new THREE.Bone();
      b.position.set(BIND[i][0], BIND[i][1], BIND[i][2]);
      mesh.add(b);
      this.bones.push(b);
    }
    this.root.add(mesh);
    this.root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh = mesh;
  }

  /**
   * Démarre le ragdoll à partir de la pose courante d'un soldat animé.
   * @param impulse {x,y,z} vitesse ajoutée (m/s) ; hitPoint : indice du point le plus touché (0 tête, 1 torse)
   */
  start(soldier, vel, impulse, sever, headshot) {
    this._setLook(soldier.look);
    this.scale = soldier.scale;
    this.alive = true; this.age = 0; this.sleep = 0; this.asleep = false; this.sink = 0; this.acc = 0;
    this.root.position.y = 0;
    this.severed = sever;
    this.stumps.length = 0;
    this.root.visible = true;
    soldier.root.updateMatrixWorld(true);
    const dt = 1 / 60;
    for (let i = 0; i < NP; i++) {
      const src = RSRC[i];
      _P.set(src[1], src[2], src[3]).applyMatrix4(soldier.bones[src[0]].matrixWorld);
      this.p[i * 3] = _P.x; this.p[i * 3 + 1] = _P.y; this.p[i * 3 + 2] = _P.z;
      // la tête et le haut du corps encaissent davantage l'impact : le corps bascule
      const w = (i === 0 || i === 19) ? (headshot ? 1.9 : 1.1) : (i === 1 || i === 3 || i === 6) ? 1.15 : (i === 11 || i === 14) ? 0.35 : 0.8;
      const jx = (Math.random() - 0.5) * 0.8, jy = (Math.random() - 0.5) * 0.5, jz = (Math.random() - 0.5) * 0.8;
      this.o[i * 3] = _P.x - (vel.x + impulse.x * w + jx) * dt;
      this.o[i * 3 + 1] = _P.y - (vel.y + impulse.y * w + jy) * dt;
      this.o[i * 3 + 2] = _P.z - (vel.z + impulse.z * w + jz) * dt;
    }
    const sc = this.scale;
    for (let c = 0; c < RC.length; c++) {
      const [a, b, g] = RC[c];
      const A = RP[a], Bp = RP[b];
      this.rest[c] = Math.hypot(A[0] - Bp[0], A[1] - Bp[1], A[2] - Bp[2]) * sc;
      let on = 1;
      if (g === 11 && (sever & SEVER.ARM_L)) on = 0;
      if (g === 12 && (sever & SEVER.ARM_R)) on = 0;
      if (g === 13 && (sever & SEVER.LEG_L)) on = 0;
      if (g === 14 && (sever & SEVER.LEG_R)) on = 0;
      if (g === 15 && (sever & SEVER.HEAD)) on = 0;
      this.active[c] = on;
    }
    // membres arrachés : projetés à part, moignons qui saignent
    const fling = (pts, stump, power) => {
      const ax = (Math.random() - 0.5) * power, ay = 2 + Math.random() * power * 0.7, az = (Math.random() - 0.5) * power;
      for (const i of pts) { this.o[i * 3] -= ax * dt; this.o[i * 3 + 1] -= ay * dt; this.o[i * 3 + 2] -= az * dt; }
      this.stumps.push({ point: stump, until: 2.6 + Math.random() * 1.5, next: 0 });
    };
    if (sever & SEVER.HEAD) { fling([0, 19], 1, 5); this.headRate = 6 + Math.random() * 10; this.headAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); this.headSpin.identity(); }
    if (sever & SEVER.ARM_L) fling([15, 4, 5], 3, 5);
    if (sever & SEVER.ARM_R) fling([16, 7, 8], 6, 5);
    if (sever & SEVER.LEG_L) fling([17, 10, 11], 9, 4);
    if (sever & SEVER.LEG_R) fling([18, 13, 14], 12, 4);
    this._pose();
  }

  step(dt, world) {
    if (!this.alive) return;
    this.age += dt;
    if (this.age > this.life) {
      // le corps s'enfonce dans le sol puis disparaît
      this.sink += dt * 0.35;
      this.root.position.y = -this.sink;
      if (this.sink > 0.6) { this.alive = false; this.root.visible = false; this.root.position.y = 0; }
      return;
    }
    if (this.asleep) return;
    // pas fixe de 1/60 s : l'intégration de Verlet n'aime pas les pas variables
    this.acc += Math.min(dt, 0.05);
    let n = 0;
    while (this.acc >= 1 / 60 && n < 3) { this.acc -= 1 / 60; n++; this._sub(world); if (this.asleep) break; }
    if (n) this._pose();
  }

  _sub(world) {
    const p = this.p, o = this.o;
    const h = 1 / 60, dt = h;
    const g = 20 * h * h;
    let energy = 0;
    for (let i = 0; i < NP; i++) {
      const k = i * 3;
      const vx = (p[k] - o[k]) * 0.992, vy = (p[k + 1] - o[k + 1]) * 0.992, vz = (p[k + 2] - o[k + 2]) * 0.992;
      o[k] = p[k]; o[k + 1] = p[k + 1]; o[k + 2] = p[k + 2];
      p[k] += vx; p[k + 1] += vy - g; p[k + 2] += vz;
      energy += vx * vx + vy * vy + vz * vz;
    }
    const b = world.b, flags = world.flags;
    for (let iter = 0; iter < 5; iter++) {
      for (let c = 0; c < RC.length; c++) {
        if (!this.active[c]) continue;
        const a = RC[c][0] * 3, bI = RC[c][1] * 3;
        const dx = p[bI] - p[a], dy = p[bI + 1] - p[a + 1], dz = p[bI + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const rest = this.rest[c];
        if (d < 1e-6) continue;
        const f = (d - rest) / d * 0.5;
        p[a] += dx * f; p[a + 1] += dy * f; p[a + 2] += dz * f;
        p[bI] -= dx * f; p[bI + 1] -= dy * f; p[bI + 2] -= dz * f;
      }
      // collisions avec le monde (chaque point est une petite sphère)
      if (iter % 2 === 0) {
        for (let i = 0; i < NP; i++) {
          const k = i * 3, r = RADIUS[i] * this.scale;
          const n = world.query(p[k] - r, p[k + 2] - r, p[k] + r, p[k + 2] + r);
          for (let qi = 0; qi < n; qi++) {
            const bi = world.q[qi];
            if (flags[bi] & BF.INVISIBLE) continue;
            const q0 = bi * 6;
            const x0 = b[q0] - r, y0 = b[q0 + 1] - r, z0 = b[q0 + 2] - r, x1 = b[q0 + 3] + r, y1 = b[q0 + 4] + r, z1 = b[q0 + 5] + r;
            if (p[k] <= x0 || p[k] >= x1 || p[k + 1] <= y0 || p[k + 1] >= y1 || p[k + 2] <= z0 || p[k + 2] >= z1) continue;
            // sortie par la face la plus proche
            const dx0 = p[k] - x0, dx1 = x1 - p[k], dy0 = p[k + 1] - y0, dy1 = y1 - p[k + 1], dz0 = p[k + 2] - z0, dz1 = z1 - p[k + 2];
            const m = Math.min(dx0, dx1, dy0, dy1, dz0, dz1);
            if (m === dy1) {
              // posé sur une surface : léger rebond, frottement appliqué une seule fois par pas
              const vy = p[k + 1] - o[k + 1];
              p[k + 1] = y1;
              if (iter === 0) o[k + 1] = y1 + Math.min(0, vy) * 0.18;
              if (iter === 4) { o[k] += (p[k] - o[k]) * 0.14; o[k + 2] += (p[k + 2] - o[k + 2]) * 0.14; }
            }
            else if (m === dy0) p[k + 1] = y0;
            else if (m === dx0) { p[k] = x0; o[k] = p[k]; }
            else if (m === dx1) { p[k] = x1; o[k] = p[k]; }
            else if (m === dz0) { p[k + 2] = z0; o[k + 2] = p[k + 2]; }
            else { p[k + 2] = z1; o[k + 2] = p[k + 2]; }
          }
        }
      }
    }
    if (this.severed & SEVER.HEAD) {
      this.headRate *= Math.exp(-h * 0.8);
      _q1.setFromAxisAngle(this.headAxis, this.headRate * h);
      this.headSpin.premultiply(_q1);
    }
    if (energy < 0.00004 * NP && this.age > 1) { this.sleep += dt; if (this.sleep > 1.2) this.asleep = true; } else this.sleep = 0;
  }

  _pt(i, out) { return out.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]); }

  /** Oriente un os le long d'un segment (l'axe -Y de l'os suit a → b), X de référence fourni. */
  _limb(bone, a, b, refX) {
    this._pt(a, _P);
    _Y.set(this.p[a * 3] - this.p[b * 3], this.p[a * 3 + 1] - this.p[b * 3 + 1], this.p[a * 3 + 2] - this.p[b * 3 + 2]);
    if (_Y.lengthSq() < 1e-8) _Y.set(0, 1, 0);
    _Y.normalize();
    _Z.crossVectors(refX, _Y);
    if (_Z.lengthSq() < 1e-6) _Z.set(0, 0, 1);
    _Z.normalize();
    _X.crossVectors(_Y, _Z);
    _m.makeBasis(_X, _Y, _Z);
    const bn = this.bones[bone];
    bn.quaternion.setFromRotationMatrix(_m);
    bn.position.copy(_P);
    bn.scale.setScalar(this.scale);
  }

  _pose() {
    const sc = this.scale;
    const bones = this.bones;
    // repère du torse
    const tx = _v1.set(this.p[6 * 3] - this.p[3 * 3], this.p[6 * 3 + 1] - this.p[3 * 3 + 1], this.p[6 * 3 + 2] - this.p[3 * 3 + 2]);
    if (tx.lengthSq() < 1e-8) tx.set(1, 0, 0);
    tx.normalize();
    const hx = _v2.set(this.p[12 * 3] - this.p[9 * 3], this.p[12 * 3 + 1] - this.p[9 * 3 + 1], this.p[12 * 3 + 2] - this.p[9 * 3 + 2]);
    if (hx.lengthSq() < 1e-8) hx.set(1, 0, 0);
    hx.normalize();
    // bassin : position = point 2, axe Y vers le cou
    _Y.set(this.p[3] - this.p[6], this.p[4] - this.p[7], this.p[5] - this.p[8]);
    if (_Y.lengthSq() < 1e-8) _Y.set(0, 1, 0);
    _Y.normalize();
    const up = _v3.copy(_Y);
    _Z.crossVectors(hx, _Y).normalize(); _X.crossVectors(_Y, _Z);
    _m.makeBasis(_X, _Y, _Z);
    bones[B.HIPS].quaternion.setFromRotationMatrix(_m);
    bones[B.HIPS].position.set(this.p[6], this.p[7], this.p[8]);
    bones[B.HIPS].scale.setScalar(sc);
    // colonne
    _Z.crossVectors(tx, up).normalize(); _X.crossVectors(up, _Z);
    _m.makeBasis(_X, up, _Z);
    bones[B.SPINE].quaternion.setFromRotationMatrix(_m);
    bones[B.SPINE].position.set(this.p[6] + up.x * 0.15 * sc, this.p[7] + up.y * 0.15 * sc, this.p[8] + up.z * 0.15 * sc);
    bones[B.SPINE].scale.setScalar(sc);
    // tête
    if (this.severed & SEVER.HEAD) {
      bones[B.HEAD].quaternion.copy(this.headSpin);
      _P.set(0, -0.14 * sc, 0).applyQuaternion(this.headSpin);
      bones[B.HEAD].position.set(this.p[0] + _P.x, this.p[1] + _P.y, this.p[2] + _P.z);
      bones[B.HEAD].scale.setScalar(sc);
    } else {
      _Y.set(this.p[0] - this.p[19 * 3], this.p[1] - this.p[19 * 3 + 1], this.p[2] - this.p[19 * 3 + 2]);
      if (_Y.lengthSq() < 1e-8) _Y.copy(up);
      _Y.normalize();
      _Z.crossVectors(tx, _Y).normalize(); _X.crossVectors(_Y, _Z);
      _m.makeBasis(_X, _Y, _Z);
      bones[B.HEAD].quaternion.setFromRotationMatrix(_m);
      bones[B.HEAD].position.set(this.p[19 * 3] + _Y.x * 0.05 * sc, this.p[19 * 3 + 1] + _Y.y * 0.05 * sc, this.p[19 * 3 + 2] + _Y.z * 0.05 * sc);
      bones[B.HEAD].scale.setScalar(sc);
    }
    // membres
    this._limb(B.ARM_LU, 15, 4, tx); this._limb(B.ARM_LL, 4, 5, tx);
    this._limb(B.ARM_RU, 16, 7, tx); this._limb(B.ARM_RL, 7, 8, tx);
    this._limb(B.LEG_LU, 17, 10, hx); this._limb(B.LEG_LL, 10, 11, hx);
    this._limb(B.LEG_RU, 18, 13, hx); this._limb(B.LEG_RL, 13, 14, hx);
  }

  /** Centre approximatif du corps (pour la mare de sang, la caméra de mort). */
  center(out) { return out.set(this.p[6], this.p[7], this.p[8]); }
  point(i, out) { return this._pt(i, out); }
  /** Direction « vers le haut » du torse (jet de sang d'un cou tranché). */
  torsoUp(out) { return out.set(this.p[3] - this.p[6], this.p[4] - this.p[7], this.p[5] - this.p[8]).normalize(); }
}
