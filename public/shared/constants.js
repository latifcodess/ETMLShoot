// Constantes partagées entre le serveur et le client.
// Toute valeur ici influence la simulation : client et serveur DOIVENT utiliser le même fichier.

/** Titre du jeu (affiché dans les menus). Seul endroit à modifier pour le renommer. */
export const GAME_TITLE = 'ETMLShoot';

export const TICK_RATE = 30;                 // ticks serveur (et snapshots) par seconde
export const TICK_MS = 1000 / TICK_RATE;
export const SIM_RATE = 60;                  // commandes d'entrée par seconde (pas fixe)
export const SIM_DT = 1 / SIM_RATE;
export const SUBSTEPS = SIM_RATE / TICK_RATE; // sous-pas de simulation par tick pour l'IA
export const INTERP_DELAY_MS = 100;          // retard d'interpolation des entités distantes
export const MAX_REWIND_MS = 400;            // compensation de latence maximale

// Gabarit de collision (boîte alignée sur les axes, origine aux pieds)
export const HULL = {
  halfW: 0.35,
  height: 1.8,
  crouchHeight: 1.25,
  eye: 1.62,
  crouchEye: 1.07,
  step: 0.55,       // hauteur de marche franchissable
  airStep: 0.3,     // rattrapage de rebord en l'air
};

export const MOVE = {
  walk: 5.0,
  sprint: 7.4,
  crouch: 2.5,
  adsMul: 0.62,
  accel: 62,        // m/s² au sol avec entrée
  friction: 48,     // m/s² au sol sans entrée
  airAccel: 11,
  gravity: 21,
  jumpVel: 6.5,
  maxFall: 45,
};

// Boutons d'une commande (16 bits)
export const BTN = {
  FWD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  CROUCH: 1 << 5,
  SPRINT: 1 << 6,
  FIRE: 1 << 7,
  ADS: 1 << 8,
  RELOAD: 1 << 9,
  GRENADE: 1 << 10,
  MELEE: 1 << 11,
  USE: 1 << 12,
};
export const SLOT_SHIFT = 13;   // bits 13..15 : emplacement d'arme voulu (0..7)
export const SLOT_MASK = 7;

export const TEAM = { NONE: 0, ALPHA: 1, BRAVO: 2, HOSTILE: 3 };
export const TEAM_NAMES = ['', 'ALPHA', 'BRAVO', 'HOSTILES'];

// Drapeaux d'état d'un acteur dans un snapshot
export const AF = {
  CROUCH: 1 << 0,
  GROUND: 1 << 1,
  SPRINT: 1 << 2,
  RELOAD: 1 << 3,
  ADS: 1 << 4,
  PROTECTED: 1 << 5,
  DOWNED: 1 << 6,
  FIRING: 1 << 7,
};

// Matériaux des boîtes du monde
export const MAT = {
  CONCRETE: 0,
  METAL: 1,
  WOOD: 2,
  SAND: 3,
  BRICK: 4,
  ASPHALT: 5,
  SANDBAG: 6,
  CONTAINER: 7,
  HESCO: 8,
  PLASTER: 9,
  RUST: 10,
  TARP: 11,
  RUBBER: 12,
  LAMP: 13,
  PAINT: 14,
  DARKMETAL: 15,
  ROOF: 16,
  CAMO: 17,
  ROCK: 18,
  TILE: 19,
};

// Famille d'impact pour les effets (poussière, étincelles, éclats...)
export const SURF = { CONCRETE: 0, METAL: 1, WOOD: 2, SAND: 3, SOFT: 4 };
export const MAT_SURF = [
  SURF.CONCRETE, // CONCRETE
  SURF.METAL,    // METAL
  SURF.WOOD,     // WOOD
  SURF.SAND,     // SAND
  SURF.CONCRETE, // BRICK
  SURF.CONCRETE, // ASPHALT
  SURF.SAND,     // SANDBAG
  SURF.METAL,    // CONTAINER
  SURF.SAND,     // HESCO
  SURF.CONCRETE, // PLASTER
  SURF.METAL,    // RUST
  SURF.SOFT,     // TARP
  SURF.SOFT,     // RUBBER
  SURF.METAL,    // LAMP
  SURF.CONCRETE, // PAINT
  SURF.METAL,    // DARKMETAL
  SURF.METAL,    // ROOF
  SURF.SOFT,     // CAMO
  SURF.CONCRETE, // ROCK
  SURF.CONCRETE, // TILE
];

// Drapeaux des boîtes
export const BF = {
  NOCOLLIDE: 1 << 0,   // décor : ni joueurs ni balles
  NOBULLET: 1 << 1,    // bloque les joueurs mais pas les balles (mur invisible, grillage)
  INVISIBLE: 1 << 2,   // non rendue
  NOSHADOW: 1 << 3,
  NONAV: 1 << 4,       // l'IA ne marche pas dessus
  EMISSIVE: 1 << 5,
};

// Codes de face d'un impact : normale sortante
export const FACE_NORMALS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

// Nature de l'extrémité d'un tir
export const HITK = { NONE: 0, WORLD: 1, FLESH: 2, HEAD: 3, ARMOR: 4 };

export const MODES = {
  ffa: { name: 'Mêlée générale', desc: 'Chacun pour soi. Premier à la limite de frags.' },
  tdm: { name: 'Match à mort par équipes', desc: 'ALPHA contre BRAVO.' },
  coop: { name: 'Survie coop', desc: 'Tenez ensemble face aux vagues ennemies.' },
};
