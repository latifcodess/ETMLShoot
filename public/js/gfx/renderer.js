// Moteur de rendu : WebGL (Three.js) + chaîne de post-traitement
// (rendu HDR → arme en vue subjective → flou lumineux → étalonnage → conversion d'affichage).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.42 }, uDamage: { value: 0 }, uDesat: { value: 0 }, uAberration: { value: 0 },
    uGrain: { value: 0.035 }, uTime: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    uFlash: { value: 0 }, uContrast: { value: 1.06 }, uFade: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette, uDamage, uDesat, uAberration, uGrain, uTime, uFlash, uContrast, uFade;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec3 col;
      float ab = uAberration * r2 * 0.045;
      if (ab > 0.00002) {
        col.r = texture2D(tDiffuse, vUv + c * ab).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - c * ab).b;
      } else col = texture2D(tDiffuse, vUv).rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), uDesat);
      col *= uTint;
      // contraste doux autour du gris moyen (espace linéaire)
      col = max(vec3(0.0), (col - 0.18) * uContrast + 0.18);
      col *= 1.0 - uVignette * smoothstep(0.12, 0.8, r2 * 2.0);
      // voile rouge des dégâts : plus dense sur les bords
      float dv = uDamage * smoothstep(0.16, 0.9, r2 * 2.2);
      col = mix(col, vec3(0.5, 0.0, 0.0) * (l * 0.8 + 0.25), clamp(dv, 0.0, 0.6));
      col += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain * (0.35 + l);
      col = mix(col, vec3(3.0), clamp(uFlash, 0.0, 1.0));
      col *= 1.0 - uFade;
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
};

export const QUALITIES = ['low', 'medium', 'high', 'ultra'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.autoClear = true;
    this.gl.info.autoReset = true;
    this.quality = 'high';
    this.fx = { damage: 0, desat: 0, aberration: 0, flash: 0, fade: 0 };
    this.time = 0;
    this.composer = null;
    this.worldPass = null;
    this.viewPass = null;
    this._scene = null;
    this._build();
    window.addEventListener('resize', () => this.resize());
  }

  get pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return { low: Math.min(dpr, 1) * 0.75, medium: Math.min(dpr, 1), high: Math.min(dpr, 1.5), ultra: Math.min(dpr, 2) }[this.quality];
  }

  _build() {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    const pr = this.pixelRatio;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    this.gl.shadowMap.enabled = this.quality !== 'low';
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    const samples = { low: 0, medium: 0, high: 4, ultra: 4 }[this.quality];
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    const dummyScene = new THREE.Scene(), dummyCam = new THREE.PerspectiveCamera();
    this.worldPass = new RenderPass(dummyScene, dummyCam);
    this.viewPass = new RenderPass(dummyScene, dummyCam);
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;
    this.viewPass.enabled = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.55, 1.0);
    this.bloom.enabled = this.quality !== 'low';
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.viewPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
  }

  setQuality(q) {
    if (!QUALITIES.includes(q) || q === this.quality) return;
    this.quality = q;
    this._build();
  }

  resize() {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  get aspect() { return Math.max(2, window.innerWidth) / Math.max(2, window.innerHeight); }

  /**
   * @param scene, camera          monde
   * @param viewScene, viewCamera  arme en vue subjective (facultatif)
   */
  render(scene, camera, viewScene, viewCamera, dt) {
    this.time += dt;
    this.worldPass.scene = scene; this.worldPass.camera = camera;
    if (viewScene) { this.viewPass.scene = viewScene; this.viewPass.camera = viewCamera; this.viewPass.enabled = true; }
    else this.viewPass.enabled = false;
    const u = this.grade.uniforms, fx = this.fx;
    u.uTime.value = this.time;
    u.uDamage.value = fx.damage;
    u.uDesat.value = fx.desat;
    u.uAberration.value = fx.aberration;
    u.uFlash.value = fx.flash;
    u.uFade.value = fx.fade;
    this.composer.render(dt);
  }

  setExposure(e) { this.gl.toneMappingExposure = e; }
  setTint(r, g, b) { this.grade.uniforms.uTint.value.set(r, g, b); }

  /** Carte d'environnement (reflets et lumière ambiante) à partir du ciel. */
  makeEnvironment(skyMesh) {
    const pm = new THREE.PMREMGenerator(this.gl);
    const s = new THREE.Scene();
    const clone = skyMesh.clone();
    clone.scale.setScalar(50);
    s.add(clone);
    const rt = pm.fromScene(s, 0.02, 0.1, 200);
    pm.dispose();
    return rt.texture;
  }
}
