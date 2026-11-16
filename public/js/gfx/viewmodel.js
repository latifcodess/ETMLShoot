// Arme en vue subjective : scène et caméra séparées (rendues par-dessus le monde), animation procédurale
// (balancement, pas, visée, recul, sprint, changement d'arme, rechargement, corps à corps).

import * as THREE from 'three';
import { W, WEAPONS, MELEE } from '../../shared/weapons.js';
import { buildWeaponView } from './weapons3d.js';
import { sharedAtlas } from './textures.js';

const HIP = { rifle: [0.2, -0.205, -0.56], pistol: [0.15, -0.175, -0.5], knife: [0.22, -0.22, -0.44], hip: [0.2, -0.2, -0.56] };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));

export class ViewModel {
  constructor(env) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.01, 12);
    this.sun = new THREE.DirectionalLight(new THREE.Color().setHex(env.sunColor, THREE.SRGBColorSpace), env.sunIntensity * 0.9);
    this.hemi = new THREE.HemisphereLight(new THREE.Color().setHex(env.hemiSky, THREE.SRGBColorSpace), new THREE.Color().setHex(env.hemiGround, THREE.SRGBColorSpace), env.hemiIntensity * 2.4);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 4, 1.5);
    this.sunBase = this.sun.intensity;
    this.hemiBase = this.hemi.intensity;
    this.scene.add(this.sun, this.hemi, this.flashLight);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    // flash de bouche : deux plans croisés
    const atlas = sharedAtlas('particles');
    const fm = new THREE.MeshBasicMaterial({ map: atlas, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, color: new THREE.Color(3.2, 2.2, 1.0), toneMapped: false, side: THREE.DoubleSide });
    const fg = new THREE.PlaneGeometry(1, 1);
    const uv = fg.attributes.uv;       // cellule 3 de l'atlas 4×4 (flash en étoile)
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (3 + uv.getX(i)) / 4, 1 - (1 - uv.getY(i)) / 4);
    this.flash = new THREE.Group();
    const f1 = new THREE.Mesh(fg, fm), f2 = new THREE.Mesh(fg, fm);
    f2.rotation.y = Math.PI / 2;
    this.flash.add(f1, f2);
    this.flash.visible = false;
    this.flashT = 0;
    this.scene.add(this.flash);

    this.cache = new Map();
    this.cur = null;
    this.weaponId = -1;
    // état d'animation
    this.bob = 0; this.swayX = 0; this.swayY = 0; this.kick = 0; this.kickRot = 0; this.kickSide = 0;
    this.sprint = 0; this.land = 0; this.landV = 0; this.crouch = 0; this.time = 0; this.fireT = 9; this.nade = 0;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.shade = 1;
    this.muzzleView = new THREE.Vector3();
    this.visible = true;
    this.sleeve = 0x4c5439;
  }

  setSleeve(hex) { if (hex !== this.sleeve) { this.sleeve = hex; this.cache.clear(); this.weaponId = -1; } }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.cur) this.rig.remove(this.cur.group);
    this.cur = null;
    if (id < 0) return;
    let m = this.cache.get(id);
    if (!m) { m = buildWeaponView(id, this.sleeve); this.cache.set(id, m); }
    this.cur = m;
    this.rig.add(m.group);
  }

  /** Recul visuel d'un tir. */
  fire(def) {
    const r = def.recoil[0];
    this.kick = Math.min(0.12, this.kick + 0.018 + r * 0.9);
    this.kickRot = Math.min(0.5, this.kickRot + 0.02 + r * 2.4);
    this.kickSide += (Math.random() - 0.5) * 0.02;
    this.fireT = 0;
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * 6.28;
    this.flash.scale.setScalar((def.id === W.SHOTGUN || def.id === W.SNIPER ? 0.34 : def.id === W.PISTOL ? 0.17 : 0.24) * (0.8 + Math.random() * 0.5));
  }
  throwGrenade() { this.nade = 1; }
  landed(speed) { this.landV -= Math.min(1.6, speed * 0.12); }

  /**
   * @param s {ws, def, speed, onGround, sprinting, crouching, dyaw, dpitch, shade, camQuat, sunDir, fov, aspect}
   */
  update(dt, s) {
    this.time += dt;
    const ws = s.ws, def = s.def;
    this.camera.aspect = s.aspect;
    this.camera.updateProjectionMatrix();
    // lumière : le soleil est exprimé dans le repère de la caméra ; atténué si le joueur est à l'ombre
    this.shade += (s.shade - this.shade) * Math.min(1, dt * 6);
    this.sunDir.copy(s.sunDir).applyQuaternion(s.camQuat.clone().invert());
    this.sun.position.copy(this.sunDir).multiplyScalar(5);
    this.sun.intensity = this.sunBase * (0.22 + 0.78 * this.shade);
    this.hemi.intensity = this.hemiBase * (0.75 + 0.25 * this.shade);

    if (!this.cur || !def) { this.rig.visible = false; this.flash.visible = false; return; }
    const model = this.cur.model, parts = this.cur.parts;
    const ads = ease(ws.ads);
    const scoped = !!def.scope && ws.ads > 0.9;
    this.rig.visible = this.visible && !scoped;

    // --- ressorts
    this.kick += (0 - this.kick) * Math.min(1, dt * 13);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 11);
    this.kickSide += (0 - this.kickSide) * Math.min(1, dt * 9);
    this.sprint += ((s.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 9);
    this.crouch += ((s.crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 9);
    this.landV += (-this.land * 90 - this.landV * 13) * dt;
    this.land += this.landV * dt;
    this.fireT += dt;
    this.nade = Math.max(0, this.nade - dt * 2.4);
    const sw = Math.min(1, dt * 9);
    this.swayX += (Math.max(-0.07, Math.min(0.07, s.dyaw * 0.9)) - this.swayX) * sw;
    this.swayY += (Math.max(-0.07, Math.min(0.07, s.dpitch * 0.9)) - this.swayY) * sw;
    if (s.onGround) this.bob += s.speed * dt * 1.55;

    // --- pose de base : hanche ↔ visée
    const hip = model.shoulder ? [0.2, -0.24, -0.36] : (HIP[model.hold] || HIP.rifle);
    const aimX = model.shoulder ? 0.055 : 0, aimZ = model.hold === 'pistol' ? -0.42 : model.shoulder ? -0.2 : -0.3;
    let x = lerp(hip[0], aimX, ads), y = lerp(hip[1], -model.sightY, ads), z = lerp(hip[2], aimZ, ads);
    let rx = 0, ry = 0, rz = 0;
    const loose = 1 - ads * 0.88;

    // pas et respiration
    const amp = Math.min(1, s.speed / 5) * (s.onGround ? 1 : 0.2);
    x += Math.sin(this.bob) * 0.008 * amp * loose * (1 + this.sprint);
    y += -Math.abs(Math.cos(this.bob)) * 0.009 * amp * loose * (1 + this.sprint * 1.2) + Math.sin(this.time * 1.6) * 0.0018 * loose;
    rz += Math.sin(this.bob) * 0.012 * amp * loose;
    // inertie face aux mouvements de souris
    x += this.swayX * 0.35 * loose; y -= this.swayY * 0.3 * loose;
    ry += this.swayX * 1.1 * loose; rx += -this.swayY * 0.9 * loose; rz += this.swayX * 0.8 * loose;
    // recul
    z += this.kick * (1 - ads * 0.35);
    rx += this.kickRot * 0.34 * (1 - ads * 0.5);
    ry += this.kickSide;
    // atterrissage, accroupi
    y += this.land * 0.05 - this.crouch * 0.012 * loose;
    rz += this.crouch * 0.06 * loose;

    // sprint : arme rabattue en travers
    if (this.sprint > 0.001 && model.hold !== 'knife') {
      const k = ease(this.sprint);
      x += -0.07 * k; y += -0.045 * k; z += 0.05 * k;
      rx += -0.22 * k; ry += 0.62 * k; rz += 0.16 * k;
    }

    // changement d'arme : l'arme monte depuis le bas de l'écran
    if (ws.switchT > 0) {
      const k = ease(Math.min(1, ws.switchT / def.draw));
      y -= 0.32 * k; rx -= 0.9 * k; rz += 0.35 * k;
    }

    // rechargement
    let magY = 0, magA = 1, boltZ = 0, pumpZ = 0, leftY = 0, leftZ = 0;
    if (ws.reloadT > 0 && !def.melee) {
      if (def.shellReload) {
        const cyc = (ws.reloadT % def.reload) / def.reload;       // une cartouche par cycle
        const k = Math.sin(cyc * Math.PI);
        rz += 0.42; rx += 0.12; y -= 0.03; x -= 0.03;
        leftY = -0.07 + k * 0.07; leftZ = 0.22 - k * 0.04;
        y += k * 0.008;
      } else {
        const total = def.reload;
        const t = 1 - ws.reloadT / total;
        const tilt = ease(seg(t, 0, 0.14)) * (1 - ease(seg(t, 0.84, 1)));
        rz += 0.5 * tilt; rx += 0.24 * tilt; y -= 0.045 * tilt; x -= 0.03 * tilt; z += 0.03 * tilt;
        // chargeur : sort (0,14→0,36), absent, revient (0,5→0,74)
        const out = ease(seg(t, 0.14, 0.36)), back = ease(seg(t, 0.5, 0.74));
        magY = -0.32 * (out - back);
        magA = t > 0.36 && t < 0.5 ? 0 : 1;
        leftY = magY * 0.9; leftZ = (def.id === W.LMG ? 0.2 : 0.2) * (out > 0 ? Math.min(1, out * 3) : 0) * (1 - ease(seg(t, 0.78, 0.9)));
        // claquement du chargeur puis culasse
        y += Math.sin(seg(t, 0.72, 0.8) * Math.PI) * 0.012;
        boltZ = Math.sin(seg(t, 0.84, 0.96) * Math.PI) * 0.045;
      }
    }
    // cycles mécaniques après un tir : culasse, pompe, verrou
    if (def.id === W.SHOTGUN && this.fireT < 0.62) {
      pumpZ = Math.sin(seg(this.fireT, 0.2, 0.58) * Math.PI) * 0.085;
      leftZ += pumpZ;
    } else if (def.id === W.SNIPER && this.fireT < 1.1) {
      const k = Math.sin(seg(this.fireT, 0.28, 1.0) * Math.PI);
      boltZ = k * 0.07; rz += -0.12 * k; rx += 0.05 * k; y -= 0.012 * k;
    } else if (this.fireT < 0.07) boltZ = model.hold === 'pistol' ? 0.035 : 0.03;

    // corps à corps
    if (ws.meleeT > 0) {
      const t = 1 - ws.meleeT / MELEE.time;
      const k = Math.sin(Math.min(1, t * 1.25) * Math.PI);
      if (model.hold === 'knife') {
        x += -0.3 * ease(seg(t, 0.05, 0.5)) + 0.12 * k; z -= 0.18 * k; y += 0.05 * k;
        ry += 0.9 * k; rz += -0.9 * ease(seg(t, 0, 0.4)) * (1 - ease(seg(t, 0.6, 1)));
      } else {
        // coup de crosse
        z -= 0.2 * k; x -= 0.1 * k; y += 0.04 * k;
        ry += 0.85 * k; rz -= 0.6 * k; rx += 0.2 * k;
      }
    }
    // lancer de grenade : l'arme s'efface un instant
    if (this.nade > 0) { const k = Math.sin(this.nade * Math.PI); y -= 0.11 * k; rx -= 0.3 * k; rz += 0.22 * k; }

    this.rig.position.set(x, y, z);
    this.rig.rotation.set(rx, ry, rz, 'YXZ');
    if (parts.mag) { parts.mag.position.y = magY; parts.mag.visible = magA > 0; }
    if (parts.bolt) parts.bolt.position.z = boltZ;
    if (parts.pump) parts.pump.position.z = pumpZ;
    if (parts.armL) parts.armL.position.set(0, leftY, leftZ);

    // --- flash et lumière de bouche
    this.rig.updateMatrixWorld(true);
    this.muzzleView.set(model.muzzle[0], model.muzzle[1], model.muzzle[2]).applyMatrix4(this.cur.group.matrixWorld);
    this.flashT -= dt;
    const on = this.flashT > 0 && !def.melee && this.rig.visible;
    this.flash.visible = on;
    this.flashLight.intensity = on ? 9 : 0;
    if (on) {
      this.flash.position.copy(this.muzzleView);
      this.flash.position.z -= 0.04;
      this.flashLight.position.copy(this.muzzleView);
      this.flashLight.position.z += 0.25;
    }
  }

  /**
   * Position monde de la bouche du canon, vue par la caméra principale
   * (les deux caméras n'ont pas le même champ de vision : on corrige l'écart).
   */
  muzzleWorld(mainCamera, out) {
    const k = Math.tan(THREE.MathUtils.degToRad(mainCamera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    out.set(this.muzzleView.x * k, this.muzzleView.y * k, this.muzzleView.z);
    return out.applyMatrix4(mainCamera.matrixWorld);
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
