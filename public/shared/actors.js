// Types de personnages. KIND.SOLDIER = joueurs et bots ; les autres sont les ennemis de la survie coop.

import { W } from './weapons.js';

export const KIND = {
  SOLDIER: 0,
  GRUNT: 1,
  RUSHER: 2,
  HEAVY: 3,
  MARKSMAN: 4,
  GRENADIER: 5,
  JUGGERNAUT: 6,
};

/**
 * hp/armor : résistance ; scale : taille (modèle + zones de touche) ; speed : multiplicateur de vitesse
 * weapon : arme portée ; dmgMul : multiplicateur des dégâts infligés ; bounty : prime en $ (coop)
 * look : variante visuelle côté client
 */
export const KINDS = [
  { id: 0, name: 'Soldat', hp: 100, armor: 0, scale: 1, speed: 1, weapon: W.AR, dmgMul: 1, bounty: 0, look: 'soldier' },
  { id: 1, name: 'Fantassin', hp: 80, armor: 0, scale: 1, speed: 0.82, weapon: W.AR, dmgMul: 0.3, bounty: 60, look: 'grunt' },
  { id: 2, name: 'Assaut', hp: 60, armor: 0, scale: 0.96, speed: 1.18, weapon: W.SMG, dmgMul: 0.34, bounty: 70, look: 'rusher' },
  { id: 3, name: 'Lourd', hp: 320, armor: 100, scale: 1.14, speed: 0.6, weapon: W.LMG, dmgMul: 0.3, bounty: 220, look: 'heavy' },
  { id: 4, name: 'Tireur d\'élite', hp: 70, armor: 0, scale: 1, speed: 0.8, weapon: W.SNIPER, dmgMul: 0.42, bounty: 130, look: 'marksman' },
  { id: 5, name: 'Grenadier', hp: 110, armor: 30, scale: 1.04, speed: 0.78, weapon: W.SHOTGUN, dmgMul: 0.4, bounty: 140, look: 'grenadier' },
  { id: 6, name: 'JUGGERNAUT', hp: 4200, armor: 0, scale: 1.34, speed: 0.52, weapon: W.MINIGUN, dmgMul: 0.42, bounty: 1500, look: 'juggernaut', boss: true },
];

export function kindDef(kind) { return KINDS[kind] || KINDS[0]; }
