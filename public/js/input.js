// Entrées clavier / souris. Les touches sont identifiées par leur POSITION physique (event.code) :
// la disposition ZQSD d'un clavier AZERTY et WASD d'un QWERTY fonctionnent donc sans réglage.

import { BTN } from '../shared/constants.js';

/** Action → positions physiques des touches. */
export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  sprint: ['ShiftLeft'],
  reload: ['KeyR'],
  grenade: ['KeyG'],
  melee: ['KeyV'],
  use: ['KeyF', 'KeyE'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'],
  last: ['KeyQ'],
  scores: ['Tab'],
  chat: ['KeyT', 'Enter', 'NumpadEnter'],
  shop: ['KeyB'],
  loadout: ['KeyL'],
};

const BUTTON_MAP = [
  ['forward', BTN.FWD], ['back', BTN.BACK], ['left', BTN.LEFT], ['right', BTN.RIGHT], ['jump', BTN.JUMP],
  ['crouch', BTN.CROUCH], ['sprint', BTN.SPRINT], ['reload', BTN.RELOAD], ['grenade', BTN.GRENADE], ['melee', BTN.MELEE], ['use', BTN.USE],
];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();          // codes de touches enfoncées
    this.mouse = [false, false, false];
    this.dx = 0; this.dy = 0;       // déplacement souris accumulé depuis la dernière lecture
    this.wheel = 0;
    this.pressed = [];              // actions déclenchées (front montant), consommées par le jeu
    this.enabled = false;           // le jeu a la main (verrouillage du pointeur actif)
    this.onLockChange = null;
    this.codeToAction = new Map();
    for (const [action, codes] of Object.entries(BINDINGS)) for (const c of codes) this.codeToAction.set(c, action);
    // Entrées injectées par les tests automatiques (window.__game.input.virtual = BTN...)
    this.virtual = 0;

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.reset());
    canvas.addEventListener('mousedown', (e) => { if (this.locked) { this.mouse[e.button] = true; e.preventDefault(); } });
    window.addEventListener('mouseup', (e) => { this.mouse[e.button] = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // certains navigateurs envoient parfois un déplacement aberrant au verrouillage : on l'écarte
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    canvas.addEventListener('wheel', (e) => { if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.reset();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { if (this.onLockChange) this.onLockChange(false); });
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  lock() {
    if (this.locked) return;
    try {
      // mouvement brut (sans accélération du système) quand le navigateur le permet
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* refusé */ } });
    } catch { try { this.canvas.requestPointerLock(); } catch { /* refusé */ } }
  }
  unlock() { if (this.locked) document.exitPointerLock(); }

  reset() { this.down.clear(); this.mouse[0] = this.mouse[1] = this.mouse[2] = false; this.dx = this.dy = 0; }

  _key(e, isDown) {
    const tag = e.target && e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (typing) { if (!isDown) this.down.delete(e.code); return; }
    const action = this.codeToAction.get(e.code);
    if (this.locked || this.enabled) {
      // on empêche le navigateur de réagir (Tab, espace, Ctrl+touche…) pendant le jeu
      if (action || e.code === 'Tab' || (e.ctrlKey && this.locked)) e.preventDefault();
    }
    if (isDown) {
      if (!e.repeat && action) this.pressed.push(action);
      this.down.add(e.code);
    } else this.down.delete(e.code);
  }

  isDown(action) {
    const codes = BINDINGS[action];
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i])) return true;
    return false;
  }

  /** Boutons de la commande courante (hors emplacement d'arme). */
  buttons() {
    let b = this.virtual;
    if (!this.locked && !this.virtualOnly) return b;
    for (let i = 0; i < BUTTON_MAP.length; i++) if (this.isDown(BUTTON_MAP[i][0])) b |= BUTTON_MAP[i][1];
    if (this.mouse[0]) b |= BTN.FIRE;
    if (this.mouse[2]) b |= BTN.ADS;
    return b;
  }

  /** Lit et remet à zéro le déplacement de souris. */
  takeMouse(out) { out.x = this.dx; out.y = this.dy; this.dx = 0; this.dy = 0; return out; }
  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  takePressed() { const p = this.pressed; this.pressed = []; return p; }
}

/** Libellé lisible d'une touche, selon la disposition réelle du clavier quand le navigateur la fournit. */
let layout = null;
export async function loadKeyboardLayout() {
  try { if (navigator.keyboard && navigator.keyboard.getLayoutMap) layout = await navigator.keyboard.getLayoutMap(); } catch { layout = null; }
}
const NAMES = { Space: 'Espace', ShiftLeft: 'Maj', ControlLeft: 'Ctrl', Tab: 'Tab', Enter: 'Entrée', Escape: 'Échap' };
export function keyLabel(action) {
  const code = BINDINGS[action][0];
  if (NAMES[code]) return NAMES[code];
  if (layout && layout.get(code)) return layout.get(code).toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
