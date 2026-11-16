// Pas de simulation complet d'un personnage (déplacement puis armes).
// Point d'entrée UNIQUE partagé par l'autorité serveur et la prédiction client :
// l'ordre des opérations y est figé, ce qui garantit des résultats identiques des deux côtés.

import { stepMove, buttonsToMove, createMoveInput } from './physics.js';
import { stepWeapons, weaponSpeedMul } from './weapons.js';

const _inp = createMoveInput();

/**
 * @param move     état de déplacement (modifié)
 * @param ws       état des armes (modifié)
 * @param buttons  boutons de la commande
 * @param yaw      lacet de la commande
 * @param dt       durée du pas
 * @param world    monde de collision
 * @param speed    multiplicateur de vitesse propre au personnage
 * @param events   tableau recevant les événements d'arme
 * @param aiInput  (IA uniquement) entrée de déplacement analogique à la place des boutons
 * @returns vitesse d'impact à l'atterrissage (0 sinon)
 */
export function simulate(move, ws, buttons, yaw, dt, world, speed, events, aiInput) {
  const speedMul = weaponSpeedMul(ws) * speed;
  let inp;
  if (aiInput) { inp = aiInput; inp.speedMul = speedMul; }
  else inp = buttonsToMove(buttons, yaw, speedMul, _inp);
  const sprinting = inp.sprint && move.onGround;
  const land = stepMove(move, inp, dt, world);
  stepWeapons(ws, buttons, dt, move, sprinting, events);
  return land;
}
