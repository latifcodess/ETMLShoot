// Registre des cartes. Les cartes sont générées par code : le serveur et le client
// reconstruisent exactement la même géométrie à partir de l'identifiant.

import { buildDepot } from './depot.js';
import { buildOutpost } from './outpost.js';
import { World } from '../world.js';
import { MAT, BF } from '../constants.js';

export const BARREL = { radius: 0.3, height: 0.95, hp: 45, dmg: 135, blast: 6.5, respawn: 50 };

const BUILDERS = {
  depot: buildDepot,
  outpost: buildOutpost,
};

export const MAP_LIST = [
  { id: 'depot', name: 'Dépôt 17', desc: 'Terminal à conteneurs au crépuscule. Combats rapprochés et lignes de tir en hauteur.' },
  { id: 'outpost', name: 'Avant-poste Kilo', desc: 'Base avancée dans le désert. Grande carte, idéale pour la survie coop.' },
];

const cache = new Map();

/** Renvoie les données d'une carte (mises en cache). */
export function getMap(id) {
  if (!BUILDERS[id]) id = 'depot';
  let map = cache.get(id);
  if (!map) { map = BUILDERS[id](); cache.set(id, map); }
  return map;
}

export function isValidMap(id) { return Object.prototype.hasOwnProperty.call(BUILDERS, id); }

/**
 * Monde de collision d'une carte. Les barils explosifs y figurent comme obstacles permanents
 * (invisibles, perméables aux balles) : intacts ou détruits, ils gênent le passage de la même façon,
 * ce qui évite toute divergence de prédiction entre client et serveur.
 */
export function createWorld(map) {
  const boxes = map.boxes.slice();
  for (const b of map.barrels) {
    boxes.push({
      min: [b.x - BARREL.radius, b.y, b.z - BARREL.radius],
      max: [b.x + BARREL.radius, b.y + BARREL.height, b.z + BARREL.radius],
      mat: MAT.METAL,
      flags: BF.INVISIBLE | BF.NOBULLET | BF.NONAV | BF.NOSHADOW,
      color: 0,
    });
  }
  return new World(boxes, map.bounds);
}
