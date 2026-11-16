// Réglages du joueur, conservés dans le navigateur (localStorage).

const KEY = 'etmlshoot.settings.v1';

export const DEFAULTS = {
  name: '',
  sensitivity: 1.0,     // multiplicateur de sensibilité souris
  adsSensitivity: 0.85, // facteur supplémentaire en visée
  fov: 68,              // champ de vision vertical (degrés) — environ 100° à l'horizontale en 16:9
  volume: 0.8,
  quality: 'high',      // low | medium | high | ultra
  gore: 1,              // 0 = sans sang, 1 = normal, 2 = extrême
  invertY: false,
  showFps: true,
  loadout: 1,           // arme principale favorite (identifiant d'arme)
  crosshair: '#f4f6f8',
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    this.listeners = new Set();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const k of Object.keys(DEFAULTS)) {
          if (typeof saved[k] === typeof DEFAULTS[k]) this.data[k] = saved[k];
        }
      }
    } catch { /* stockage indisponible : on garde les valeurs par défaut */ }
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(k, v);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
