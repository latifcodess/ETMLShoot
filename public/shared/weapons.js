// Définition des armes et machine à états de l'arsenal d'un personnage.
// stepWeapons() est exécutée à l'identique par le serveur (autorité) et le client (prédiction).

import { BTN, SLOT_SHIFT, SLOT_MASK, MOVE } from './constants.js';

export const W = {
  PISTOL: 0,
  AR: 1,
  SMG: 2,
  SHOTGUN: 3,
  SNIPER: 4,
  LMG: 5,
  RPG: 6,
  KNIFE: 7,
  MINIGUN: 8,   // réservé au Juggernaut
  // Sources de dégâts sans arme tenue (journal des éliminations)
  GRENADE: 9,
  BARREL: 10,
  FALL: 11,
  BLEED: 12,
};

export const SLOT = { PRIMARY: 0, SECONDARY: 1, MELEE: 2, SPECIAL: 3 };
export const NUM_SLOTS = 4;

const deg = Math.PI / 180;

/**
 * rpm : cadence ; dmg : dégâts par projectile ; falloff : [début, fin, multiplicateur mini]
 * spread* : demi-angle du cône en radians ; heat : dispersion cumulée par tir
 * recoil : [montée, latéral] en radians (appliqué côté client à la visée)
 */
export const WEAPONS = [
  { // 0
    id: W.PISTOL, key: 'pistol', name: 'P-9 Vipère', short: 'P-9', slot: SLOT.SECONDARY, auto: false,
    rpm: 420, dmg: 30, pellets: 1, headMul: 2.2, legMul: 0.8,
    mag: 15, reserve: 60, reload: 1.45, draw: 0.3,
    range: 120, falloff: [18, 45, 0.55],
    spreadHip: 1.0 * deg, spreadAds: 0.25 * deg, spreadMove: 1.6 * deg, spreadAir: 4 * deg,
    heat: 0.9 * deg, heatMax: 4 * deg, heatDecay: 9 * deg,
    recoil: [1.5 * deg, 0.5 * deg], adsTime: 0.14, adsZoom: 1.2, moveMul: 1.05, price: 0,
  },
  { // 1
    id: W.AR, key: 'ar', name: 'FA-7 Mistral', short: 'FA-7', slot: SLOT.PRIMARY, auto: true,
    rpm: 700, dmg: 27, pellets: 1, headMul: 2.0, legMul: 0.8,
    mag: 30, reserve: 150, reload: 2.1, draw: 0.45,
    range: 220, falloff: [40, 90, 0.7],
    spreadHip: 1.5 * deg, spreadAds: 0.12 * deg, spreadMove: 2.2 * deg, spreadAir: 5 * deg,
    heat: 0.32 * deg, heatMax: 3.2 * deg, heatDecay: 7 * deg,
    recoil: [0.72 * deg, 0.34 * deg], adsTime: 0.2, adsZoom: 1.45, moveMul: 0.96, price: 1300,
  },
  { // 2
    id: W.SMG, key: 'smg', name: 'PM-5 Frelon', short: 'PM-5', slot: SLOT.PRIMARY, auto: true,
    rpm: 960, dmg: 19, pellets: 1, headMul: 1.8, legMul: 0.85,
    mag: 32, reserve: 192, reload: 1.75, draw: 0.35,
    range: 120, falloff: [12, 34, 0.5],
    spreadHip: 1.9 * deg, spreadAds: 0.45 * deg, spreadMove: 1.2 * deg, spreadAir: 3.5 * deg,
    heat: 0.3 * deg, heatMax: 3.6 * deg, heatDecay: 9 * deg,
    recoil: [0.55 * deg, 0.42 * deg], adsTime: 0.15, adsZoom: 1.25, moveMul: 1.02, price: 700,
  },
  { // 3
    id: W.SHOTGUN, key: 'shotgun', name: 'M-12 Brèche', short: 'M-12', slot: SLOT.PRIMARY, auto: false,
    rpm: 78, dmg: 13, pellets: 9, headMul: 1.5, legMul: 0.9,
    mag: 7, reserve: 35, reload: 0.5, shellReload: true, draw: 0.45,
    range: 60, falloff: [7, 26, 0.25],
    spreadHip: 3.6 * deg, spreadAds: 2.8 * deg, spreadMove: 0.6 * deg, spreadAir: 2 * deg,
    heat: 0, heatMax: 0, heatDecay: 1,
    recoil: [4.2 * deg, 1.2 * deg], adsTime: 0.2, adsZoom: 1.2, moveMul: 0.96, price: 900,
  },
  { // 4
    id: W.SNIPER, key: 'sniper', name: 'FR-90 Faucon', short: 'FR-90', slot: SLOT.PRIMARY, auto: false,
    rpm: 46, dmg: 98, pellets: 1, headMul: 3.5, legMul: 0.75,
    mag: 5, reserve: 30, reload: 2.9, draw: 0.6,
    range: 400, falloff: [200, 400, 0.9],
    spreadHip: 5 * deg, spreadAds: 0.02 * deg, spreadMove: 5 * deg, spreadAir: 9 * deg,
    heat: 0, heatMax: 0, heatDecay: 1,
    recoil: [5 * deg, 0.9 * deg], adsTime: 0.3, adsZoom: 4.5, scope: true, moveMul: 0.9, price: 1700,
  },
  { // 5
    id: W.LMG, key: 'lmg', name: 'ML-249 Ouragan', short: 'ML-249', slot: SLOT.PRIMARY, auto: true,
    rpm: 760, dmg: 30, pellets: 1, headMul: 1.9, legMul: 0.85,
    mag: 100, reserve: 200, reload: 4.6, draw: 0.75,
    range: 240, falloff: [45, 110, 0.72],
    spreadHip: 2.6 * deg, spreadAds: 0.4 * deg, spreadMove: 3.5 * deg, spreadAir: 7 * deg,
    heat: 0.26 * deg, heatMax: 3.4 * deg, heatDecay: 5 * deg,
    recoil: [0.82 * deg, 0.5 * deg], adsTime: 0.32, adsZoom: 1.35, moveMul: 0.84, price: 2600,
  },
  { // 6
    id: W.RPG, key: 'rpg', name: 'LR-7 Titan', short: 'LR-7', slot: SLOT.SPECIAL, auto: false,
    rpm: 40, dmg: 150, pellets: 1, headMul: 1, legMul: 1,
    mag: 1, reserve: 3, reload: 2.8, draw: 0.8,
    range: 400, falloff: [400, 400, 1],
    spreadHip: 0.6 * deg, spreadAds: 0.1 * deg, spreadMove: 1 * deg, spreadAir: 3 * deg,
    heat: 0, heatMax: 0, heatDecay: 1,
    recoil: [3 * deg, 0.6 * deg], adsTime: 0.3, adsZoom: 1.3, moveMul: 0.86, price: 3200,
    projectile: { speed: 46, radius: 6.5, life: 6 },
  },
  { // 7
    id: W.KNIFE, key: 'knife', name: 'Couteau de combat', short: 'Couteau', slot: SLOT.MELEE, auto: true, melee: true,
    rpm: 110, dmg: 60, pellets: 0, headMul: 1, legMul: 1,
    mag: 0, reserve: 0, reload: 0, draw: 0.25,
    range: 2.1, falloff: [10, 10, 1],
    spreadHip: 0, spreadAds: 0, spreadMove: 0, spreadAir: 0,
    heat: 0, heatMax: 0, heatDecay: 1,
    recoil: [0, 0], adsTime: 0.2, adsZoom: 1, moveMul: 1.1, price: 0,
  },
  { // 8
    id: W.MINIGUN, key: 'minigun', name: 'Minigun M-134', short: 'M-134', slot: SLOT.PRIMARY, auto: true,
    rpm: 1100, dmg: 15, pellets: 1, headMul: 1.5, legMul: 0.9,
    mag: 300, reserve: 9999, reload: 5, draw: 0.8,
    range: 220, falloff: [40, 100, 0.7],
    spreadHip: 2.4 * deg, spreadAds: 2.0 * deg, spreadMove: 1 * deg, spreadAir: 3 * deg,
    heat: 0.05 * deg, heatMax: 1 * deg, heatDecay: 3 * deg,
    recoil: [0.3 * deg, 0.3 * deg], adsTime: 0.3, adsZoom: 1.1, moveMul: 0.7, price: 0,
  },
];

/** Libellés des sources de dégâts (journal des éliminations). */
export const DAMAGE_NAMES = [
  'P-9', 'FA-7', 'PM-5', 'M-12', 'FR-90', 'ML-249', 'LR-7', 'Couteau', 'M-134',
  'Grenade', 'Baril', 'Chute', 'Hémorragie',
];

export const GRENADE = { fuse: 2.6, dmg: 150, radius: 7.5, throwSpeed: 19, max: 4, cooldown: 0.9 };
export const MELEE = { time: 0.5, dmg: 60, backstabMul: 3, range: 2.1 };
export const PRIMARIES = [W.AR, W.SMG, W.SHOTGUN, W.SNIPER, W.LMG];

/** Événements produits par stepWeapons. */
export const WEV = { FIRE: 1, DRY: 2, RELOAD: 3, RELOADED: 4, SWITCH: 5, MELEE: 6, GRENADE: 7, SHELL: 8 };

export function createWeaponState() {
  const slots = [];
  for (let i = 0; i < NUM_SLOTS; i++) slots.push({ id: -1, ammo: 0, reserve: 0 });
  return {
    slots,
    cur: SLOT.SECONDARY,
    cooldown: 0,     // temps avant le prochain tir
    reloadT: 0,      // temps restant de rechargement (0 = pas en cours)
    switchT: 0,      // temps restant pour sortir l'arme
    meleeT: 0,       // coup de couteau rapide en cours
    nadeT: 0,        // délai entre deux grenades
    heat: 0,         // dispersion cumulée
    ads: 0,          // 0 = à la hanche, 1 = en visée
    grenades: 0,
    prevButtons: 0,
  };
}

export function copyWeaponState(dst, src) {
  for (let i = 0; i < NUM_SLOTS; i++) {
    dst.slots[i].id = src.slots[i].id;
    dst.slots[i].ammo = src.slots[i].ammo;
    dst.slots[i].reserve = src.slots[i].reserve;
  }
  dst.cur = src.cur; dst.cooldown = src.cooldown; dst.reloadT = src.reloadT;
  dst.switchT = src.switchT; dst.meleeT = src.meleeT; dst.nadeT = src.nadeT;
  dst.heat = src.heat; dst.ads = src.ads; dst.grenades = src.grenades;
  dst.prevButtons = src.prevButtons;
  return dst;
}

/** Donne (ou remplace) l'arme de l'emplacement correspondant, chargeur plein. */
export function giveWeapon(ws, weaponId, reserveMul = 1) {
  const def = WEAPONS[weaponId];
  const s = ws.slots[def.slot];
  s.id = weaponId;
  s.ammo = def.mag;
  s.reserve = Math.round(def.reserve * reserveMul);
}

export function currentDef(ws) {
  const id = ws.slots[ws.cur].id;
  return id >= 0 ? WEAPONS[id] : null;
}

/** Multiplicateur de vitesse de déplacement selon l'arme en main et la visée. */
export function weaponSpeedMul(ws) {
  const def = currentDef(ws);
  const base = def ? def.moveMul : 1;
  return base * (1 - (1 - MOVE.adsMul) * ws.ads);
}

/** Dispersion effective (demi-angle) compte tenu de l'état du tireur. */
export function currentSpread(def, ws, move) {
  const speed = Math.hypot(move.vx, move.vz) / MOVE.walk;
  let s = def.spreadHip + (def.spreadAds - def.spreadHip) * ws.ads;
  s += ws.heat * (1 - 0.45 * ws.ads);
  s += def.spreadMove * Math.min(1.5, speed) * (1 - 0.75 * ws.ads);
  if (!move.onGround) s += def.spreadAir;
  if (move.crouching) s *= 0.72;
  return s;
}

/**
 * Avance l'arsenal d'un pas.
 * @param ws      état des armes
 * @param buttons boutons de la commande
 * @param dt      durée du pas
 * @param move    état de déplacement (lecture seule : sert à la dispersion)
 * @param sprinting vrai si le personnage sprinte réellement
 * @param out     tableau recevant les événements {type, weapon, spread}
 */
export function stepWeapons(ws, buttons, dt, move, sprinting, out) {
  const prev = ws.prevButtons;
  const pressed = buttons & ~prev;
  ws.prevButtons = buttons;

  if (ws.cooldown > 0) ws.cooldown -= dt;
  if (ws.switchT > 0) { ws.switchT -= dt; if (ws.switchT < 0) ws.switchT = 0; }
  if (ws.meleeT > 0) { ws.meleeT -= dt; if (ws.meleeT < 0) ws.meleeT = 0; }
  if (ws.nadeT > 0) { ws.nadeT -= dt; if (ws.nadeT < 0) ws.nadeT = 0; }

  // --- Changement d'arme
  const want = (buttons >> SLOT_SHIFT) & SLOT_MASK;
  if (want !== ws.cur && want < NUM_SLOTS && ws.slots[want].id >= 0 && ws.meleeT <= 0) {
    ws.cur = want;
    ws.switchT = WEAPONS[ws.slots[want].id].draw;
    ws.reloadT = 0;
    ws.heat = 0;
    if (ws.cooldown > 0.12) ws.cooldown = 0.12;
    out.push({ type: WEV.SWITCH, weapon: ws.slots[want].id, spread: 0 });
  }

  const slot = ws.slots[ws.cur];
  const def = slot.id >= 0 ? WEAPONS[slot.id] : null;
  if (!def) return;
  const busy = ws.switchT > 0 || ws.meleeT > 0;

  // --- Visée
  const wantAds = (buttons & BTN.ADS) !== 0 && !busy && ws.reloadT <= 0 && !sprinting && !def.melee;
  const adsStep = dt / def.adsTime;
  if (wantAds) { ws.ads += adsStep; if (ws.ads > 1) ws.ads = 1; }
  else { ws.ads -= adsStep * 1.3; if (ws.ads < 0) ws.ads = 0; }

  // --- Dissipation de la dispersion
  if (ws.heat > 0) { ws.heat -= def.heatDecay * dt; if (ws.heat < 0) ws.heat = 0; }

  // --- Rechargement en cours
  if (ws.reloadT > 0) {
    ws.reloadT -= dt;
    if (ws.reloadT <= 0) {
      ws.reloadT = 0;
      if (def.shellReload) {
        if (slot.reserve > 0 && slot.ammo < def.mag) { slot.ammo++; slot.reserve--; }
        if (slot.reserve > 0 && slot.ammo < def.mag && !(buttons & BTN.FIRE)) {
          ws.reloadT = def.reload;
          out.push({ type: WEV.SHELL, weapon: def.id, spread: 0 });
        } else {
          out.push({ type: WEV.RELOADED, weapon: def.id, spread: 0 });
        }
      } else {
        const need = Math.min(def.mag - slot.ammo, slot.reserve);
        slot.ammo += need; slot.reserve -= need;
        out.push({ type: WEV.RELOADED, weapon: def.id, spread: 0 });
      }
    }
  } else if (!busy && !def.melee && slot.ammo < def.mag && slot.reserve > 0
    && ((pressed & BTN.RELOAD) || (slot.ammo === 0 && ws.cooldown <= 0))) {
    // rechargement manuel, ou automatique dès que le chargeur est vide
    ws.reloadT = def.shellReload ? def.reload + 0.25 : def.reload;
    out.push({ type: WEV.RELOAD, weapon: def.id, spread: 0 });
  }

  // --- Coup de couteau rapide
  if ((pressed & BTN.MELEE) && ws.meleeT <= 0 && ws.switchT <= 0) {
    ws.meleeT = MELEE.time;
    ws.reloadT = 0;
    out.push({ type: WEV.MELEE, weapon: W.KNIFE, spread: 0 });
    return;
  }

  // --- Grenade
  if ((pressed & BTN.GRENADE) && ws.grenades > 0 && ws.nadeT <= 0 && !busy) {
    ws.grenades--;
    ws.nadeT = GRENADE.cooldown;
    ws.reloadT = 0;
    if (ws.cooldown < 0.45) ws.cooldown = 0.45;
    out.push({ type: WEV.GRENADE, weapon: W.GRENADE, spread: 0 });
    return;
  }

  // --- Tir
  if ((buttons & BTN.FIRE) && !busy && ws.cooldown <= 1e-9 && ws.nadeT < GRENADE.cooldown - 0.4) {
    const trigger = def.auto || (pressed & BTN.FIRE);
    if (def.melee) {
      ws.cooldown = 60 / def.rpm;
      ws.meleeT = MELEE.time * 0.8;
      out.push({ type: WEV.MELEE, weapon: W.KNIFE, spread: 0 });
    } else if (ws.reloadT > 0) {
      // un fusil à pompe peut interrompre son rechargement cartouche par cartouche
      if (def.shellReload && slot.ammo > 0 && (pressed & BTN.FIRE)) {
        ws.reloadT = 0;
        ws.cooldown = 0.22;
      }
    } else if (trigger) {
      if (slot.ammo > 0) {
        slot.ammo--;
        ws.cooldown = (ws.cooldown < -dt ? -dt : ws.cooldown) + 60 / def.rpm;
        const spread = currentSpread(def, ws, move);
        ws.heat += def.heat;
        if (ws.heat > def.heatMax) ws.heat = def.heatMax;
        out.push({ type: WEV.FIRE, weapon: def.id, spread });
      } else if (pressed & BTN.FIRE) {
        out.push({ type: WEV.DRY, weapon: def.id, spread: 0 });   // plus aucune munition
      }
    }
  }
}
