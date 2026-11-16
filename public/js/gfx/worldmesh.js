// Construction du décor : maillages fusionnés par matériau, occlusion ambiante précalculée par sommet,
// ciel procédural, soleil, lampes, sol lointain.

import * as THREE from 'three';
import { BF, MAT } from '../../shared/constants.js';
import { makeHit } from '../../shared/world.js';
import { worldMaterial, materialTile } from './textures.js';

const CELL = 2.4;            // taille maximale d'une maille (finesse de l'occlusion ambiante)
const _hit = makeHit();

// 8 directions réparties sur l'hémisphère (x, y tangents ; z = normale), pondération cosinus
const HEMI = [];
for (let i = 0; i < 8; i++) {
  const el = i < 4 ? 0.42 : 1.02;                      // élévation au-dessus de la surface
  const az = (i % 4) * (Math.PI / 2) + (i < 4 ? 0.4 : 1.2);
  HEMI.push([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]);
}
// 5 directions vers le ciel
const SKYDIR = [[0, 1, 0], [0.64, 0.77, 0], [-0.64, 0.77, 0], [0, 0.77, 0.64], [0, 0.77, -0.64]];

const pause = () => new Promise((r) => setTimeout(r, 0));

/**
 * Construit le décor statique d'une carte.
 * @param onProgress (fraction 0..1) appelé régulièrement
 * @returns {Promise<THREE.Group>}
 */
export async function buildWorldMesh(map, world, quality, onProgress) {
  const group = new THREE.Group();
  group.name = 'world';
  const buckets = new Map();
  const bucket = (mat, shadow, emissive) => {
    const key = `${mat}|${shadow ? 1 : 0}|${emissive ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) { b = { mat, shadow, emissive, pos: [], nrm: [], uv: [], col: [], idx: [], n: 0 }; buckets.set(key, b); }
    return b;
  };
  const bounds = map.bounds;
  const aoMargin = 14;
  const doAO = quality !== 'low';
  const c = new THREE.Color();
  let lastYield = performance.now();

  const ao = (px, py, pz, axis, sign, cu, cv, ua, va) => {
    // origine décollée de la surface et tirée vers le centre de la face
    const o = [px, py, pz];
    o[axis] += sign * 0.05;
    o[ua] += Math.sign(cu - o[ua]) * 0.06;
    o[va] += Math.sign(cv - o[va]) * 0.06;
    let occ = 0;
    const d = [0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const h = HEMI[i];
      d[ua] = h[0]; d[va] = h[1]; d[axis] = h[2] * sign;
      if (world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 2.8, _hit)) occ += 1 - _hit.t / 2.8;
    }
    occ /= 8;
    let sky = 0;
    for (let i = 0; i < 5; i++) {
      const s = SKYDIR[i];
      if (!world.raycast(o[0], o[1] + 0.08, o[2], s[0], s[1], s[2], 45, _hit)) sky++;
    }
    sky /= 5;
    return (0.4 + 0.6 * Math.pow(1 - occ, 1.3)) * (0.6 + 0.4 * sky);
  };

  const total = map.boxes.length;
  for (let bi = 0; bi < total; bi++) {
    const box = map.boxes[bi];
    if (box.flags & BF.INVISIBLE) continue;
    const emissive = (box.flags & BF.EMISSIVE) !== 0;
    const b = bucket(box.mat, !(box.flags & BF.NOSHADOW), emissive);
    const tile = materialTile(box.mat);
    if (box.color) c.setHex(box.color, THREE.SRGBColorSpace); else c.setRGB(1, 1, 1);
    const gain = emissive ? 3.2 : 1;
    const mn = box.min, mx = box.max;
    const isGround = bi === 0;
    for (let axis = 0; axis < 3; axis++) {
      for (let s = -1; s <= 1; s += 2) {
        if (axis === 1 && s < 0 && mn[1] <= 0.001) continue;      // dessous posé au sol
        if (isGround && !(axis === 1 && s > 0)) continue;
        const ua = axis === 0 ? 2 : 0, va = axis === 1 ? 2 : 1;
        const u0 = mn[ua], u1 = mx[ua], v0 = mn[va], v1 = mx[va];
        const coord = s > 0 ? mx[axis] : mn[axis];
        const nu = Math.min(72, Math.max(1, Math.ceil((u1 - u0) / CELL)));
        const nv = Math.min(72, Math.max(1, Math.ceil((v1 - v0) / CELL)));
        const base = b.n;
        const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
        const p = [0, 0, 0];
        for (let j = 0; j <= nv; j++) {
          for (let i = 0; i <= nu; i++) {
            const u = u0 + (u1 - u0) * (i / nu), v = v0 + (v1 - v0) * (j / nv);
            p[axis] = coord; p[ua] = u; p[va] = v;
            b.pos.push(p[0], p[1], p[2]);
            b.nrm.push(axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0);
            b.uv.push(u / tile, v / tile);
            let k = 1;
            if (doAO && !emissive
              && p[0] > bounds.minX - aoMargin && p[0] < bounds.maxX + aoMargin && p[2] > bounds.minZ - aoMargin && p[2] < bounds.maxZ + aoMargin) {
              k = ao(p[0], p[1], p[2], axis, s, cu, cv, ua, va);
            } else if (!emissive) k = 0.86;
            b.col.push(c.r * k * gain, c.g * k * gain, c.b * k * gain);
            b.n++;
          }
        }
        // U × V vaut -X, -Y, +Z selon l'axe : on inverse l'ordre des triangles quand il s'oppose à la normale
        const flip = (axis === 2) ? s < 0 : s > 0;
        for (let j = 0; j < nv; j++) {
          for (let i = 0; i < nu; i++) {
            const a = base + j * (nu + 1) + i, bb = a + 1, d = a + (nu + 1), e = d + 1;
            if (flip) b.idx.push(a, d, bb, bb, d, e); else b.idx.push(a, bb, d, bb, e, d);
          }
        }
      }
    }
    if (performance.now() - lastYield > 14) {
      if (onProgress) onProgress(bi / total);
      await pause();
      lastYield = performance.now();
    }
  }

  for (const b of buckets.values()) {
    if (!b.n) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.n > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
    g.computeBoundingSphere();
    let material;
    if (b.emissive) material = glowMaterial();
    else material = worldMaterial(b.mat);
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = b.shadow && !b.emissive;
    mesh.receiveShadow = !b.emissive;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // sol lointain (au-delà de la boîte de sol de la carte)
  const gm = worldMaterial(map.env.ground === undefined ? MAT.ASPHALT : map.env.ground);
  const far = new THREE.PlaneGeometry(3000, 3000, 1, 1);
  far.rotateX(-Math.PI / 2);
  const tile = materialTile(map.env.ground);
  const uv = far.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3000 / tile, uv.getY(i) * 3000 / tile);
  far.setAttribute('color', new THREE.Float32BufferAttribute(new Array(uv.count * 3).fill(0.86), 3));
  const farMesh = new THREE.Mesh(far, gm);
  farMesh.position.y = -0.03;
  farMesh.receiveShadow = false;
  group.add(farMesh);

  if (onProgress) onProgress(1);
  return group;
}

let _glow = null;
function glowMaterial() {
  if (!_glow) _glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  return _glow;
}

// ---------------------------------------------------------------------------------------------
// Ciel
// ---------------------------------------------------------------------------------------------

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 0.0);     // suit la caméra : rotation seule
  gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
  gl_Position.z = gl_Position.w;                      // toujours au fond
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform vec3 uCloudColor; uniform float uCloud; uniform float uTime; uniform float uGain;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += noise(p) * a; p = p * 2.03 + vec2(13.1, 7.7); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uBottom, smoothstep(0.0, -0.12, h));
  float sd = max(dot(d, uSunDir), 0.0);
  // halo et disque solaire
  col += uSunColor * (pow(sd, 8.0) * 0.22 + pow(sd, 64.0) * 0.5);
  col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 12.0;
  // nuages : bruit fractal projeté sur un plan
  if (h > 0.01 && uCloud > 0.0) {
    vec2 uv = d.xz / (h + 0.22) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float cov = smoothstep(1.0 - uCloud * 0.85, 1.05 - uCloud * 0.35, n + 0.25);
    float lit = 0.55 + 0.6 * pow(sd, 3.0) + 0.25 * fbm(uv * 2.7 + 4.0);
    vec3 cc = mix(uHorizon * 0.9, uCloudColor, 0.75) * lit;
    col = mix(col, cc, cov * smoothstep(0.01, 0.16, h) * 0.9);
  }
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

export function makeSky(env) {
  const col = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  const sunDir = sunDirection(env);
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    uniforms: {
      uTop: { value: col(env.skyTop) }, uHorizon: { value: col(env.skyHorizon) }, uBottom: { value: col(env.skyBottom) },
      uSunDir: { value: sunDir }, uSunColor: { value: col(env.sunColor) }, uCloudColor: { value: col(env.cloudColor || 0xffffff) },
      uCloud: { value: env.cloud || 0 }, uTime: { value: 0 }, uGain: { value: 1.25 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return mesh;
}

/** Direction VERS le soleil. Azimut 0 = nord (-Z), 90 = est (+X). */
export function sunDirection(env) {
  const az = (env.sunAzimuth || 0) * Math.PI / 180, el = (env.sunElevation || 45) * Math.PI / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

/**
 * Éclairage d'une carte : soleil (avec ombres), lumière d'ambiance, lampes ponctuelles.
 * @returns {{sun, hemi, lights, update(camPos)}}
 */
export function makeLighting(scene, map, quality) {
  const env = map.env;
  const dir = sunDirection(env);
  const sun = new THREE.DirectionalLight(new THREE.Color().setHex(env.sunColor, THREE.SRGBColorSpace), env.sunIntensity);
  sun.position.copy(dir).multiplyScalar(120);
  const shadowSize = { low: 0, medium: 1024, high: 2048, ultra: 4096 }[quality] || 2048;
  const range = 46;
  if (shadowSize) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const cam = sun.shadow.camera;
    cam.left = -range; cam.right = range; cam.top = range; cam.bottom = -range; cam.near = 1; cam.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.045;
    sun.shadow.radius = quality === 'medium' ? 1.5 : 2.2;
  }
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(
    new THREE.Color().setHex(env.hemiSky, THREE.SRGBColorSpace),
    new THREE.Color().setHex(env.hemiGround, THREE.SRGBColorSpace), env.hemiIntensity);
  scene.add(hemi);

  const lights = [];
  const maxLights = { low: 0, medium: 3, high: 6, ultra: 12 }[quality] || 0;
  for (let i = 0; i < map.lights.length && i < maxLights; i++) {
    const L = map.lights[i];
    const p = new THREE.PointLight(new THREE.Color().setHex(L.color, THREE.SRGBColorSpace), L.intensity * 60, L.range, 1.8);
    p.position.set(L.x, L.y, L.z);
    scene.add(p);
    lights.push(p);
  }

  const texel = (range * 2) / (shadowSize || 1);
  const tmp = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  // base orthonormée du plan de l'ombre, pour caler la caméra d'ombre sur sa grille de texels
  right.crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  up.crossVectors(dir, right).normalize();
  return {
    sun, hemi, lights, dir,
    /** Recentre la zone d'ombre autour de la caméra (sans scintillement). */
    update(camPos, camDir) {
      if (!shadowSize) return;
      tmp.copy(camPos).addScaledVector(camDir, range * 0.45);
      tmp.y = 0;
      const r = Math.round(tmp.dot(right) / texel) * texel, u = Math.round(tmp.dot(up) / texel) * texel, f = tmp.dot(dir);
      tmp.copy(right).multiplyScalar(r).addScaledVector(up, u).addScaledVector(dir, f);
      sun.target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(dir, 150);
      sun.target.updateMatrixWorld();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Objets de carte : barils et objets à ramasser
// ---------------------------------------------------------------------------------------------

let _barrelGeo = null, _barrelMat = null, _barrelDead = null;
export function makeBarrel() {
  if (!_barrelGeo) {
    _barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.95, 14, 3);
    _barrelGeo.translate(0, 0.475, 0);
    const col = new Float32Array(_barrelGeo.attributes.position.count * 3);
    const pos = _barrelGeo.attributes.position;
    const red = new THREE.Color().setHex(0xb3261e, THREE.SRGBColorSpace), band = new THREE.Color().setHex(0xd9c23a, THREE.SRGBColorSpace);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const cc = (y > 0.3 && y < 0.66) ? band : red;
      col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
    }
    _barrelGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    _barrelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 });
    _barrelDead = new THREE.MeshStandardMaterial({ color: 0x151310, roughness: 0.95, metalness: 0.3 });
  }
  const mesh = new THREE.Mesh(_barrelGeo, _barrelMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.setAlive = (alive) => {
    mesh.material = alive ? _barrelMat : _barrelDead;
    mesh.scale.set(alive ? 1 : 1.12, alive ? 1 : 0.55, alive ? 1 : 1.05);
    mesh.rotation.z = alive ? 0 : 0.12;
  };
  return mesh;
}

const PICKUP_COLORS = { health: 0x3fe07a, armor: 0x4aa3ff, ammo: 0xffc440, grenade: 0xff7a3a, rpg: 0xff3a4a };
const _pickupGeo = {};
function pickupGeometry(type) {
  if (_pickupGeo[type]) return _pickupGeo[type];
  let g;
  if (type === 'health') {
    const a = new THREE.BoxGeometry(0.34, 0.12, 0.12), b = new THREE.BoxGeometry(0.12, 0.34, 0.12);
    g = mergeSimple([a, b]);
  } else if (type === 'armor') {
    const a = new THREE.BoxGeometry(0.34, 0.36, 0.12), b = new THREE.BoxGeometry(0.1, 0.12, 0.12), c2 = b.clone();
    b.translate(-0.12, 0.24, 0); c2.translate(0.12, 0.24, 0);
    g = mergeSimple([a, b, c2]);
  } else if (type === 'ammo') {
    const a = new THREE.BoxGeometry(0.36, 0.22, 0.2), b = new THREE.BoxGeometry(0.3, 0.05, 0.05);
    b.translate(0, 0.14, 0);
    g = mergeSimple([a, b]);
  } else if (type === 'grenade') {
    const a = new THREE.SphereGeometry(0.13, 10, 8), b = new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8);
    b.translate(0, 0.16, 0);
    g = mergeSimple([a, b]);
  } else {
    const a = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), b = new THREE.ConeGeometry(0.1, 0.22, 10);
    a.rotateZ(Math.PI / 2); b.rotateZ(-Math.PI / 2); b.translate(0.42, 0, 0);
    g = mergeSimple([a, b]);
  }
  _pickupGeo[type] = g;
  return g;
}

/** Fusionne des géométries indexées simples (position + normale). */
export function mergeSimple(list) {
  const pos = [], nrm = [], idx = [];
  let base = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

const _pickupMat = {};
let _ringGeo = null;
export function makePickup(type) {
  const hex = PICKUP_COLORS[type] || 0xffffff;
  if (!_pickupMat[type]) {
    const col = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
    _pickupMat[type] = {
      body: new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.2 }),
      ring: new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    };
  }
  if (!_ringGeo) { _ringGeo = new THREE.RingGeometry(0.34, 0.42, 28); _ringGeo.rotateX(-Math.PI / 2); }
  const g = new THREE.Group();
  const body = new THREE.Mesh(pickupGeometry(type), _pickupMat[type].body);
  body.position.y = 0.62;
  body.castShadow = true;
  const ring = new THREE.Mesh(_ringGeo, _pickupMat[type].ring);
  ring.position.y = 0.03;
  g.add(body, ring);
  g.userData.body = body;
  g.userData.ring = ring;
  g.userData.phase = Math.random() * 6.28;
  return g;
}
