// Modèles d'armes générés par code, pour la vue subjective (détaillée, pièces mobiles)
// et pour les personnages vus de l'extérieur (une seule géométrie fusionnée).

import * as THREE from 'three';
import { W } from '../../shared/weapons.js';

const COL = {
  steel: 0x34383e, dark: 0x1b1d20, black: 0x111214, tan: 0x8a7a5c, wood: 0x6e4627, olive: 0x4c5439,
  bright: 0xa3a9b1, lens: 0x2f5f86, red: 0xb3261e, brass: 0xb8923a, skin: 0xc59877, glove: 0x1a1b1d, dot: 0xff2a1a,
};

// Pièce : ['b', l, h, p, x, y, z, couleur, groupe?, rotX?]  (boîte)
//         ['c', rayon, longueur, x, y, z, couleur, groupe?, axe?] (cylindre, le long de Z par défaut)
//         ['cone', rayon, longueur, x, y, z, couleur, groupe?]
// Repère : origine à la poignée, canon vers -Z, +Y vers le haut, +X à droite.
const MODELS = {
  [W.AR]: {
    hold: 'rifle', muzzle: [0, 0.045, -0.7], eject: [0.03, 0.05, -0.06], sightY: 0.102, magZ: -0.1,
    parts: [
      ['b', 0.045, 0.065, 0.25, 0, 0.035, -0.06, 'steel'],
      ['b', 0.05, 0.055, 0.27, 0, 0.04, -0.32, 'black'],
      ['b', 0.014, 0.012, 0.52, 0, 0.074, -0.19, 'dark'],
      ['c', 0.011, 0.2, 0, 0.045, -0.55, 'steel'],
      ['c', 0.017, 0.06, 0, 0.045, -0.67, 'dark'],
      ['b', 0.038, 0.055, 0.2, 0, 0.03, 0.16, 'black'],
      ['b', 0.042, 0.11, 0.035, 0, 0.005, 0.275, 'dark'],
      ['b', 0.034, 0.1, 0.045, 0, -0.045, 0.02, 'black', 'body', 0.28],
      ['b', 0.028, 0.15, 0.06, 0, -0.075, -0.1, 'dark', 'mag', 0.14],
      ['b', 0.004, 0.04, 0.06, -0.018, 0.102, -0.05, 'black'],
      ['b', 0.004, 0.04, 0.06, 0.018, 0.102, -0.05, 'black'],
      ['b', 0.04, 0.004, 0.06, 0, 0.123, -0.05, 'black'],
      ['b', 0.04, 0.01, 0.07, 0, 0.081, -0.05, 'black'],
      ['b', 0.0022, 0.0022, 0.002, 0, 0.102, -0.078, 'dot'],
      ['b', 0.006, 0.035, 0.012, 0, 0.092, -0.43, 'steel'],
      ['b', 0.012, 0.014, 0.05, 0.028, 0.05, -0.04, 'bright', 'bolt'],
      ['b', 0.01, 0.028, 0.03, 0, -0.012, -0.02, 'steel'],
    ],
  },
  [W.SMG]: {
    hold: 'rifle', muzzle: [0, 0.035, -0.46], eject: [0.028, 0.045, -0.03], sightY: 0.09, magZ: -0.07, short: true,
    parts: [
      ['b', 0.042, 0.06, 0.22, 0, 0.03, -0.05, 'dark'],
      ['b', 0.04, 0.045, 0.12, 0, 0.03, -0.22, 'black'],
      ['c', 0.012, 0.08, 0, 0.035, -0.32, 'steel'],
      ['c', 0.021, 0.1, 0, 0.035, -0.4, 'dark'],
      ['b', 0.026, 0.2, 0.04, 0, -0.1, -0.07, 'dark', 'mag', 0.05],
      ['b', 0.032, 0.09, 0.042, 0, -0.045, 0.03, 'black', 'body', 0.25],
      ['b', 0.012, 0.025, 0.2, 0, 0.045, 0.16, 'steel'],
      ['b', 0.035, 0.08, 0.02, 0, 0.02, 0.26, 'black'],
      ['b', 0.032, 0.008, 0.04, 0, 0.063, -0.03, 'black'],
      ['b', 0.008, 0.03, 0.03, -0.012, 0.08, -0.03, 'black'],
      ['b', 0.008, 0.03, 0.03, 0.012, 0.08, -0.03, 'black'],
      ['b', 0.006, 0.034, 0.01, 0, 0.076, -0.24, 'steel'],
      ['b', 0.03, 0.07, 0.03, 0, -0.03, -0.2, 'black'],
      ['b', 0.01, 0.012, 0.04, 0.026, 0.04, -0.03, 'bright', 'bolt'],
    ],
  },
  [W.SHOTGUN]: {
    hold: 'rifle', muzzle: [0, 0.05, -0.69], eject: [0.03, 0.04, -0.04], sightY: 0.083, magZ: -0.1,
    parts: [
      ['b', 0.045, 0.07, 0.24, 0, 0.03, -0.04, 'steel'],
      ['c', 0.014, 0.52, 0, 0.05, -0.42, 'steel'],
      ['c', 0.013, 0.42, 0, 0.018, -0.37, 'dark'],
      ['b', 0.05, 0.05, 0.17, 0, 0.018, -0.34, 'wood', 'pump'],
      ['b', 0.04, 0.07, 0.26, 0, 0.005, 0.2, 'wood', 'body', -0.12],
      ['b', 0.034, 0.09, 0.04, 0, -0.04, 0.03, 'wood', 'body', 0.3],
      ['b', 0.006, 0.02, 0.01, 0, 0.073, -0.66, 'bright'],
      ['b', 0.01, 0.028, 0.03, 0, -0.012, -0.02, 'steel'],
    ],
  },
  [W.SNIPER]: {
    hold: 'rifle', muzzle: [0, 0.045, -1.05], eject: [0.03, 0.05, -0.04], sightY: 0.115, magZ: -0.1,
    parts: [
      ['b', 0.042, 0.06, 0.3, 0, 0.03, -0.08, 'olive'],
      ['b', 0.046, 0.06, 0.34, 0, 0.015, -0.36, 'olive'],
      ['c', 0.012, 0.52, 0, 0.045, -0.72, 'steel'],
      ['c', 0.02, 0.09, 0, 0.045, -1.0, 'dark'],
      ['b', 0.04, 0.08, 0.3, 0, 0.015, 0.22, 'olive', 'body', -0.06],
      ['b', 0.044, 0.13, 0.03, 0, 0.005, 0.38, 'dark'],
      ['b', 0.03, 0.03, 0.14, 0, 0.075, 0.2, 'dark'],
      ['b', 0.034, 0.09, 0.045, 0, -0.045, 0.02, 'black', 'body', 0.25],
      ['b', 0.028, 0.09, 0.07, 0, -0.05, -0.1, 'dark', 'mag'],
      ['c', 0.024, 0.3, 0, 0.115, -0.1, 'black'],
      ['c', 0.032, 0.07, 0, 0.115, -0.27, 'black'],
      ['c', 0.029, 0.05, 0, 0.115, 0.06, 'black'],
      ['c', 0.027, 0.006, 0, 0.115, -0.307, 'lens'],
      ['b', 0.014, 0.03, 0.03, 0, 0.085, -0.03, 'steel'],
      ['b', 0.014, 0.03, 0.03, 0, 0.085, -0.17, 'steel'],
      ['c', 0.008, 0.06, 0.045, 0.05, -0.02, 'bright', 'bolt', 'x'],
      ['b', 0.02, 0.02, 0.02, 0.078, 0.05, -0.02, 'bright', 'bolt'],
      ['b', 0.008, 0.16, 0.012, -0.02, -0.08, -0.47, 'steel'],
      ['b', 0.008, 0.16, 0.012, 0.02, -0.08, -0.47, 'steel'],
    ],
  },
  [W.LMG]: {
    hold: 'rifle', muzzle: [0, 0.045, -0.81], eject: [0.035, 0.03, -0.06], sightY: 0.122, magZ: -0.1,
    parts: [
      ['b', 0.055, 0.08, 0.34, 0, 0.035, -0.08, 'steel'],
      ['b', 0.06, 0.02, 0.22, 0, 0.085, -0.08, 'dark'],
      ['b', 0.05, 0.05, 0.2, 0, 0.03, -0.35, 'black'],
      ['c', 0.014, 0.3, 0, 0.045, -0.6, 'steel'],
      ['c', 0.019, 0.05, 0, 0.045, -0.78, 'dark'],
      ['b', 0.014, 0.028, 0.14, 0, 0.099, -0.3, 'steel'],
      ['b', 0.1, 0.11, 0.13, -0.005, -0.06, -0.1, 'olive', 'mag'],
      ['b', 0.04, 0.07, 0.26, 0, 0.02, 0.22, 'black'],
      ['b', 0.046, 0.12, 0.03, 0, 0.0, 0.36, 'dark'],
      ['b', 0.034, 0.09, 0.045, 0, -0.045, 0.03, 'black', 'body', 0.25],
      ['b', 0.008, 0.2, 0.012, -0.03, -0.07, -0.55, 'steel', 'body', 0.25],
      ['b', 0.008, 0.2, 0.012, 0.03, -0.07, -0.55, 'steel', 'body', 0.25],
      ['b', 0.006, 0.04, 0.012, 0, 0.105, -0.44, 'steel'],
      ['b', 0.008, 0.028, 0.02, -0.012, 0.11, 0.02, 'dark'],
      ['b', 0.008, 0.028, 0.02, 0.012, 0.11, 0.02, 'dark'],
      ['b', 0.012, 0.014, 0.05, 0.034, 0.05, -0.02, 'bright', 'bolt'],
    ],
  },
  [W.RPG]: {
    hold: 'rifle', muzzle: [0, 0.09, -0.92], eject: [0, 0.09, 0.5], sightY: 0.2, magZ: -0.6, shoulder: true,
    parts: [
      ['c', 0.042, 0.95, 0, 0.09, -0.1, 'olive'],
      ['c', 0.056, 0.14, 0, 0.09, 0.42, 'dark'],
      ['c', 0.05, 0.06, 0, 0.09, -0.56, 'dark'],
      ['b', 0.03, 0.09, 0.04, 0, -0.02, 0.02, 'black', 'body', 0.2],
      ['b', 0.03, 0.08, 0.035, 0, -0.01, -0.22, 'black'],
      ['b', 0.02, 0.07, 0.08, -0.055, 0.15, -0.1, 'black'],
      ['c', 0.038, 0.2, 0, 0.09, -0.67, 'olive', 'mag'],
      ['cone', 0.052, 0.17, 0, 0.09, -0.85, 'dark', 'mag'],
    ],
  },
  [W.PISTOL]: {
    hold: 'pistol', muzzle: [0, 0.055, -0.2], eject: [0.02, 0.07, -0.03], sightY: 0.086, magZ: 0.01,
    parts: [
      ['b', 0.028, 0.036, 0.19, 0, 0.055, -0.07, 'steel', 'bolt'],
      ['b', 0.026, 0.03, 0.15, 0, 0.025, -0.05, 'dark'],
      ['b', 0.028, 0.1, 0.045, 0, -0.035, 0.015, 'black', 'body', 0.2],
      ['b', 0.022, 0.03, 0.04, 0, -0.09, 0.012, 'dark', 'mag'],
      ['c', 0.007, 0.03, 0, 0.055, -0.175, 'dark'],
      ['b', 0.004, 0.012, 0.006, 0, 0.079, -0.155, 'bright', 'bolt'],
      ['b', 0.016, 0.012, 0.006, 0, 0.079, 0.015, 'dark', 'bolt'],
      ['b', 0.008, 0.025, 0.03, 0, 0.0, -0.03, 'dark'],
    ],
  },
  [W.KNIFE]: {
    hold: 'knife', muzzle: [0, 0.03, -0.28], eject: [0, 0, 0], sightY: 0.05, magZ: 0,
    parts: [
      ['b', 0.004, 0.036, 0.2, 0, 0.03, -0.17, 'bright'],
      ['b', 0.006, 0.02, 0.2, 0, 0.012, -0.165, 'steel'],
      ['b', 0.012, 0.05, 0.014, 0, 0.03, -0.06, 'dark'],
      ['b', 0.024, 0.03, 0.11, 0, 0.03, 0.0, 'black'],
    ],
  },
  [W.MINIGUN]: {
    hold: 'hip', muzzle: [0, 0, -0.74], eject: [0.08, -0.05, -0.05], sightY: 0.1, magZ: -0.05,
    parts: [
      ['c', 0.06, 0.5, 0, 0.0, -0.45, 'steel'],
      ['c', 0.075, 0.06, 0, 0, -0.7, 'dark'],
      ['c', 0.07, 0.04, 0, 0, -0.3, 'dark'],
      ['b', 0.14, 0.16, 0.3, 0, 0, -0.05, 'dark'],
      ['b', 0.16, 0.2, 0.16, -0.02, -0.17, -0.02, 'olive', 'mag'],
      ['b', 0.03, 0.03, 0.2, 0, 0.11, -0.05, 'steel'],
      ['b', 0.03, 0.09, 0.04, 0.0, 0.14, 0.02, 'black'],
    ],
  },
};

/** Poses de tenue vues de l'extérieur (repère de la colonne). */
export const WEAPON_HOLD = {
  rifle: { pivot: [0.1, 0.3, -0.05], grip: [0.03, -0.07, -0.22], right: [0, -0.03, 0.02], left: [-0.03, 0.0, -0.3], magZ: -0.1, muzzle: [0, 0.045, -0.7] },
  pistol: { pivot: [0.0, 0.33, -0.1], grip: [0.0, -0.02, -0.4], right: [0.01, -0.03, 0.02], left: [-0.035, -0.045, 0.02], magZ: 0.0, muzzle: [0, 0.055, -0.2] },
  knife: { pivot: [0.2, 0.18, -0.05], grip: [0.0, -0.1, -0.3], right: [0, 0, 0], left: [-0.3, -0.2, 0], magZ: 0, muzzle: [0, 0.03, -0.28], oneHand: true },
  hip: { pivot: [0.16, -0.02, 0.0], grip: [0.0, -0.08, -0.14], right: [0.0, 0.14, 0.02], left: [-0.05, 0.1, -0.3], magZ: -0.05, muzzle: [0, 0, -0.74] },
};

let _gunMat = null;
function gunMaterial() {
  if (!_gunMat) _gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.55 });
  return _gunMat;
}
let _armMat = null;
function armMaterial() {
  if (!_armMat) _armMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 });
  return _armMat;
}

const _c = new THREE.Color();

/** Ajoute une pièce à un accumulateur {pos, nrm, col, idx}. */
function pushPart(acc, part) {
  let geo, hex, rx = 0;
  if (part[0] === 'b') {
    geo = new THREE.BoxGeometry(part[1], part[2], part[3]);
    rx = part[9] || 0;
    if (rx) geo.rotateX(rx);
    geo.translate(part[4], part[5], part[6]);
    hex = COL[part[7]];
  } else if (part[0] === 'c') {
    geo = new THREE.CylinderGeometry(part[1], part[1], part[2], 12, 1);
    if (part[8] === 'x') geo.rotateZ(Math.PI / 2); else geo.rotateX(Math.PI / 2);
    geo.translate(part[3], part[4], part[5]);
    hex = COL[part[6]];
  } else {
    geo = new THREE.ConeGeometry(part[1], part[2], 12, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(part[3], part[4], part[5]);
    hex = COL[part[6]];
  }
  appendGeo(acc, geo, hex);
}

function appendGeo(acc, geo, hex) {
  _c.setHex(hex, THREE.SRGBColorSpace);
  if (hex === COL.dot) _c.multiplyScalar(14);
  const p = geo.attributes.position, n = geo.attributes.normal;
  const base = acc.pos.length / 3;
  for (let i = 0; i < p.count; i++) {
    acc.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    acc.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    acc.col.push(_c.r, _c.g, _c.b);
  }
  for (let i = 0; i < geo.index.count; i++) acc.idx.push(geo.index.getX(i) + base);
  geo.dispose();
}

function finish(acc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(acc.col, 3));
  g.setIndex(acc.idx);
  return g;
}
const newAcc = () => ({ pos: [], nrm: [], col: [], idx: [] });
const groupOf = (part) => (part[0] === 'b' ? part[8] : part[7]) || 'body';

const lowCache = new Map();

/** Arme simplifiée pour un personnage vu de l'extérieur. */
export function buildWeaponLow(id) {
  const model = MODELS[id] || MODELS[W.AR];
  let geo = lowCache.get(id);
  if (!geo) {
    const acc = newAcc();
    for (const part of model.parts) pushPart(acc, part);
    geo = finish(acc);
    lowCache.set(id, geo);
  }
  const mesh = new THREE.Mesh(geo, gunMaterial());
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  const base = WEAPON_HOLD[model.hold];
  const hold = { ...base, muzzle: model.muzzle, magZ: model.magZ };
  if (model.short) hold.left = [-0.03, -0.01, -0.2];
  if (model.shoulder) { hold.pivot = [0.16, 0.36, 0.0]; hold.grip = [0.0, -0.08, -0.12]; hold.left = [-0.03, 0.01, -0.22]; }
  return { group, hold };
}

/** Boîte orientée entre deux points (manche, avant-bras). */
function limbGeo(a, b, t) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.BoxGeometry(t, len, t * 1.05);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/**
 * Arme détaillée pour la vue subjective : pièces mobiles séparées + bras.
 * @returns {{group, parts:{body,mag,bolt,pump}, armL, model}}
 */
export function buildWeaponView(id, sleeveHex = 0x4c5439) {
  const model = MODELS[id] || MODELS[W.AR];
  const accs = {};
  for (const part of model.parts) {
    const g = groupOf(part);
    if (!accs[g]) accs[g] = newAcc();
    pushPart(accs[g], part);
  }
  const group = new THREE.Group();
  const parts = {};
  for (const [name, acc] of Object.entries(accs)) {
    const mesh = new THREE.Mesh(finish(acc), gunMaterial());
    mesh.frustumCulled = false;
    const holder = new THREE.Group();
    holder.add(mesh);
    group.add(holder);
    parts[name] = holder;
  }
  // --- bras : manche + gant ; la main droite tient la poignée, la gauche le garde-main
  const mkArm = (from, hand) => {
    const acc = newAcc();
    appendGeo(acc, limbGeo(from, [hand[0] + (from[0] - hand[0]) * 0.22, hand[1] + (from[1] - hand[1]) * 0.22, hand[2] + (from[2] - hand[2]) * 0.22], 0.085), sleeveHex);
    appendGeo(acc, limbGeo([hand[0] + (from[0] - hand[0]) * 0.24, hand[1] + (from[1] - hand[1]) * 0.24, hand[2] + (from[2] - hand[2]) * 0.24], hand, 0.075), COL.glove);
    const g = new THREE.BoxGeometry(0.075, 0.07, 0.09);
    g.translate(hand[0], hand[1], hand[2]);
    appendGeo(acc, g, COL.glove);
    const mesh = new THREE.Mesh(finish(acc), armMaterial());
    mesh.frustumCulled = false;
    const holder = new THREE.Group();
    holder.add(mesh);
    return holder;
  };
  let armR, armL;
  if (model.hold === 'pistol') {
    armR = mkArm([0.14, -0.2, 0.42], [0.0, -0.045, 0.02]);
    armL = mkArm([-0.2, -0.22, 0.4], [-0.03, -0.06, 0.015]);
  } else if (model.hold === 'knife') {
    armR = mkArm([0.12, -0.2, 0.4], [0.0, 0.03, 0.02]);
    armL = new THREE.Group();
  } else if (model.shoulder) {
    armR = mkArm([0.16, -0.26, 0.38], [0.0, -0.035, 0.02]);
    armL = mkArm([-0.2, -0.3, 0.2], [-0.005, -0.045, -0.22]);
  } else {
    armR = mkArm([0.16, -0.24, 0.42], [0.0, -0.055, 0.025]);
    const lz = model.short ? -0.2 : model.parts === MODELS[W.SHOTGUN].parts ? -0.34 : -0.3;
    armL = mkArm([-0.22, -0.3, 0.16], [-0.005, model.short ? -0.05 : 0.0, lz]);
  }
  group.add(armR, armL);
  parts.armR = armR; parts.armL = armL;
  return { group, parts, model };
}

export function weaponModel(id) { return MODELS[id] || MODELS[W.AR]; }

// ---------------------------------------------------------------------------------------------
// Projectiles visibles
// ---------------------------------------------------------------------------------------------

let _nadeGeo = null, _rocketGeo = null;
export function makeGrenadeMesh() {
  if (!_nadeGeo) {
    const acc = newAcc();
    appendGeo(acc, new THREE.SphereGeometry(0.055, 10, 8), 0x3b4a2c);
    const top = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8); top.translate(0, 0.065, 0);
    appendGeo(acc, top, COL.dark);
    const lever = new THREE.BoxGeometry(0.012, 0.07, 0.02); lever.translate(0.03, 0.04, 0);
    appendGeo(acc, lever, COL.bright);
    _nadeGeo = finish(acc);
  }
  const m = new THREE.Mesh(_nadeGeo, gunMaterial());
  m.castShadow = true;
  return m;
}
export function makeRocketMesh() {
  if (!_rocketGeo) {
    const acc = newAcc();
    pushPart(acc, ['c', 0.038, 0.3, 0, 0, 0.05, 'olive']);
    pushPart(acc, ['cone', 0.052, 0.17, 0, 0, -0.18, 'dark']);
    pushPart(acc, ['b', 0.14, 0.004, 0.08, 0, 0, 0.18, 'dark']);
    pushPart(acc, ['b', 0.004, 0.14, 0.08, 0, 0, 0.18, 'dark']);
    _rocketGeo = finish(acc);
  }
  return new THREE.Mesh(_rocketGeo, gunMaterial());
}
