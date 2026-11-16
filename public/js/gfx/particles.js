// Système de particules : simulation sur le processeur (tableaux typés), rendu en un seul appel
// de dessin par système grâce à l'instanciation. Deux systèmes : fondu classique et additif.

import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3 aPos; attribute vec3 aVel; attribute vec4 aColor; attribute vec4 aData;   // taille, rotation, cellule, longueur d'étirement
uniform float uCells;
varying vec2 vUv; varying vec4 vColor; varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  vec2 corner = position.xy;
  vec2 off;
  if (aData.w > 0.0) {
    // particule étirée le long de sa vitesse (étincelle, traceur)
    vec3 vv = (modelViewMatrix * vec4(aVel, 0.0)).xyz;
    vec2 d = vv.xy;
    float l = length(d);
    d = l > 1e-5 ? d / l : vec2(0.0, 1.0);
    vec2 n = vec2(-d.y, d.x);
    // la longueur apparente diminue quand la particule file vers la caméra
    float along = aData.w * clamp(l / max(length(vv), 1e-5), 0.15, 1.0);
    off = n * corner.x * aData.x + d * corner.y * max(along, aData.x);
  } else {
    float c = cos(aData.y), s = sin(aData.y);
    off = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * aData.x;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float cell = floor(aData.z + 0.5);
  vUv = (vec2(mod(cell, uCells), floor(cell / uCells)) + uv) / uCells;
  vUv.y = 1.0 - vUv.y;
  vColor = aColor;
  vFog = -mv.z;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uAdditive;
varying vec2 vUv; varying vec4 vColor; varying float vFog;
void main() {
  float a = texture2D(uMap, vUv).a * vColor.a;
  if (a < 0.004) discard;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
  vec3 col = vColor.rgb;
  if (uAdditive > 0.5) gl_FragColor = vec4(col * a * (1.0 - f), 1.0);
  else gl_FragColor = vec4(mix(col, uFogColor, f), a);
}`;

export class Particles {
  /**
   * @param max       nombre maximal de particules
   * @param additive  mélange additif (feu, étincelles) ou fondu (fumée, sang)
   * @param atlas     texture d'atlas carrée (cells × cells)
   */
  constructor(max, additive, atlas, cells = 4) {
    this.max = max;
    this.n = 0;
    this.px = new Float32Array(max * 3); this.vx = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max); this.size1 = new Float32Array(max);
    this.rot = new Float32Array(max); this.rotVel = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.cell = new Float32Array(max); this.stretch = new Float32Array(max);
    this.floor = new Float32Array(max);          // hauteur de sol (collision) ; -1e9 = aucune
    this.tag = new Int32Array(max);              // donnée libre transmise à onLand
    this.fade = new Float32Array(max);           // exposant du fondu de sortie
    this.onLand = null;                           // (x, y, z, tag, taille) => void

    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    for (const a of [this.aPos, this.aVel, this.aColor, this.aData]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aVel', this.aVel);
    g.setAttribute('aColor', this.aColor); g.setAttribute('aData', this.aData);
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uMap: { value: atlas }, uCells: { value: cells }, uAdditive: { value: additive ? 1 : 0 },
        uFogColor: { value: new THREE.Color(0.5, 0.5, 0.5) }, uFogDensity: { value: 0.005 },
      },
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 21 : 20;
    this.geometry = g;
  }

  setFog(color, density) {
    this.material.uniforms.uFogColor.value.copy(color);
    this.material.uniforms.uFogDensity.value = density;
  }

  /**
   * Émet une particule.
   * o : {x,y,z, vx,vy,vz, life, size, size1, rot, rotVel, r,g,b,a, grav, drag, cell, stretch, floor, tag, fade}
   */
  spawn(o) {
    let i = this.n;
    if (i >= this.max) {
      // système plein : on recycle une particule au hasard plutôt que de perdre l'effet le plus récent
      i = Math.floor(Math.random() * this.max);
    } else this.n++;
    const k = i * 3;
    this.px[k] = o.x; this.px[k + 1] = o.y; this.px[k + 2] = o.z;
    this.vx[k] = o.vx || 0; this.vx[k + 1] = o.vy || 0; this.vx[k + 2] = o.vz || 0;
    this.life[i] = this.maxLife[i] = o.life;
    this.size0[i] = o.size; this.size1[i] = o.size1 === undefined ? o.size : o.size1;
    this.rot[i] = o.rot === undefined ? Math.random() * 6.283 : o.rot; this.rotVel[i] = o.rotVel || 0;
    const c = i * 4;
    this.col[c] = o.r; this.col[c + 1] = o.g; this.col[c + 2] = o.b; this.col[c + 3] = o.a === undefined ? 1 : o.a;
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0;
    this.cell[i] = o.cell || 0; this.stretch[i] = o.stretch || 0;
    this.floor[i] = o.floor === undefined ? -1e9 : o.floor;
    this.tag[i] = o.tag || 0;
    this.fade[i] = o.fade || 1;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    const k = i * 3, l = j * 3, c = i * 4, d = j * 4;
    this.px[k] = this.px[l]; this.px[k + 1] = this.px[l + 1]; this.px[k + 2] = this.px[l + 2];
    this.vx[k] = this.vx[l]; this.vx[k + 1] = this.vx[l + 1]; this.vx[k + 2] = this.vx[l + 2];
    this.col[c] = this.col[d]; this.col[c + 1] = this.col[d + 1]; this.col[c + 2] = this.col[d + 2]; this.col[c + 3] = this.col[d + 3];
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.size0[i] = this.size0[j]; this.size1[i] = this.size1[j];
    this.rot[i] = this.rot[j]; this.rotVel[i] = this.rotVel[j];
    this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
    this.cell[i] = this.cell[j]; this.stretch[i] = this.stretch[j];
    this.floor[i] = this.floor[j]; this.tag[i] = this.tag[j]; this.fade[i] = this.fade[j];
  }

  update(dt) {
    const px = this.px, vx = this.vx;
    const P = this.aPos.array, V = this.aVel.array, C = this.aColor.array, D = this.aData.array;
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      const k = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      vx[k] *= dr; vx[k + 1] = vx[k + 1] * dr - this.grav[i] * dt; vx[k + 2] *= dr;
      px[k] += vx[k] * dt; px[k + 1] += vx[k + 1] * dt; px[k + 2] += vx[k + 2] * dt;
      this.rot[i] += this.rotVel[i] * dt;
      if (px[k + 1] < this.floor[i]) {
        if (this.onLand) this.onLand(px[k], this.floor[i], px[k + 2], this.tag[i], this.size0[i]);
        this._kill(i);
      }
    }
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const k = i * 3, c = i * 4;
      const t = 1 - this.life[i] / this.maxLife[i];
      P[k] = px[k]; P[k + 1] = px[k + 1]; P[k + 2] = px[k + 2];
      V[k] = vx[k]; V[k + 1] = vx[k + 1]; V[k + 2] = vx[k + 2];
      const fadeIn = t < 0.08 ? t / 0.08 : 1;
      const fadeOut = Math.pow(1 - t, this.fade[i]);
      C[c] = this.col[c]; C[c + 1] = this.col[c + 1]; C[c + 2] = this.col[c + 2]; C[c + 3] = this.col[c + 3] * fadeIn * fadeOut;
      D[c] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
      D[c + 1] = this.rot[i]; D[c + 2] = this.cell[i]; D[c + 3] = this.stretch[i];
    }
    this.geometry.instanceCount = n;
    if (n) {
      for (const a of [this.aPos, this.aVel, this.aColor, this.aData]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  clear() { this.n = 0; this.geometry.instanceCount = 0; }
}
